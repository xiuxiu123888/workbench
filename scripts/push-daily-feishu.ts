import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AxiosInstance } from 'axios'
import { createClient, errorMessage, unwrapArticle, withRequestTimeout } from '../src/api/http'
import {
  formatFeishuSiteLines,
  metricsByCountry,
  resolveArticleCountry,
  revenueByCountry,
  type CountryMetric,
} from '../src/domain/feishuPushFormat'
import {
  articleDayStatMap,
  articleIdFromUrl,
  articleLinks,
  formatMoney,
  linksForReportDay,
  revenueByDay,
  sourceFromAccountName,
} from '../src/domain/report'
import { recentArticleItems } from '../src/domain/recentArticles'
import { openReportCache } from '../src/server/reportCacheDb'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DAILY_STAT_TIMEOUT_MS = 60000
const REVENUE_TIMEOUT_MS = 45000
const FEISHU_CHUNK = 3500

interface SiteRow {
  revenue: number | null
  pageViews: number
  termClicks: number
  adClicks: number
  label: string
  accountId: string
  accountName: string
  countries: CountryMetric[]
  errors: string[]
}

interface AccountInfo {
  id: string
  name: string
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return
  }
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const index = line.indexOf('=')
    if (index <= 0) {
      continue
    }
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!(key in process.env) || process.env[key] === '') {
      process.env[key] = value
    }
  }
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? '').trim()
  if (!value) {
    throw new Error(`缺少 ${name}，请写在 .env.local`)
  }
  return value
}

function formatLocalDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 白天推今天；本地 0 点这一小时推昨天（整天已结束）。可用 --day=YYYY-MM-DD 覆盖。 */
function reportDay(now = new Date()): { day: string; today: string; kind: 'today' | 'yesterday' } {
  const today = formatLocalDay(now)
  if (now.getHours() === 0) {
    const previous = new Date(now)
    previous.setDate(previous.getDate() - 1)
    return { day: formatLocalDay(previous), today, kind: 'yesterday' }
  }
  return { day: today, today, kind: 'today' }
}

function siteLabel(row: { siteName?: string; id?: number | string }, detail: Record<string, unknown>): string {
  const fromDetail = String(detail.siteName ?? detail.siteUrl ?? '').trim()
  if (fromDetail) {
    return fromDetail
  }
  return String(row.siteName ?? row.id ?? '未命名').trim() || '未命名'
}

async function loadDailyStats(
  article: AxiosInstance,
  filter: { subid2List: string[]; day: string },
) {
  const subid2List = [...new Set(filter.subid2List.map((id) => id.trim()).filter(Boolean))]
  if (subid2List.length === 0) {
    return new Map()
  }
  const data = await withRequestTimeout(DAILY_STAT_TIMEOUT_MS, async (signal) => {
    const response = await article.post(
      '/forwardRecord/subid2DailyStat',
      {
        subid2List,
        startDate: filter.day,
        endDate: filter.day,
        keywordLimit: 20,
      },
      { timeout: DAILY_STAT_TIMEOUT_MS, signal },
    )
    const body = unwrapArticle<unknown>(response.data)
    return Array.isArray(body) ? body : []
  })
  return articleDayStatMap(data)
}

async function channelRevenue(
  mis: AxiosInstance,
  filter: { customChannelId: string; source: string; investor: string; day: string },
): Promise<number | null> {
  const domain = `${filter.source.trim()}-${filter.customChannelId.trim()}`
  const investor = filter.investor.trim()
  if (!filter.customChannelId || !filter.source || !investor) {
    return null
  }
  const page = await withRequestTimeout(REVENUE_TIMEOUT_MS, async (signal) => {
    const response = await mis.get('/biz/report/list', {
      timeout: REVENUE_TIMEOUT_MS,
      signal,
      params: {
        pageNum: 1,
        pageSize: 100,
        targetTime: [filter.day, filter.day],
        investor,
        domain,
      },
      paramsSerializer: { indexes: null },
    })
    const body = response.data as {
      code?: number
      msg?: string
      rows?: Array<{
        date?: string | null
        estimatedEarnings?: string | number | null
        revenue?: string | number | null
        targetTime?: string | null
      }>
    }
    if (body.code !== 200) {
      throw new Error(body.msg || '收入请求失败')
    }
    return Array.isArray(body.rows) ? body.rows : []
  })
  const byDay = revenueByDay(page)
  if (!byDay.has(filter.day)) {
    return null
  }
  return byDay.get(filter.day) ?? 0
}

