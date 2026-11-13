<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getAccountList,
  getArticleDetail,
  getLanguageList,
  getOperationConfigDetail,
  getOperationConfigPage,
  getSiteList,
  updateOperationConfig,
  type AccountOption,
  type LanguageOption,
  type OperationConfigRow,
  type SiteOption,
} from '../api/article'
import { createArticleJob, getArticleJob, platformUserFromToken } from '../api/articleJobs'
import ArticleDraftDrawer from './ArticleDraftDrawer.vue'
import { createCampaign } from '../api/mis'
import { listSubid2DailyStat } from '../api/report'
import { lookupReportCache } from '../api/reportCache'
import { errorMessage } from '../api/http'
import { serviceConfig } from '../config/env'
import { resolveLandingUrl, type ExistingArticleLink } from '../domain/autoArticleWrite'
import { articleDomain } from '../domain/batch'
import { bareDomain, isTerminalJobStatus, type ArticleJobResultItem } from '../domain/articleJobStore'
import { ARTICLE_REGIONS } from '../domain/articleRegions'
import { channelFromUrl } from '../domain/campaignForm'
import { dayBeforeAndYesterday } from '../domain/dashboardStore'
import { articleDayStatMap, articleIdFromUrl, sourceFromAccountName } from '../domain/report'
import { articleCacheKey } from '../domain/reportCache'
import { applyGeneratedUrl, buildUpdatePayload, recentArticleItems } from '../domain/recentArticles'
import { replaceCandidates, type InsightArticleDay, type ReplaceCandidateRow } from '../domain/reportInsights'

const POLL_MS = 7000

export interface ReplaceOpsRow extends ReplaceCandidateRow {
  domain: string
  accountName: string
  accountSource: string
  accountId: number | string
  siteId: number | string
  configId: string
  oldUrl: string
  seedKeyword: string
  day: string
  prevPageViews: number
  prevAdClicks: number
}

interface ReplacePendingJob {
  key: string
  taskId: string
  configId: string
  domain: string
  accountId: number | string
  siteId: number | string
  accountName: string
  accountSource: string
  oldArticleId: string
  oldUrl: string
  seedKeyword: string
  regionId: string
  languageId: number
  /** ready = 草稿已生成，可预览；writing/done 留给后续确认换文 */
  status: 'running' | 'ready' | 'writing' | 'done' | 'failed'
  note: string
  itemId?: string | number
  newArticleId?: string
  newUrl?: string
}

const accounts = ref<AccountOption[]>([])
const sites = ref<SiteOption[]>([])
const languages = ref<LanguageOption[]>([])
const filterAccountIds = ref<Array<number | string>>([])
const filterSiteIds = ref<Array<number | string>>([])
const loading = ref(false)
const generating = ref(false)
const polling = ref(false)
const progress = ref('')
const refreshedAt = ref('')
const compareDays = ref<{ dayBefore: string; yesterday: string } | null>(null)
const rows = ref<ReplaceOpsRow[]>([])
const selectedKeys = ref<string[]>([])
const warnings = ref<string[]>([])
const pendingJobs = ref<ReplacePendingJob[]>([])
let replacePollTimer = 0

const draftOpen = ref(false)
const draftTaskId = ref('')
const draftItemId = ref<string | number>('')
const draftSubtitle = ref('')

const selectedCount = computed(() => selectedKeys.value.length)
const busy = computed(() => loading.value || generating.value)
const canRefreshPending = computed(() => pendingJobs.value.some((job) => job.status === 'running'))

const filterSiteOptions = computed(() => {
  const accountSet = new Set(filterAccountIds.value.map(String))
  return sites.value
    .filter((site) => site.isPass !== false)
    .filter((site) => (accountSet.size === 0 ? false : accountSet.has(String(site.accountId))))
    .map((site) => {
      const domain = bareDomain(articleDomain(site) || site.siteName)
      return {
        id: site.id,
        label: domain || String(site.siteName || site.id),
        domain,
        disabled: !domain,
      }
    })
    .filter((item) => item.domain)
    .sort((a, b) => a.label.localeCompare(b.label))
})

const canScan = computed(() => filterSiteIds.value.length > 0 && !busy.value)

watch(filterAccountIds, () => {
  const allowed = new Set(filterSiteOptions.value.map((item) => String(item.id)))
  filterSiteIds.value = filterSiteIds.value.filter((id) => allowed.has(String(id)))
})

function rowKey(row: ReplaceOpsRow): string {
  return `${row.configId}:${row.articleId}`
}

function accountNameById(id: unknown): string {
  if (id == null || id === '') {
    return ''
  }
  return accounts.value.find((item) => String(item.id) === String(id))?.name?.trim() || ''
}

