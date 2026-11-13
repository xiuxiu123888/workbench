import type { KeywordRow } from './report'

export interface ArticleDaySnapshot {
  articleId: string
  day: string
  pageViews: number
  termClicks?: number
  adClicks?: number
  keywordCount?: number
  keywords: KeywordRow[]
}

export interface ChannelDaySnapshot {
  channelId: string
  investor: string
  day: string
  revenue: number | null
}

export interface CacheLookup {
  articleIds: string[]
  channelIds: string[]
  investor: string
  start: string
  end: string
}

export interface CacheBatch {
  articles: ArticleDaySnapshot[]
  channels: ChannelDaySnapshot[]
}

export interface ConfigArticleRecord {
  configId: string
  day: string
  articleId: string
  channelId: string
  countryCode: string
}

export interface FetchSpan {
  id: string
  days: string[]
}

export interface ReportFetchPlan {
  cachedDayCount: number
  pendingDayCount: number
  articles: FetchSpan[]
  channels: FetchSpan[]
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function isDay(value: string): boolean {
  return DAY.test(value)
}

export function articleCacheKey(articleId: string, day: string): string {
  return `${articleId}\n${day}`
}

export function channelCacheKey(channelId: string, investor: string, day: string): string {
  return `${channelId}\n${investor}\n${day}`
}

export function contiguousSpans(days: string[]): string[][] {
  const sorted = [...new Set(days.filter(isDay))].sort()
  const spans: string[][] = []
  for (const day of sorted) {
    const current = spans[spans.length - 1]
    const last = current?.[current.length - 1]
    if (!current || !last || shiftDay(last, 1) !== day) {
      spans.push([day])
      continue
    }
    current.push(day)
  }
  return spans
}

export function planReportFetch(input: {
  days: string[]
  today: string
  articleIds: string[]
  channelIds: string[]
  investor: string
  articles: ArticleDaySnapshot[]
  channels: ChannelDaySnapshot[]
}): ReportFetchPlan {
  const today = isDay(input.today) ? input.today : ''
  const investor = input.investor.trim()
  const days = [...new Set(input.days.filter(isDay))].sort()
  const articleIds = uniqueText(input.articleIds)
  const channelIds = uniqueText(input.channelIds)
  const articleHits = new Set<string>()
  for (const row of input.articles) {
    if (row.articleId && isDay(row.day) && today && row.day < today) {
      articleHits.add(articleCacheKey(row.articleId, row.day))
    }
  }
  const channelHits = new Set<string>()
  for (const row of input.channels) {
    // revenue=null 表示上次没查到/失败，不算齐，下次还要重拉
    if (
      row.channelId &&
      row.investor === investor &&
      isDay(row.day) &&
      today &&
      row.day < today &&
      row.revenue != null &&
      Number.isFinite(row.revenue)
    ) {
      channelHits.add(channelCacheKey(row.channelId, investor, row.day))
    }
  }

  let cachedDayCount = 0
  for (const day of days) {
    const settled = Boolean(today) && day < today
    const articlesReady = articleIds.every((id) => articleHits.has(articleCacheKey(id, day)))
    const channelsReady = channelIds.every((id) => channelHits.has(channelCacheKey(id, investor, day)))
    if (settled && articlesReady && channelsReady) {
      cachedDayCount += 1
    }
  }

  return {
    cachedDayCount,
    pendingDayCount: days.length - cachedDayCount,
    articles: articleIds.flatMap((id) =>
      toSpans(
        id,
        days.filter((day) => !(today && day < today && articleHits.has(articleCacheKey(id, day)))),
      ),
    ),
    channels: channelIds.flatMap((id) =>
      toSpans(
        id,
        days.filter((day) => !(today && day < today && channelHits.has(channelCacheKey(id, investor, day)))),
      ),
    ),
  }
}

export function normalizeCacheLookup(input: unknown): CacheLookup {
  if (!input || typeof input !== 'object') {
    throw new Error('查询条件不对')
  }
  const record = input as Partial<CacheLookup>
  const start = String(record.start ?? '')
  const end = String(record.end ?? '')
  if (!isDay(start) || !isDay(end) || start > end) {
    throw new Error('日期不对')
  }
  return {
    articleIds: uniqueText(asStrings(record.articleIds)),
    channelIds: uniqueText(asStrings(record.channelIds)),
    investor: String(record.investor ?? '').trim(),
    start,
    end,
  }
}

export function normalizeCacheBatch(input: unknown): CacheBatch {
  if (!input || typeof input !== 'object') {
    throw new Error('缓存内容不对')
  }
  const record = input as { articles?: unknown; channels?: unknown }
  return {
    articles: asItems(record.articles, normalizeArticleSnapshot, '文章日报'),
    channels: asItems(record.channels, normalizeChannelSnapshot, '渠道收入'),
  }
}

function toSpans(id: string, days: string[]): FetchSpan[] {
  return contiguousSpans(days).map((span) => ({ id, days: span }))
}

function normalizeKeywordRows(raw: unknown): KeywordRow[] | null {
  if (!Array.isArray(raw)) {
    return null
  }
  const keywords: KeywordRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      return null
    }
    const row = item as Partial<KeywordRow>
    const termClicks = Number(row.termClicks)
    const adClicks = Number(row.adClicks)
    if (typeof row.keyword !== 'string' || !Number.isInteger(termClicks) || termClicks < 0 || !Number.isInteger(adClicks) || adClicks < 0) {
      return null
    }
    keywords.push({ keyword: row.keyword, termClicks, adClicks })
  }
  return keywords
}