async function listAllConfigs(article: AxiosInstance) {
  const records: Array<{ id: number | string; siteName?: string; accountId?: number | string }> = []
  let pageNum = 1
  let total = Infinity
  while (records.length < total) {
    const response = await article.post('/operationConfig/page', { pageNum, pageSize: 100 })
    const data = unwrapArticle<{
      records?: Array<{ id: number | string; siteName?: string; accountId?: number | string }>
      total?: number
    }>(response.data)
    const batch = data?.records ?? []
    total = Number(data?.total ?? records.length + batch.length)
    records.push(...batch)
    if (batch.length === 0) {
      break
    }
    pageNum += 1
  }
  return records
}

async function listAccounts(article: AxiosInstance): Promise<Map<string, string>> {
  const response = await article.get('/account/getAll')
  const data = unwrapArticle<Array<{ id?: number | string; name?: string }> | null>(response.data)
  const map = new Map<string, string>()
  for (const row of Array.isArray(data) ? data : []) {
    const id = String(row.id ?? '').trim()
    if (!id) {
      continue
    }
    map.set(id, String(row.name ?? '').trim() || `账户 ${id}`)
  }
  return map
}

function accountOf(
  row: { accountId?: number | string },
  detail: Record<string, unknown>,
  accounts: Map<string, string>,
): AccountInfo {
  const raw = detail.accountId ?? row.accountId
  const id = raw == null || raw === '' ? '' : String(raw).trim()
  if (!id) {
    return { id: '', name: '未分配账户' }
  }
  return { id, name: accounts.get(id) || `账户 ${id}` }
}

function sortSiteRows(rows: SiteRow[]): SiteRow[] {
  return [...rows].sort((a, b) => {
    if (a.revenue == null && b.revenue == null) {
      return a.label.localeCompare(b.label)
    }
    if (a.revenue == null) {
      return 1
    }
    if (b.revenue == null) {
      return -1
    }
    return b.revenue - a.revenue || a.label.localeCompare(b.label)
  })
}

function groupRowsByAccount(rows: SiteRow[]): Array<{ accountId: string; accountName: string; rows: SiteRow[] }> {
  const groups = new Map<string, { accountId: string; accountName: string; rows: SiteRow[] }>()
  for (const row of rows) {
    const key = row.accountId || '__none__'
    const current = groups.get(key)
    if (current) {
      current.rows.push(row)
      continue
    }
    groups.set(key, { accountId: row.accountId, accountName: row.accountName, rows: [row] })
  }
  return [...groups.values()]
    .map((group) => ({ ...group, rows: sortSiteRows(group.rows) }))
    .sort((a, b) => {
      const revenueA = a.rows.reduce((sum, row) => sum + (row.revenue ?? 0), 0)
      const revenueB = b.rows.reduce((sum, row) => sum + (row.revenue ?? 0), 0)
      return revenueB - revenueA || a.accountName.localeCompare(b.accountName)
    })
}

async function loadDetail(article: AxiosInstance, id: number | string) {
  const response = await article.get('/operationConfig/detail', { params: { id } })
  return unwrapArticle<Record<string, unknown>>(response.data) ?? {}
}

function buildAccountMessages(
  day: string,
  accountName: string,
  rows: SiteRow[],
  kind: 'today' | 'yesterday',
): string[] {
  const title = kind === 'yesterday' ? `运营配置昨日汇总 ${day}` : `运营配置今日汇总 ${day}`
  const scope = kind === 'yesterday' ? '昨日整天' : '今日截至当前'
  const source = sourceFromAccountName(accountName)
  const revenueTotal = rows.every((row) => row.revenue == null)
    ? null
    : rows.reduce((sum, row) => sum + (row.revenue ?? 0), 0)
  const header = [
    title,
    scope,
    `文章账户 ${accountName}${source ? ` · source ${source}` : ''}`,
    `域名 ${rows.length} 个 · 收入合计 ${revenueTotal == null ? '—' : formatMoney(revenueTotal)}`,
    '',
  ]
  const lines = rows.flatMap((row, index) => formatFeishuSiteLines(index + 1, row))
  const chunks: string[] = []
  let current = header.join('\n')
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line
    if (next.length > FEISHU_CHUNK && current) {
      chunks.push(current)
      current = `${title} · ${accountName}（续）\n\n${line}`
      continue
    }
    current = next
  }
  if (current) {
    chunks.push(current)
  }
  return chunks
}

async function sendFeishu(webhook: string, text: string) {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text },
    }),
  })
  const body = (await response.json()) as { code?: number; msg?: string }
  if (!response.ok || body.code !== 0) {
    throw new Error(body.msg || `飞书推送失败 HTTP ${response.status}`)
  }
}