function domainOfConfig(row: OperationConfigRow, detail: Record<string, unknown>): string {
  const site = sites.value.find((item) => item.id == row.siteId || item.id == detail.siteId)
  return bareDomain(articleDomain(site) || String(row.siteName || detail.siteName || ''))
}

function wholeCount(value: number | null | undefined): number {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number) || number < 0) {
    return 0
  }
  return Math.round(number)
}

async function loadMeta() {
  const [accountList, siteList, languageList] = await Promise.all([
    getAccountList(),
    getSiteList(),
    getLanguageList(),
  ])
  accounts.value = accountList
  sites.value = siteList
  languages.value = languageList
}

async function loadConfigsForSites(siteIds: Array<number | string>): Promise<OperationConfigRow[]> {
  const pageSize = 50
  const wanted = new Set(siteIds.map(String))
  const all: OperationConfigRow[] = []
  // 按选中站点分别拉配置，避免全站翻页
  for (const [index, siteId] of siteIds.entries()) {
    progress.value = `读取站点配置 ${index + 1}/${siteIds.length}`
    let pageNum = 1
    let total = Number.POSITIVE_INFINITY
    let loaded = 0
    while (loaded < total) {
      const result = await getOperationConfigPage({ pageNum, pageSize, siteId })
      total = result.total
      for (const row of result.records) {
        if (wanted.has(String(row.siteId ?? siteId))) {
          all.push(row)
        }
      }
      loaded += result.records.length
      if (result.records.length === 0) {
        break
      }
      pageNum += 1
    }
  }
  return all
}

function articleIdFromRecent(url: string, rawId: unknown): string {
  if (typeof rawId === 'string' && /^\d+$/.test(rawId.trim())) {
    return rawId.trim()
  }
  if (typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0) {
    return String(rawId)
  }
  return articleIdFromUrl(url)
}

