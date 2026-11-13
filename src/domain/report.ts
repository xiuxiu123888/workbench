import { channelFromUrl } from './campaignForm'

export interface ArticleLink {
  articleId: string
  channelId: string
}

export interface KeywordRow {
  keyword: string
  termClicks: number
  adClicks: number
}

export interface RevenueRow {
  targetTime?: string | null
  date?: string | null
  revenue?: string | number | null
  estimatedEarnings?: string | number | null
  countryCode?: string | null
  customChannelId?: string | null
}

/** 文章账户名 A3 / AFS3 → 收入 source=3 */
export function sourceFromAccountName(name: string): string {
  const text = String(name ?? '').trim()
  const afs = text.match(/^AFS(\d+)$/i)
  if (afs?.[1]) {
    return afs[1]
  }
  const matched = text.match(/^A(\d+)$/i)
  return matched?.[1] ?? ''
}

/** /biz/report/list 的 domain：source-渠道id，如 3-28461 */
export function afsReportDomain(source: string, channelId: string): string {
  const src = String(source ?? '').trim()
  const channel = String(channelId ?? '').trim()
  if (!src || !channel) {
    return ''
  }
  return `${src}-${channel}`
}

export const REVENUE_INVESTOR_KEY = 'workbench.revenue.investor'
/** 本地收入缓存命名空间；afsData 不再按 investor 查询 */
export const DEFAULT_REVENUE_INVESTOR = 'afs'
export const AFS_REVENUE_CACHE_INVESTOR = 'afs'

export function loadRevenueInvestor(storage: Pick<Storage, 'getItem'> = localStorage): string {
  try {
    const value = String(storage.getItem(REVENUE_INVESTOR_KEY) ?? '').trim()
    return value || DEFAULT_REVENUE_INVESTOR
  } catch {
    return DEFAULT_REVENUE_INVESTOR
  }
}

export function saveRevenueInvestor(value: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  const next = String(value ?? '').trim() || DEFAULT_REVENUE_INVESTOR
  try {
    storage.setItem(REVENUE_INVESTOR_KEY, next)
  } catch {
    /* ignore */
  }
}

export function articleIdFromUrl(url: string): string {
  const text = url.trim()
  const matched = text.match(/\/detail\/(\d+)/)
  if (matched?.[1]) {
    return matched[1]
  }
  try {
    const last = new URL(text).pathname.split('/').filter(Boolean).pop() ?? ''
    return /^\d+$/.test(last) ? last : ''
  } catch {
    return ''
  }
}

export function articleLinks(urls: string[]): ArticleLink[] {
  return uniqueArticleLinks(urls.map((url) => ({ articleId: articleIdFromUrl(url), channelId: channelFromUrl(url) })))
}

export function changedArticleLinks(
  before: Array<{ url: string; countryCode?: string }>,
  afterUrls: string[],
): Array<ArticleLink & { countryCode: string }> {
  const afterIds = new Set(articleLinks(afterUrls).map((link) => link.articleId))
  const beforeLinks = before.flatMap((item) => {
    const articleId = articleIdFromUrl(item.url)
    return articleId ? [{ articleId, channelId: channelFromUrl(item.url), countryCode: item.countryCode?.trim() ?? '' }] : []
  })
  const beforeIds = new Set(beforeLinks.map((link) => link.articleId))
  const removed = beforeLinks.filter((link) => !afterIds.has(link.articleId))
  const added = articleLinks(afterUrls)
    .filter((link) => !beforeIds.has(link.articleId))
    .map((link) => ({ ...link, countryCode: '' }))
  return uniqueArticleLinks([...removed, ...added])
}

export function linksForReportDay(
  day: string,
  today: string,
  current: ArticleLink[],
  kept: Array<{ day: string; articleId: string; channelId: string }>,
): ArticleLink[] {
  const remembered = uniqueArticleLinks(
    kept.filter((item) => item.day === day).map((item) => ({ articleId: item.articleId, channelId: item.channelId })),
  )
  if (today && day < today && remembered.length > 0) {
    return remembered
  }
  return uniqueArticleLinks([...current, ...remembered])
}

function uniqueArticleLinks<T extends ArticleLink>(links: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const link of links) {
    if (!link.articleId || seen.has(link.articleId)) {
      continue
    }
    seen.add(link.articleId)
    result.push(link)
  }
  return result
}