async function summarizeConfig(input: {
  article: AxiosInstance
  mis: AxiosInstance
  row: { id: number | string; siteName?: string; accountId?: number | string }
  day: string
  today: string
  accounts: Map<string, string>
  kept: ReturnType<ReturnType<typeof openReportCache>['lookupConfigArticles']>
}): Promise<SiteRow | null> {
  const detail = await loadDetail(input.article, input.row.id)
  const label = siteLabel(input.row, detail)
  const account = accountOf(input.row, detail, input.accounts)
  const source = sourceFromAccountName(account.name)
  const recentItems = recentArticleItems(detail.recentArticles)
  const countryFromRecent = new Map<string, string>()
  for (const item of recentItems) {
    const articleId = articleIdFromUrl(item.url)
    if (articleId && item.countryCode.trim()) {
      countryFromRecent.set(articleId, item.countryCode.trim())
    }
  }
  const countryFromKept = new Map<string, string>()
  for (const item of input.kept) {
    if (item.day === input.day && item.articleId && String(item.countryCode ?? '').trim()) {
      countryFromKept.set(item.articleId, String(item.countryCode).trim())
    }
  }
  const current = articleLinks(recentItems.map((item) => item.url))
  const links = linksForReportDay(input.day, input.today, current, input.kept)
  const articleCountryCache = new Map<string, string>()
  const linksWithCountry: Array<{ articleId: string; channelId: string; countryCode: string }> = []
  for (const link of links) {
    let countryCode = resolveArticleCountry(link.articleId, countryFromRecent, countryFromKept)
    if (countryCode === '未标注') {
      if (!articleCountryCache.has(link.articleId)) {
        try {
          const response = await input.article.post('/article/detail', { id: link.articleId })
          const body = unwrapArticle<Record<string, unknown>>(response.data) ?? {}
          articleCountryCache.set(link.articleId, String(body.countryCode ?? '').trim())
        } catch {
          articleCountryCache.set(link.articleId, '')
        }
      }
      countryCode = resolveArticleCountry(
        link.articleId,
        new Map([[link.articleId, articleCountryCache.get(link.articleId) || '']]),
        new Map(),
      )
    }
    linksWithCountry.push({ ...link, countryCode })
  }
  const errors: string[] = []
  if (linksWithCountry.length === 0) {
    return null
  }
  if (!source) {
    errors.push(`账户 ${account.name || '未知'} 无法解析 source`)
  }

  const channels = [...new Set(linksWithCountry.map((link) => link.channelId).filter(Boolean))]
  const channelRevenueMap = new Map<string, number | null>()
  for (const channelId of channels) {
    if (!source) {
      channelRevenueMap.set(channelId, null)
      continue
    }
    try {
      channelRevenueMap.set(
        channelId,
        await channelRevenue(input.mis, {
          customChannelId: channelId,
          source,
          investor: process.env.FEISHU_REVENUE_INVESTOR?.trim() || process.env.VITE_REVENUE_INVESTOR?.trim() || 'jiayao',
          day: input.day,
        }),
      )
    } catch (error) {
      errors.push(`渠道 ${channelId} ${errorMessage(error)}`)
      channelRevenueMap.set(channelId, null)
    }
  }
  const revenues = [...channelRevenueMap.values()]
  const revenue =
    revenues.length === 0 || revenues.some((value) => value == null)
      ? null
      : revenues.reduce<number>((sum, value) => sum + (value ?? 0), 0)

  let pageViews = 0
  let termClicks = 0
  let adClicks = 0
  let stats = new Map<string, { pageViews: number; termClicks: number; adClicks: number }>()
  try {
    stats = await loadDailyStats(input.article, {
      subid2List: linksWithCountry.map((link) => link.articleId),
      day: input.day,
    })
    for (const link of linksWithCountry) {
      const stat = stats.get(`${link.articleId}\n${input.day}`)
      pageViews += stat?.pageViews ?? 0
      termClicks += stat?.termClicks ?? 0
      adClicks += stat?.adClicks ?? 0
    }
  } catch (error) {
    errors.push(`曝光点击 ${errorMessage(error)}`)
  }

  const countries = metricsByCountry(
    linksWithCountry,
    stats,
    input.day,
    revenueByCountry(linksWithCountry, channelRevenueMap),
  )

  return {
    label,
    accountId: account.id,
    accountName: account.name,
    revenue,
    pageViews,
    termClicks,
    adClicks,
    countries,
    errors,
  }
}

function readArgs(argv: string[]) {
  let limit = 0
  let dryRun = false
  let smoke = false
  let day = ''
  let forceYesterday = false
  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--smoke') {
      smoke = true
    } else if (arg === '--yesterday') {
      forceYesterday = true
    } else if (arg.startsWith('--limit=')) {
      limit = Math.max(0, Number(arg.slice('--limit='.length)) || 0)
    } else if (arg.startsWith('--day=')) {
      day = arg.slice('--day='.length).trim()
    }
  }
  return { limit, dryRun, smoke, day, forceYesterday }
}