function sumKeywordClicks(keywords: KeywordRow[], key: 'termClicks' | 'adClicks'): number {
  return keywords.reduce((sum, row) => sum + row[key], 0)
}

export function encodeArticleKeywords(snapshot: ArticleDaySnapshot): string {
  return JSON.stringify({
    keywords: snapshot.keywords,
    termClicks: snapshot.termClicks,
    adClicks: snapshot.adClicks,
    keywordCount: snapshot.keywordCount,
  })
}

function normalizeArticleSnapshot(input: unknown): ArticleDaySnapshot | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const record = input as Partial<ArticleDaySnapshot> & { keywords?: unknown }
  const articleId = String(record.articleId ?? '').trim()
  const day = String(record.day ?? '')
  const pageViews = Number(record.pageViews)
  if (!articleId || !isDay(day) || !Number.isInteger(pageViews) || pageViews < 0) {
    return null
  }
  let keywords: KeywordRow[] | null = null
  let termClicks = Number(record.termClicks)
  let adClicks = Number(record.adClicks)
  let keywordCount = Number(record.keywordCount)
  if (Array.isArray(record.keywords)) {
    keywords = normalizeKeywordRows(record.keywords)
  } else if (record.keywords && typeof record.keywords === 'object') {
    const packed = record.keywords as {
      keywords?: unknown
      termClicks?: unknown
      adClicks?: unknown
      keywordCount?: unknown
    }
    keywords = normalizeKeywordRows(packed.keywords)
    if (!Number.isInteger(termClicks) || termClicks < 0) {
      termClicks = Number(packed.termClicks)
    }
    if (!Number.isInteger(adClicks) || adClicks < 0) {
      adClicks = Number(packed.adClicks)
    }
    if (!Number.isInteger(keywordCount) || keywordCount < 0) {
      keywordCount = Number(packed.keywordCount)
    }
  }
  if (!keywords) {
    return null
  }
  if (!Number.isInteger(termClicks) || termClicks < 0) {
    termClicks = sumKeywordClicks(keywords, 'termClicks')
  }
  if (!Number.isInteger(adClicks) || adClicks < 0) {
    adClicks = sumKeywordClicks(keywords, 'adClicks')
  }
  if (!Number.isInteger(keywordCount) || keywordCount < 0) {
    keywordCount = keywords.filter((row) => row.keyword && row.termClicks > 0).length
  }
  return { articleId, day, pageViews, termClicks, adClicks, keywordCount, keywords }
}

function normalizeChannelSnapshot(input: unknown): ChannelDaySnapshot | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const record = input as Partial<ChannelDaySnapshot> & { revenue?: unknown }
  const channelId = String(record.channelId ?? '').trim()
  const day = String(record.day ?? '')
  if (!channelId || !isDay(day)) {
    return null
  }
  if (record.revenue == null) {
    return { channelId, investor: String(record.investor ?? '').trim(), day, revenue: null }
  }
  const revenue = Number(record.revenue)
  if (!Number.isFinite(revenue)) {
    return null
  }
  return { channelId, investor: String(record.investor ?? '').trim(), day, revenue }
}

function asItems<T>(value: unknown, normalize: (item: unknown) => T | null, label: string): T[] {
  if (value == null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label}格式不对`)
  }
  return value.map((item) => {
    const row = normalize(item)
    if (!row) {
      throw new Error(`${label}格式不对`)
    }
    return row
  })
}

export function normalizeConfigArticleQuery(input: unknown): { configId: string; start: string; end: string } {
  if (!input || typeof input !== 'object') {
    throw new Error('查询条件不对')
  }
  const record = input as { configId?: unknown; start?: unknown; end?: unknown }
  const configId = String(record.configId ?? '').trim()
  const start = String(record.start ?? '')
  const end = String(record.end ?? '')
  if (!configId || !isDay(start) || !isDay(end) || start > end) {
    throw new Error('日期不对')
  }
  return { configId, start, end }
}

export function normalizeConfigArticles(input: unknown): ConfigArticleRecord[] {
  const list = Array.isArray(input) ? input : (input as { articles?: unknown } | null)?.articles
  if (!Array.isArray(list)) {
    throw new Error('文章记录不对')
  }
  const rows: ConfigArticleRecord[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Partial<ConfigArticleRecord>
    const configId = String(record.configId ?? '').trim()
    const day = String(record.day ?? '').trim()
    const articleId = String(record.articleId ?? '').trim()
    if (!configId || !isDay(day) || !articleId) {
      continue
    }
    rows.push({
      configId,
      day,
      articleId,
      channelId: String(record.channelId ?? '').trim(),
      countryCode: String(record.countryCode ?? '').trim(),
    })
  }
  return rows
}

function asStrings(value: unknown): string[] {
  if (value == null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error('查询条件不对')
  }
  return value.map((item) => String(item ?? ''))
}

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = value.trim()
    if (!text || seen.has(text)) {
      continue
    }
    seen.add(text)
    result.push(text)
  }
  return result
}

function shiftDay(day: string, amount: number): string {
  const cursor = new Date(`${day}T00:00:00`)
  cursor.setDate(cursor.getDate() + amount)
  const month = String(cursor.getMonth() + 1).padStart(2, '0')
  const date = String(cursor.getDate()).padStart(2, '0')
  return `${cursor.getFullYear()}-${month}-${date}`
}