export function eachDay(start: string, end: string): string[] {
  const cursor = new Date(`${start}T00:00:00`)
  const last = new Date(`${end}T00:00:00`)
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime()) || cursor > last) {
    return []
  }
  const days: string[] = []
  while (cursor <= last) {
    const month = String(cursor.getMonth() + 1).padStart(2, '0')
    const day = String(cursor.getDate()).padStart(2, '0')
    days.push(`${cursor.getFullYear()}-${month}-${day}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export function dayRange(day: string): [string, string] {
  return [`${day} 00:00:00`, `${day} 23:59:59`]
}

export function dayFromCreateTime(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatEpochDay(value)
  }
  const text = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10)
  }
  if (/^\d{12,13}$/.test(text)) {
    return formatEpochDay(Number(text))
  }
  if (/^\d{10}$/.test(text)) {
    return formatEpochDay(Number(text) * 1000)
  }
  return ''
}

export function groupByDay<T extends { createTime?: string | number | null }>(records: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const record of records) {
    const day = dayFromCreateTime(record.createTime)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      continue
    }
    const list = grouped.get(day) ?? []
    list.push(record)
    grouped.set(day, list)
  }
  return grouped
}

function countKeywords(records: Array<{ keyword?: string | null }>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const record of records) {
    const keyword = String(record.keyword ?? '').trim()
    counts.set(keyword, (counts.get(keyword) ?? 0) + 1)
  }
  return counts
}

export function keywordTable(
  termRecords: Array<{ keyword?: string | null }>,
  adRecords: Array<{ keyword?: string | null }>,
): KeywordRow[] {
  const termCounts = countKeywords(termRecords)
  const adCounts = countKeywords(adRecords)
  const names = new Set([...termCounts.keys(), ...adCounts.keys()])
  return [...names]
    .map((keyword) => ({
      keyword,
      termClicks: termCounts.get(keyword) ?? 0,
      adClicks: adCounts.get(keyword) ?? 0,
    }))
    .sort((a, b) => {
      if (!a.keyword) {
        return 1
      }
      if (!b.keyword) {
        return -1
      }
      return b.termClicks + b.adClicks - (a.termClicks + a.adClicks) || a.keyword.localeCompare(b.keyword)
    })
}

export function namedKeywordCount(rows: KeywordRow[]): number {
  return rows.filter((row) => row.keyword && row.termClicks > 0).length
}

function revenueAmount(row: RevenueRow): number | null {
  const amount = Number(row.revenue ?? row.estimatedEarnings ?? 0)
  return Number.isFinite(amount) ? amount : null
}

function revenueDay(row: RevenueRow): string {
  const rawDay = String(row.targetTime ?? row.date ?? '').trim()
  if (rawDay === '汇总') {
    return ''
  }
  const day = rawDay.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ''
}

export function revenueByDay(rows: RevenueRow[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const day = revenueDay(row)
    const amount = revenueAmount(row)
    if (!day || amount == null) {
      continue
    }
    totals.set(day, (totals.get(day) ?? 0) + amount)
  }
  return totals
}

/** afsData 行自带国家：按「日 + 国家」汇总收入 */
export function revenueByDayAndCountry(rows: RevenueRow[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const day = revenueDay(row)
    const amount = revenueAmount(row)
    const country = String(row.countryCode ?? '')
      .trim()
      .toUpperCase()
    if (!day || amount == null || !country) {
      continue
    }
    const key = `${day}\n${country}`
    totals.set(key, (totals.get(key) ?? 0) + amount)
  }
  return totals
}

/** 跨日按国家汇总（回收：品类 → 各国家收入） */
export function revenueByCountryCode(rows: RevenueRow[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (!revenueDay(row)) {
      continue
    }
    const amount = revenueAmount(row)
    const country = String(row.countryCode ?? '')
      .trim()
      .toUpperCase()
    if (amount == null || !country) {
      continue
    }
    totals.set(country, (totals.get(country) ?? 0) + amount)
  }
  return totals
}

/** 某一日按国家拆开收入（丢掉汇总行、无国家码行） */
export function revenueCountriesOnDay(
  rows: RevenueRow[],
  day: string,
): Array<{ countryCode: string; revenue: number }> {
  const target = String(day ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) {
    return []
  }
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (revenueDay(row) !== target) {
      continue
    }
    const amount = revenueAmount(row)
    const country = String(row.countryCode ?? '')
      .trim()
      .toUpperCase()
    if (amount == null || !country) {
      continue
    }
    totals.set(country, (totals.get(country) ?? 0) + amount)
  }
  return [...totals.entries()]
    .map(([countryCode, revenue]) => ({ countryCode, revenue }))
    .sort((a, b) => b.revenue - a.revenue || a.countryCode.localeCompare(b.countryCode))
}

export function formatMoney(value: number): string {
  return value.toFixed(2)
}

export interface DailyRevenueChange {
  total: number | null
  delta: number | null
  rate: number | null
}

export function dailyRevenueTotal(revenues: Array<number | null>): number | null {
  if (revenues.length === 0) {
    return null
  }
  const known = revenues.filter((value): value is number => value != null && Number.isFinite(value))
  // 个别渠道未知时仍加总已知收入，避免一天总收入整格变成 —
  if (known.length === 0) {
    return null
  }
  return known.reduce((sum, value) => sum + value, 0)
}

export function compareMetric(current: number | null, previous: number | null): DailyRevenueChange {
  if (current == null || previous == null) {
    return { total: current, delta: null, rate: null }
  }
  const delta = current - previous
  return { total: current, delta, rate: previous === 0 ? null : delta / previous }
}

export function compareDailyRevenue(
  current: Array<number | null>,
  previous: Array<number | null> | null,
): DailyRevenueChange {
  return compareMetric(dailyRevenueTotal(current), previous == null ? null : dailyRevenueTotal(previous))
}

export function formatClickRate(clicks: number, views: number): string {
  if (!Number.isFinite(clicks) || !Number.isFinite(views) || views <= 0) {
    return '—'
  }
  return `${((clicks / views) * 100).toFixed(2)}%`
}

export interface Subid2DailyStatKeyword {
  keyword?: string | null
  termClickCount?: number | null
  adClicksCount?: number | null
}

export interface Subid2DailyStatItem {
  subid2?: string | null
  pageViewCount?: number | null
  termClickCount?: number | null
  adClicksCount?: number | null
  keywordCount?: number | null
  keywords?: Subid2DailyStatKeyword[] | null
}

export interface Subid2DailyStatDay {
  date?: string | null
  items?: Subid2DailyStatItem[] | null
}

export interface ArticleDayStat {
  articleId: string
  day: string
  pageViews: number
  termClicks: number
  adClicks: number
  keywordCount: number
  keywords: KeywordRow[]
}

function wholeCount(value: unknown): number {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number) || number < 0) {
    return 0
  }
  return Math.round(number)
}

export function articleDayStatsFromDaily(data: Subid2DailyStatDay[]): ArticleDayStat[] {
  const result: ArticleDayStat[] = []
  for (const dayRow of data) {
    const day = String(dayRow.date ?? '').trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      continue
    }
    for (const item of dayRow.items ?? []) {
      const articleId = String(item.subid2 ?? '').trim()
      if (!articleId) {
        continue
      }
      const keywords = (item.keywords ?? [])
        .map((row) => ({
          keyword: String(row.keyword ?? '').trim(),
          termClicks: wholeCount(row.termClickCount),
          adClicks: wholeCount(row.adClicksCount),
        }))
        .sort((a, b) => {
          if (!a.keyword) {
            return 1
          }
          if (!b.keyword) {
            return -1
          }
          return b.termClicks + b.adClicks - (a.termClicks + a.adClicks) || a.keyword.localeCompare(b.keyword)
        })
      const keywordCount = wholeCount(item.keywordCount)
      result.push({
        articleId,
        day,
        pageViews: wholeCount(item.pageViewCount),
        termClicks: wholeCount(item.termClickCount),
        adClicks: wholeCount(item.adClicksCount),
        keywordCount: keywordCount > 0 ? keywordCount : namedKeywordCount(keywords),
        keywords,
      })
    }
  }
  return result
}

export function articleDayStatMap(data: Subid2DailyStatDay[]): Map<string, ArticleDayStat> {
  const map = new Map<string, ArticleDayStat>()
  for (const row of articleDayStatsFromDaily(data)) {
    map.set(`${row.articleId}\n${row.day}`, row)
  }
  return map
}

function formatEpochDay(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