async function main() {
  loadEnvFile(path.join(ROOT, '.env.local'))
  const { limit, dryRun, smoke, day: dayArg, forceYesterday } = readArgs(process.argv.slice(2))
  const webhook = requireEnv('FEISHU_WEBHOOK_URL')
  if (smoke) {
    await sendFeishu(webhook, `运营配置工作台飞书推送已接通\n时间 ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
    console.log('已发送连通测试')
    return
  }

  const articleTarget = requireEnv('VITE_ARTICLE_API_TARGET')
  const articleToken = requireEnv('VITE_ARTICLE_TOKEN')
  const misTarget = requireEnv('VITE_MIS_API_TARGET')
  const misToken = requireEnv('VITE_MIS_TOKEN')
  const misClientId = requireEnv('VITE_MIS_CLIENT_ID')
  const now = new Date()
  const selected = reportDay(now)
  const today = selected.today
  let day = selected.day
  let kind = selected.kind
  if (forceYesterday) {
    const previous = new Date(now)
    previous.setDate(previous.getDate() - 1)
    day = formatLocalDay(previous)
    kind = 'yesterday'
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dayArg)) {
    day = dayArg
    kind = day < today ? 'yesterday' : 'today'
  }

  const article = createClient(articleTarget, articleToken, '运营配置')
  const mis = createClient(misTarget, misToken, 'MIS', { ClientID: misClientId })
  const cachePath = path.join(ROOT, 'data', 'report-cache.db')
  const cache = fs.existsSync(cachePath) ? openReportCache(cachePath) : null

  const scopeLabel = kind === 'yesterday' ? '昨日整天' : '今日截至当前'
  console.log(`开始拉取 ${day}（${scopeLabel}）有推荐文章的运营配置汇总…`)
  const accounts = await listAccounts(article)
  let configs = await listAllConfigs(article)
  if (limit > 0) {
    configs = configs.slice(0, limit)
  }
  console.log(`共扫描 ${configs.length} 条配置，无推荐文章的会跳过；按文章账户拆分推送`)

  const rows: SiteRow[] = []
  const failures: string[] = []
  let skipped = 0
  for (const [index, row] of configs.entries()) {
    const labelHint = String(row.siteName ?? row.id)
    process.stdout.write(`[${index + 1}/${configs.length}] ${labelHint} … `)
    try {
      const kept = cache ? cache.lookupConfigArticles(String(row.id), day, day) : []
      const summary = await summarizeConfig({ article, mis, row, day, today, accounts, kept })
      if (!summary) {
        skipped += 1
        console.log('跳过（无推荐文章）')
        continue
      }
      rows.push(summary)
      if (summary.errors.length > 0) {
        failures.push(`${summary.accountName} · ${summary.label}：${summary.errors.slice(0, 2).join('；')}`)
      }
      console.log(
        `${summary.accountName} · 收入 ${summary.revenue == null ? '—' : formatMoney(summary.revenue)} / 曝光 ${summary.pageViews}`,
      )
    } catch (error) {
      failures.push(`${labelHint}：${errorMessage(error)}`)
      console.log(`失败 ${errorMessage(error)}`)
    }
  }
  console.log(`有推荐文章 ${rows.length} 条，跳过 ${skipped} 条`)

  const groups = groupRowsByAccount(rows)
  const messages: string[] = []
  if (groups.length === 0 && failures.length === 0) {
    messages.push(
      [
        kind === 'yesterday' ? `运营配置昨日汇总 ${day}` : `运营配置今日汇总 ${day}`,
        scopeLabel,
        '没有带推荐文章的运营配置，未推送明细。',
      ].join('\n'),
    )
  } else {
    for (const group of groups) {
      messages.push(...buildAccountMessages(day, group.accountName, group.rows, kind))
    }
    if (failures.length > 0) {
      const failLines = [
        kind === 'yesterday' ? `运营配置昨日汇总 ${day}` : `运营配置今日汇总 ${day}`,
        '失败明细',
        '',
        ...failures.slice(0, 30),
      ]
      if (failures.length > 30) {
        failLines.push(`……其余 ${failures.length - 30} 条略`)
      }
      messages.push(failLines.join('\n'))
    }
  }
  if (dryRun) {
    for (const [index, text] of messages.entries()) {
      console.log(`\n--- dry-run 消息 ${index + 1}/${messages.length} ---\n${text}`)
    }
  } else {
    for (const [index, text] of messages.entries()) {
      await sendFeishu(webhook, text)
      console.log(`已推送飞书 ${index + 1}/${messages.length}`)
    }
  }
  cache?.close()
  console.log('完成')
}

main().catch((error) => {
  console.error(errorMessage(error))
  process.exitCode = 1
})