/** 与域名日报同款：先本地缓存，再批量拉，失败则逐篇，避免整批失败变成全 0 */
async function loadArticleStats(articleIds: string[], startDay: string, endDay: string) {
  const articleStats = new Map<string, { pageViews: number; termClicks: number; adClicks: number }>()
  const ids = [...new Set(articleIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) {
    return articleStats
  }

  try {
    progress.value = '读取本地曝光缓存…'
    const cached = await lookupReportCache({
      articleIds: ids,
      channelIds: [],
      investor: '',
      start: startDay,
      end: endDay,
    })
    for (const row of cached.articles) {
      if (row.day !== startDay && row.day !== endDay) {
        continue
      }
      articleStats.set(articleCacheKey(row.articleId, row.day), {
        pageViews: wholeCount(row.pageViews),
        termClicks: wholeCount(row.termClicks),
        adClicks: wholeCount(row.adClicks),
      })
    }
  } catch (error) {
    warnings.value.push(`本地缓存 ${errorMessage(error)}`)
  }

  const missing = ids.filter((id) => {
    const hasStart = articleStats.has(articleCacheKey(id, startDay))
    const hasEnd = articleStats.has(articleCacheKey(id, endDay))
    return !hasStart || !hasEnd
  })
  if (missing.length === 0) {
    return articleStats
  }

  const merge = (stats: ReturnType<typeof articleDayStatMap>) => {
    for (const [key, stat] of stats.entries()) {
      articleStats.set(key, {
        pageViews: wholeCount(stat.pageViews),
        termClicks: wholeCount(stat.termClicks),
        adClicks: wholeCount(stat.adClicks),
      })
    }
  }

  try {
    progress.value = `曝光统计批量 ${missing.length} 篇`
    merge(
      articleDayStatMap(
        await listSubid2DailyStat({
          subid2List: missing,
          startDate: startDay,
          endDate: endDay,
          keywordLimit: 20,
        }),
      ),
    )
  } catch (error) {
    warnings.value.push(`曝光批量失败，改逐篇：${errorMessage(error)}`)
    for (const [index, articleId] of missing.entries()) {
      progress.value = `曝光逐篇 ${index + 1}/${missing.length}`
      try {
        merge(
          articleDayStatMap(
            await listSubid2DailyStat({
              subid2List: [articleId],
              startDate: startDay,
              endDate: endDay,
              keywordLimit: 20,
            }),
          ),
        )
      } catch (itemError) {
        warnings.value.push(`文章 ${articleId} ${errorMessage(itemError)}`)
      }
    }
  }

  // 批量成功但个别文章仍缺日：补逐篇，避免静默当 0
  const stillMissing = missing.filter((id) => {
    return !articleStats.has(articleCacheKey(id, startDay)) || !articleStats.has(articleCacheKey(id, endDay))
  })
  for (const [index, articleId] of stillMissing.entries()) {
    progress.value = `补拉曝光 ${index + 1}/${stillMissing.length}`
    try {
      merge(
        articleDayStatMap(
          await listSubid2DailyStat({
            subid2List: [articleId],
            startDate: startDay,
            endDate: endDay,
            keywordLimit: 20,
          }),
        ),
      )
    } catch (itemError) {
      warnings.value.push(`文章 ${articleId} ${errorMessage(itemError)}`)
    }
  }

  return articleStats
}

async function refresh() {
  if (loading.value) {
    return
  }
  if (filterSiteIds.value.length === 0) {
    ElMessage.warning('请先选择要扫描的域名')
    return
  }
  loading.value = true
  progress.value = '读取运营配置…'
  warnings.value = []
  selectedKeys.value = []
  try {
    if (accounts.value.length === 0 || sites.value.length === 0) {
      await loadMeta()
    }
    const { dayBefore, yesterday } = dayBeforeAndYesterday()
    compareDays.value = { dayBefore, yesterday }
    const selectedSiteIdSet = new Set(filterSiteIds.value.map(String))
    const selectedDomains = new Set(
      filterSiteOptions.value.filter((item) => selectedSiteIdSet.has(String(item.id))).map((item) => item.domain),
    )
    const configs = await loadConfigsForSites(filterSiteIds.value)
    type Bucket = {
      domain: string
      accountName: string
      accountSource: string
      accountId: number | string
      siteId: number | string
      configId: string
      articles: Array<{ articleId: string; channelId: string; countryCode: string; url: string }>
    }
    const buckets: Bucket[] = []
    const allArticleIds: string[] = []
    const seedByKey = new Map(rows.value.map((row) => [rowKey(row), row.seedKeyword]))

    for (const [index, row] of configs.entries()) {
      progress.value = `读取配置 ${index + 1}/${configs.length}`
      let detail: Record<string, unknown>
      try {
        detail = await getOperationConfigDetail(row.id)
      } catch (error) {
        warnings.value.push(`配置 ${row.id} ${errorMessage(error)}`)
        continue
      }
      const rawRecent = detail.recentArticles ?? row.recentArticles
      const items = recentArticleItems(rawRecent)
      if (items.length === 0) {
        continue
      }
      const domain = domainOfConfig(row, detail)
      if (!domain) {
        warnings.value.push(`配置 ${row.id} 没有域名`)
        continue
      }
      if (selectedDomains.size > 0 && !selectedDomains.has(domain)) {
        continue
      }
      const rawAccountId = detail.accountId ?? row.accountId
      if (typeof rawAccountId !== 'string' && typeof rawAccountId !== 'number') {
        warnings.value.push(`配置 ${row.id} 没有账户`)
        continue
      }
      if (rawAccountId === '') {
        warnings.value.push(`配置 ${row.id} 没有账户`)
        continue
      }
      const accountId: number | string = rawAccountId
      const rawSiteId = detail.siteId ?? row.siteId
      if (typeof rawSiteId !== 'string' && typeof rawSiteId !== 'number') {
        warnings.value.push(`配置 ${row.id} 没有站点`)
        continue
      }
      if (rawSiteId === '') {
        warnings.value.push(`配置 ${row.id} 没有站点`)
        continue
      }
      const siteId: number | string = rawSiteId
      const accountName = accountNameById(accountId)
      const accountSource = sourceFromAccountName(accountName)
      const rawList = Array.isArray(rawRecent) ? rawRecent : []
      const articles = items
        .map((item, itemIndex) => {
          const raw = rawList[itemIndex]
          const rawId = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined
          const articleId = articleIdFromRecent(item.url, rawId)
          if (!articleId) {
            return null
          }
          return {
            articleId,
            channelId: channelFromUrl(item.url),
            countryCode: item.countryCode,
            url: item.url,
          }
        })
        .filter(
          (item): item is { articleId: string; channelId: string; countryCode: string; url: string } => item != null,
        )
      const unique = new Map<string, (typeof articles)[number]>()
      for (const article of articles) {
        if (!unique.has(article.articleId)) {
          unique.set(article.articleId, article)
        }
      }
      const uniqueArticles = [...unique.values()]
      if (uniqueArticles.length === 0) {
        continue
      }
      for (const article of uniqueArticles) {
        allArticleIds.push(article.articleId)
      }
      buckets.push({
        domain,
        accountName,
        accountSource,
        accountId,
        siteId,
        configId: String(row.id),
        articles: uniqueArticles,
      })
    }

    const stats = await loadArticleStats(allArticleIds, dayBefore, yesterday)
    let statHits = 0
    const nextRows: ReplaceOpsRow[] = []
    for (const bucket of buckets) {
      const newest: InsightArticleDay[] = bucket.articles.map((article) => {
        const key = articleCacheKey(article.articleId, yesterday)
        const stat = stats.get(key)
        if (stat) {
          statHits += 1
        }
        return {
          day: yesterday,
          articleId: article.articleId,
          channelId: article.channelId,
          pageViews: wholeCount(stat?.pageViews),
          termClicks: wholeCount(stat?.termClicks),
          adClicks: wholeCount(stat?.adClicks),
          countryCode: article.countryCode,
          kept: false,
        }
      })
      const older: InsightArticleDay[] = bucket.articles.map((article) => {
        const key = articleCacheKey(article.articleId, dayBefore)
        const stat = stats.get(key)
        if (stat) {
          statHits += 1
        }
        return {
          day: dayBefore,
          articleId: article.articleId,
          channelId: article.channelId,
          pageViews: wholeCount(stat?.pageViews),
          termClicks: wholeCount(stat?.termClicks),
          adClicks: wholeCount(stat?.adClicks),
          countryCode: article.countryCode,
          kept: false,
        }
      })
      const olderMap = new Map(older.map((item) => [item.articleId, item]))
      const articleById = new Map(bucket.articles.map((item) => [item.articleId, item]))
      for (const candidate of replaceCandidates([newest, older])) {
        const prev = olderMap.get(candidate.articleId)
        const source = articleById.get(candidate.articleId)
        const key = `${bucket.configId}:${candidate.articleId}`
        nextRows.push({
          ...candidate,
          domain: bucket.domain,
          accountName: bucket.accountName,
          accountSource: bucket.accountSource,
          accountId: bucket.accountId,
          siteId: bucket.siteId,
          configId: bucket.configId,
          oldUrl: source?.url || '',
          seedKeyword: seedByKey.get(key) || '',
          day: yesterday,
          prevPageViews: prev?.pageViews ?? 0,
          prevAdClicks: prev?.adClicks ?? 0,
        })
      }
    }

    nextRows.sort(
      (a, b) =>
        a.pageViews - b.pageViews ||
        a.adClicks - b.adClicks ||
        a.domain.localeCompare(b.domain) ||
        a.articleId.localeCompare(b.articleId),
    )
    rows.value = nextRows
    refreshedAt.value = new Date().toLocaleString()
    progress.value = ''
    const expectedHits = allArticleIds.length * 2
    ElMessage.success(
      `扫描完成：${filterSiteIds.value.length} 个域名 → ${nextRows.length} 篇建议替换；曝光命中 ${statHits}/${expectedHits}（${dayBefore} / ${yesterday}）`,
    )
    if (expectedHits > 0 && statHits === 0) {
      ElMessage.warning('曝光统计一条都没命中，结果会偏空；请先在域名日报里查过这两天，或看下方告警')
    }
    if (warnings.value.length) {
      ElMessage.warning(`有 ${warnings.value.length} 条告警`)
    }
  } catch (error) {
    progress.value = ''
    ElMessage.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}

function onSelectionChange(selection: ReplaceOpsRow[]) {
  selectedKeys.value = selection.map(rowKey)
}

function patchPending(key: string, patch: Partial<ReplacePendingJob>) {
  pendingJobs.value = pendingJobs.value.map((job) => (job.key === key ? { ...job, ...patch } : job))
}

function regionFromCountry(code: string): string {
  const upper = String(code || '')
    .trim()
    .toUpperCase()
  if (!upper) {
    return ''
  }
  if (upper === 'VN') {
    return 'VI'
  }
  if (ARTICLE_REGIONS.some((item) => item.code === upper)) {
    return upper
  }
  return ''
}

async function languageIdForArticle(articleId: string): Promise<number> {
  const detail = await getArticleDetail(articleId)
  const langId = Number(detail.langId)
  if (Number.isFinite(langId) && langId > 0) {
    return langId
  }
  const english = languages.value.find((item) => String(item.langCode || '').toLowerCase() === 'en')
  if (english != null && english.id !== '' && Number(english.id) > 0) {
    return Number(english.id)
  }
  const first = languages.value[0]
  if (first != null && Number(first.id) > 0) {
    return Number(first.id)
  }
  throw new Error(`文章 ${articleId} 无法确定语言`)
}

function languageLabel(id: number): string {
  const found = languages.value.find((item) => Number(item.id) === id)
  if (!found) {
    return String(id)
  }
  const name = found.langName?.trim() || found.langCode?.trim() || String(found.id)
  return found.langCode ? `${name}（${found.langCode}）` : name
}

function statusText(status: ReplacePendingJob['status']): string {
  const map: Record<ReplacePendingJob['status'], string> = {
    running: '生成中',
    ready: '可预览',
    writing: '写入中',
    done: '已完成',
    failed: '失败',
  }
  return map[status] || status
}

function afsSourceForAccount(accountId: number | string | undefined, accountName: string, accountSource: string): string {
  const source = accountSource || sourceFromAccountName(accountName)
  if (!source) {
    throw new Error(`账户 ${accountName || accountId || '未知'} 无法映射 AFS source（需要 A数字）`)
  }
  return source
}

async function loadExistingArticleLinks(
  items: Array<{ url: string; countryCode: string }>,
): Promise<ExistingArticleLink[]> {
  const links: ExistingArticleLink[] = []
  for (const item of items) {
    const url = item.url.trim()
    if (!url) {
      continue
    }
    const channelId = channelFromUrl(url)
    let countryCode = String(item.countryCode ?? '').trim()
    if (!countryCode) {
      const articleId = articleIdFromUrl(url)
      if (articleId) {
        try {
          const article = await getArticleDetail(articleId)
          countryCode = String(article.countryCode ?? '').trim()
        } catch {
          countryCode = ''
        }
      }
    }
    links.push({ url, countryCode, channelId })
  }
  return links
}

function pickSuccessResult(results: ArticleJobResultItem[] | undefined, domain: string): ArticleJobResultItem | null {
  const want = bareDomain(domain)
  for (const item of results || []) {
    if (String(item.status).toLowerCase() !== 'success') {
      continue
    }
    if (item.id == null || String(item.id).trim() === '') {
      continue
    }
    if (want && bareDomain(item.domain) && bareDomain(item.domain) !== want) {
      continue
    }
    return item
  }
  return null
}

function openDraft(job: ReplacePendingJob) {
  if (job.itemId == null || String(job.itemId).trim() === '') {
    ElMessage.warning('还没有可预览的草稿子项')
    return
  }
  draftTaskId.value = job.taskId
  draftItemId.value = job.itemId
  draftSubtitle.value = `${job.domain} · 旧文 ${job.oldArticleId} · ${job.seedKeyword}`
  draftOpen.value = true
}

async function writeAndReplace(job: ReplacePendingJob, newArticleId: string): Promise<{ url: string; note: string }> {
  const detail = await getOperationConfigDetail(job.configId)
  if (detail.id == null || detail.id === '') {
    throw new Error(`找不到配置 ${job.configId}`)
  }
  const recentItems = recentArticleItems(detail.recentArticles)
  const currentUrls = recentItems.map((row) => row.url)
  const oldIndex = currentUrls.findIndex(
    (url) => url === job.oldUrl || articleIdFromUrl(url) === job.oldArticleId,
  )
  if (oldIndex < 0) {
    throw new Error('运营配置里找不到旧文链接')
  }
  const existingNewUrl = currentUrls.find((url) => articleIdFromUrl(url) === newArticleId)
  if (existingNewUrl) {
    if (articleIdFromUrl(currentUrls[oldIndex] || '') === newArticleId) {
      return { url: existingNewUrl, note: '新文已在配置中（旧位已是该文）' }
    }
    const next = currentUrls.slice()
    next[oldIndex] = existingNewUrl
    const urls = next.filter((url, index) => index === oldIndex || articleIdFromUrl(url) !== newArticleId)
    await updateOperationConfig(buildUpdatePayload(detail, urls))
    return { url: existingNewUrl, note: '新文已在配置中，已换下旧文' }
  }
  const existing = await loadExistingArticleLinks(recentItems)
  const resolved = await resolveLandingUrl({
    domain: job.domain,
    articleId: newArticleId,
    countryCode: job.regionId,
    intentKeyword: job.seedKeyword,
    existing,
    afsSource: afsSourceForAccount(job.accountId, job.accountName, job.accountSource),
    createCampaign,
  })
  const applied = applyGeneratedUrl(currentUrls, 'replace', oldIndex, resolved.url)
  if (!applied.ok) {
    throw new Error(applied.reason)
  }
  await updateOperationConfig(buildUpdatePayload(detail, applied.urls))
  const mode = resolved.reusedChannel ? `复用渠道 ${resolved.channelId}` : `MIS 新建渠道 ${resolved.channelId}`
  return { url: resolved.url, note: `已写入并换下旧文（${mode}）` }
}

function ensureReplacePoll() {
  if (replacePollTimer) {
    return
  }
  replacePollTimer = window.setInterval(() => {
    void pollReplaceJobs()
  }, POLL_MS)
}

function stopReplacePollIfIdle() {
  const active = pendingJobs.value.some((job) => job.status === 'running' || job.status === 'writing')
  if (active || !replacePollTimer) {
    return
  }
  window.clearInterval(replacePollTimer)
  replacePollTimer = 0
}

async function pollReplaceJobs(options: { manual?: boolean } = {}) {
  const running = pendingJobs.value.filter((job) => job.status === 'running')
  if (running.length === 0) {
    stopReplacePollIfIdle()
    return
  }
  if (polling.value) {
    return
  }
  polling.value = true
  try {
    for (const job of running) {
      try {
        const detail = await getArticleJob(job.taskId)
        if (!isTerminalJobStatus(detail.status)) {
          const p = detail.progress
          patchPending(job.key, {
            note: p ? `生成中 ${p.success}/${p.total}` : `状态 ${detail.status}`,
          })
          continue
        }
        if (String(detail.status) === 'failed') {
          patchPending(job.key, {
            status: 'failed',
            note: detail.error_message || '生成失败',
          })
          continue
        }
        const result = pickSuccessResult(detail.results, job.domain)
        if (!result) {
          patchPending(job.key, {
            status: 'failed',
            note: detail.error_message || '生成结束但没有成功草稿',
          })
          continue
        }
        const newArticleId =
          result.article_id == null || String(result.article_id).trim() === ''
            ? undefined
            : String(result.article_id).trim()
        patchPending(job.key, {
          status: 'ready',
          itemId: result.id,
          newArticleId,
          note: newArticleId ? `草稿已生成（已有 article_id ${newArticleId}），可查看` : '草稿已生成，可查看内容（尚未自动换文）',
        })
      } catch (error) {
        patchPending(job.key, {
          note: `轮询暂时失败（可点立即刷新，也会自动重试）：${errorMessage(error)}`,
        })
        if (options.manual) {
          ElMessage.warning(`${job.oldArticleId}：${errorMessage(error)}`)
        }
      }
    }
  } finally {
    polling.value = false
    stopReplacePollIfIdle()
  }
}

function refreshPending() {
  ensureReplacePoll()
  void pollReplaceJobs({ manual: true })
}

async function retryWrite(job: ReplacePendingJob) {
  const newArticleId = String(job.newArticleId || '').trim()
  if (!newArticleId) {
    ElMessage.warning('还没有新文章，无法重试写入')
    return
  }
  if (job.status === 'writing' || polling.value) {
    return
  }
  patchPending(job.key, {
    status: 'writing',
    note: '正在重试写入…',
  })
  ensureReplacePoll()
  try {
    const written = await writeAndReplace(job, newArticleId)
    patchPending(job.key, {
      status: 'done',
      newArticleId,
      newUrl: written.url,
      note: written.note,
    })
    ElMessage.success(`${job.oldArticleId} 已写入`)
  } catch (error) {
    patchPending(job.key, {
      status: 'failed',
      newArticleId,
      note: `写入失败：${errorMessage(error)}`,
    })
    ElMessage.error(errorMessage(error))
  } finally {
    stopReplacePollIfIdle()
  }
}

async function generateSelected() {
  if (generating.value) {
    return
  }
  const selected = rows.value.filter((row) => selectedKeys.value.includes(rowKey(row)))
  if (selected.length === 0) {
    ElMessage.warning('先勾选要生成替补的文章')
    return
  }
  const missingSeed = selected.filter((row) => !row.seedKeyword.trim())
  if (missingSeed.length > 0) {
    ElMessage.warning(`还有 ${missingSeed.length} 篇没填种子词（一篇一个）`)
    return
  }
  const missingCountry = selected.filter((row) => !regionFromCountry(row.countryCode))
  if (missingCountry.length > 0) {
    ElMessage.warning(`有 ${missingCountry.length} 篇没有可用国家码，无法对齐地区`)
    return
  }

  generating.value = true
  progress.value = '创建替补任务…'
  let success = 0
  const failures: string[] = []
  try {
    const user = platformUserFromToken(serviceConfig.articleToken)
    const stamp = Date.now()
    for (const [index, row] of selected.entries()) {
      const key = rowKey(row)
      const seed = row.seedKeyword.trim()
      progress.value = `创建替补 ${index + 1}/${selected.length}：${row.articleId}`
      try {
        if (
          pendingJobs.value.some(
            (job) => job.key === key && (job.status === 'running' || job.status === 'writing'),
          )
        ) {
          failures.push(`${row.articleId}：已有进行中的任务`)
          continue
        }
        if (!row.oldUrl) {
          throw new Error('缺少旧文链接')
        }
        const regionId = regionFromCountry(row.countryCode)
        const languageId = await languageIdForArticle(row.articleId)
        const detail = await createArticleJob({
          intentKeyword: seed,
          languageId,
          regionId,
          userId: user.userId,
          userName: user.userName,
          targets: [
            {
              domain: row.domain,
              site_id: row.siteId,
              account_id: row.accountId,
            },
          ],
          publish: false,
          articlesPerDomain: 1,
          idempotencyKey: `replace-${stamp}-${key}-${Math.random().toString(36).slice(2, 10)}`,
        })
        const taskId = String(detail.task_id || '').trim()
        if (!taskId) {
          throw new Error('未返回 task_id')
        }
        const nextJob: ReplacePendingJob = {
          key,
          taskId,
          configId: row.configId,
          domain: row.domain,
          accountId: row.accountId,
          siteId: row.siteId,
          accountName: row.accountName,
          accountSource: row.accountSource,
          oldArticleId: row.articleId,
          oldUrl: row.oldUrl,
          seedKeyword: seed,
          regionId,
          languageId,
          status: 'running',
          note: `已创建草稿任务 · ${languageLabel(languageId)} · ${regionId}`,
        }
        pendingJobs.value = [nextJob, ...pendingJobs.value.filter((job) => job.key !== key)]
        success += 1
      } catch (error) {
        failures.push(`${row.articleId}：${errorMessage(error)}`)
      }
    }
    if (success > 0) {
      ensureReplacePoll()
      void pollReplaceJobs()
      ElMessage.success(`已创建 ${success} 个草稿任务，完成后可在抽屉查看，不会自动换文`)
    }
    if (failures.length > 0) {
      warnings.value = [...failures, ...warnings.value].slice(0, 40)
      if (success === 0) {
        ElMessage.error(failures[0] || '创建失败')
      } else {
        ElMessage.warning(`成功 ${success} 个，失败 ${failures.length} 个`)
      }
    }
  } finally {
    generating.value = false
    progress.value = ''
  }
}

onMounted(() => {
  void loadMeta()
})

onUnmounted(() => {
  if (replacePollTimer) {
    window.clearInterval(replacePollTimer)
    replacePollTimer = 0
  }
})
</script>

<template>
  <div class="replace-ops">
    <header class="hero">
      <div>
        <p class="eyebrow">半自动换文</p>
        <h3>换文待办</h3>
        <p class="hint">
          先选账户和域名再扫描「该换」文章（完整日：前天 vs 昨天）。勾选后每行填一个种子词；走 AI 编排仅生成草稿，完成后在抽屉查看内容，本阶段不自动换文。
          <template v-if="compareDays">当前对比 {{ compareDays.dayBefore }} → {{ compareDays.yesterday }}。</template>
        </p>
      </div>
      <div class="hero-actions">
        <span class="meta">上次扫描 {{ refreshedAt || '尚未扫描' }}</span>
        <el-button type="primary" :loading="loading" :disabled="!canScan" @click="refresh">
          扫描所选（{{ filterSiteIds.length }}）
        </el-button>
        <el-button type="success" :loading="generating" :disabled="busy || selectedCount === 0" @click="generateSelected">
          生成替补（{{ selectedCount }}）
        </el-button>
      </div>
    </header>

    <section class="panel filters">
      <div class="panel-head">
        <h4>扫描范围</h4>
        <span>至少选一个域名；不会默认扫全站</span>
      </div>
      <div class="filter-row">
        <el-select
          v-model="filterAccountIds"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          clearable
          placeholder="账户（可多选）"
          :disabled="busy"
        >
          <el-option v-for="account in accounts" :key="account.id" :label="account.name" :value="account.id" />
        </el-select>
        <el-select
          v-model="filterSiteIds"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          clearable
          placeholder="域名（先选账户）"
          :disabled="busy || filterAccountIds.length === 0"
        >
          <el-option
            v-for="site in filterSiteOptions"
            :key="site.id"
            :label="site.label"
            :value="site.id"
            :disabled="site.disabled"
          />
        </el-select>
      </div>
    </section>

    <p v-if="progress" class="progress">{{ progress }}</p>

    <section class="panel">
      <div class="panel-head">
        <h4>该换列表（{{ rows.length }}）</h4>
        <span>一篇一个种子词；规则：近两日曝光均为 0，或昨天广点为 0 且曝光不高于同域中位数</span>
      </div>
      <el-table
        :data="rows"
        size="small"
        height="520"
        empty-text="先选域名后点「扫描所选」"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="42" />
        <el-table-column label="域名" min-width="150" fixed>
          <template #default="{ row }">
            <span>{{ row.domain }}</span>
            <em v-if="row.accountName" class="acct">{{ row.accountName }}</em>
          </template>
        </el-table-column>
        <el-table-column label="种子词" min-width="180" fixed>
          <template #default="{ row }">
            <el-input v-model="row.seedKeyword" size="small" clearable placeholder="本篇替补种子词" :disabled="busy" />
          </template>
        </el-table-column>
        <el-table-column label="文章 ID" min-width="120">
          <template #default="{ row }"><code>{{ row.articleId }}</code></template>
        </el-table-column>
        <el-table-column label="渠道" width="110">
          <template #default="{ row }"><code>{{ row.channelId || '—' }}</code></template>
        </el-table-column>
        <el-table-column prop="countryCode" label="国家" width="72" align="center">
          <template #default="{ row }">{{ row.countryCode || '—' }}</template>
        </el-table-column>
        <el-table-column label="前天曝光" width="88" align="right">
          <template #default="{ row }">{{ row.prevPageViews }}</template>
        </el-table-column>
        <el-table-column label="昨天曝光" width="88" align="right">
          <template #default="{ row }">{{ row.pageViews }}</template>
        </el-table-column>
        <el-table-column label="昨天广点" width="88" align="right">
          <template #default="{ row }">{{ row.adClicks }}</template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" min-width="200" />
        <el-table-column label="配置" width="72" align="right">
          <template #default="{ row }">{{ row.configId }}</template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div class="panel-head-main">
          <h4>进度（{{ pendingJobs.length }}）</h4>
          <span>每 7 秒轮询；超时不会判失败，可点立即刷新。成功后可查看草稿，不会自动换文。</span>
        </div>
        <el-button
          size="small"
          :loading="polling"
          :disabled="!canRefreshPending || generating"
          @click="refreshPending"
        >
          立即刷新
        </el-button>
      </div>
      <el-table v-if="pendingJobs.length" :data="pendingJobs" size="small" empty-text="暂无任务">
        <el-table-column label="域名" min-width="140">
          <template #default="{ row }">{{ row.domain }}</template>
        </el-table-column>
        <el-table-column label="旧文" min-width="120">
          <template #default="{ row }"><code>{{ row.oldArticleId }}</code></template>
        </el-table-column>
        <el-table-column label="种子词" min-width="140">
          <template #default="{ row }">{{ row.seedKeyword }}</template>
        </el-table-column>
        <el-table-column label="国家/语言" width="150">
          <template #default="{ row }">{{ row.regionId }} · {{ languageLabel(row.languageId) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="88">
          <template #default="{ row }">
            <span :class="['status', row.status]">{{ statusText(row.status) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="子项/新文" min-width="140">
          <template #default="{ row }">
            <code v-if="row.newArticleId">{{ row.newArticleId }}</code>
            <code v-else-if="row.itemId != null">item {{ row.itemId }}</code>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="220">
          <template #default="{ row }">{{ row.note }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'running'"
              link
              type="primary"
              size="small"
              :loading="polling"
              @click="refreshPending"
            >
              重试查询
            </el-button>
            <el-button
              v-else-if="row.status === 'ready' || (row.itemId != null && row.status !== 'failed')"
              link
              type="primary"
              size="small"
              @click="openDraft(row)"
            >
              查看文章
            </el-button>
            <el-button
              v-else-if="row.status === 'failed' && row.newArticleId"
              link
              type="primary"
              size="small"
              @click="retryWrite(row)"
            >
              重试写入
            </el-button>
            <span v-else class="op-empty">—</span>
          </template>
        </el-table-column>
      </el-table>
      <p v-else class="pending-empty">还没有替补任务。勾选文章、填种子词后点「生成替补」。</p>
    </section>

    <section v-if="warnings.length" class="warnings">
      <h4>告警（{{ warnings.length }}）</h4>
      <ul>
        <li v-for="(item, index) in warnings" :key="`${index}-${item}`">{{ item }}</li>
      </ul>
    </section>

    <ArticleDraftDrawer
      v-model="draftOpen"
      :task-id="draftTaskId"
      :item-id="draftItemId"
      :subtitle="draftSubtitle"
    />
  </div>
</template>

<style scoped>
.replace-ops {
  display: grid;
  gap: 16px;
  max-width: 1440px;
  margin: 0 auto;
}

.hero {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-end;
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);
}

.eyebrow {
  margin: 0 0 4px;
  color: var(--blue);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

h3,
h4 {
  margin: 0;
}

h3 {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

h4 {
  font-size: 14px;
  font-weight: 650;
}

.hint,
.meta,
.progress {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.filter-row {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) minmax(240px, 1.4fr);
  gap: 10px;
}

@media (max-width: 720px) {
  .filter-row {
    grid-template-columns: 1fr;
  }
}

.panel,
.warnings {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #fff;
  padding: 16px;
}

.panel-head {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.panel-head-main {
  display: grid;
  gap: 4px;
}

.panel-head span {
  color: var(--muted);
  font-size: 12px;
}

.op-empty {
  color: var(--muted);
  font-size: 12px;
}

.acct {
  margin-left: 6px;
  color: var(--muted);
  font-style: normal;
  font-size: 12px;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.pending-empty {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.status {
  font-size: 12px;
  font-weight: 650;
}

.status.running,
.status.writing {
  color: var(--blue);
}

.status.ready,
.status.done {
  color: #067647;
}

.status.failed {
  color: #b42318;
}

.warnings ul {
  margin: 0;
  padding-left: 18px;
  color: #b42318;
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 720px) {
  .hero,
  .hero-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
