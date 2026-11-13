import { formatMoney } from './report'
import type { FlatStatsOfferRow } from '../api/flatStats'
import type {
  FunnelDetail,
  FunnelListItem,
  FunnelOfferGroup,
  FunnelOfferItem,
} from '../api/ruoyiFunnel'
import {
  buildReplaceAdvice,
  formatReplaceAdviceLines,
  type FunnelReplaceSummary,
  type ReplaceAdviceItem,
} from './opsCenterReplace'

export const OPS_CENTER_REPORT_KEY = 'ops-center:last-report:v1'

export interface SyncedOffer extends FunnelOfferItem {
  groupId: string
  groupName: string
  geo: string | null
  routing: string | null
  yesterdayRpm: number
  yesterdayRev: number
  funnelId: string
  funnelName: string
  partnerName: string | null
  urlName: string | null
  urlId: number | string | null
  platform: string | null
}

export interface SyncedGroup extends FunnelOfferGroup {
  funnelId: string
  funnelName: string
  partnerName: string | null
  urlName: string | null
  urlId: number | string | null
  platform: string | null
}

export interface OfferMetrics {
  visits: number
  views: number
  conversion: number
  revenue: number
  funnelImpressions: number
  funnelClicks: number
  clicks: number
  funnelRpm: number
  rpc: number
  funnelCtr: number
  cvr1: number
  cvr2: number
}

export interface JoinedOffer extends SyncedOffer, OfferMetrics {
  hasFlatStats: boolean
  flatStatsName: string | null
  /** MIS flatStats 返回的落地页 URL */
  landingUrl: string | null
}

export interface RankRow {
  key: string
  count: number
  revenue: number
  visits: number
  views: number
  conversion: number
  funnelImpressions: number
  funnelClicks: number
  clicks: number
  funnelRpmAvg: number
  funnelCtrAvg: number
}

export interface FunnelSummaryRow {
  funnelId: string
  funnelName: string
  partnerName: string | null
  urlName: string | null
  platform: string | null
  groupCount: number
  offerCount: number
  matchedStats: number
  revenue: number
  visits: number
  views: number
  conversion: number
  funnelImpressions: number
  funnelClicks: number
  clicks: number
  funnelRpmAvg: number
  funnelCtrAvg: number
  geos: string[]
  topCategories: string[]
}

export interface OpsCenterReport {
  pulledAt: string
  metricDays: string[]
  primaryDay: string
  funnelCount: number
  groupCount: number
  offerCount: number
  matchedOfferCount: number
  totals: OfferMetrics
  partnerRank: RankRow[]
  urlRank: RankRow[]
  geoRank: RankRow[]
  categoryRank: RankRow[]
  funnelRank: FunnelSummaryRow[]
  topOffers: Array<{
    funnelName: string
    partnerName: string | null
    urlName: string | null
    geo: string | null
    categoryName: string | null
    offerName: string
    channelId: string | null
    offerId: string
    weight: number | null
    revenue: number
    visits: number
    views: number
    conversion: number
    funnelImpressions: number
    funnelClicks: number
    clicks: number
    funnelRpm: number
    funnelCtr: number
    cvr1: number
  }>
  insights: string[]
  replaceAdvice: ReplaceAdviceItem[]
  funnelReplaceSummaries: FunnelReplaceSummary[]
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function label(value: string | null | undefined, empty = '(未填)'): string {
  const text = String(value ?? '').trim()
  return text || empty
}

function emptyMetrics(): OfferMetrics {
  return {
    visits: 0,
    views: 0,
    conversion: 0,
    revenue: 0,
    funnelImpressions: 0,
    funnelClicks: 0,
    clicks: 0,
    funnelRpm: 0,
    rpc: 0,
    funnelCtr: 0,
    cvr1: 0,
    cvr2: 0,
  }
}

export function metricsFromFlatStats(row?: FlatStatsOfferRow | null): OfferMetrics {
  if (!row) {
    return emptyMetrics()
  }
  return {
    visits: num(row.visits),
    views: num(row.views),
    conversion: num(row.conversion),
    revenue: num(row.revenue),
    funnelImpressions: num(row.funnelImpressions),
    funnelClicks: num(row.funnelClicks),
    clicks: num(row.clicks),
    funnelRpm: num(row.funnelRpm),
    rpc: num(row.rpc),
    funnelCtr: num(row.funnelCtr),
    cvr1: num(row.cvr1),
    cvr2: num(row.cvr2),
  }
}

function addMetrics(target: OfferMetrics, source: OfferMetrics): void {
  target.visits += source.visits
  target.views += source.views
  target.conversion += source.conversion
  target.revenue += source.revenue
  target.funnelImpressions += source.funnelImpressions
  target.funnelClicks += source.funnelClicks
  target.clicks += source.clicks
  target.funnelRpm += source.funnelRpm
  target.rpc += source.rpc
  target.funnelCtr += source.funnelCtr
  target.cvr1 += source.cvr1
  target.cvr2 += source.cvr2
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyFn(row)
    const bucket = map.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      map.set(key, [row])
    }
  }
  return map
}

function rankJoined(map: Map<string, JoinedOffer[]>, limit = 20): RankRow[] {
  return [...map.entries()]
    .map(([key, rows]) => {
      const totals = emptyMetrics()
      for (const row of rows) {
        addMetrics(totals, row)
      }
      return {
        key,
        count: rows.length,
        revenue: totals.revenue,
        visits: totals.visits,
        views: totals.views,
        conversion: totals.conversion,
        funnelImpressions: totals.funnelImpressions,
        funnelClicks: totals.funnelClicks,
        clicks: totals.clicks,
        funnelRpmAvg: rows.length ? totals.funnelRpm / rows.length : 0,
        funnelCtrAvg: rows.length ? totals.funnelCtr / rows.length : 0,
      }
    })
    .sort(
      (a, b) =>
        b.revenue - a.revenue ||
        b.funnelClicks - a.funnelClicks ||
        b.visits - a.visits ||
        a.key.localeCompare(b.key),
    )
    .slice(0, limit)
}

export function flattenSyncedOffers(groups: SyncedGroup[]): SyncedOffer[] {
  const offers: SyncedOffer[] = []
  for (const group of groups) {
    for (const offer of group.offerList || []) {
      offers.push({
        ...offer,
        groupId: group.groupId,
        groupName: group.groupName,
        geo: group.geo ?? null,
        routing: group.routing ?? null,
        yesterdayRpm: num(group.yesterdayRpm),
        yesterdayRev: num(group.yesterdayRev),
        funnelId: group.funnelId,
        funnelName: group.funnelName,
        partnerName: group.partnerName ?? null,
        urlName: group.urlName ?? null,
        urlId: group.urlId ?? null,
        platform: group.platform ?? null,
      })
    }
  }
  return offers
}

export function joinOffersWithFlatStats(
  offers: SyncedOffer[],
  statsByOfferId: Map<string, FlatStatsOfferRow>,
): JoinedOffer[] {
  return offers.map((offer) => {
    const stats = statsByOfferId.get(String(offer.offerId))
    const metrics = metricsFromFlatStats(stats)
    const landingUrl = String(stats?.url ?? '').trim()
    return {
      ...offer,
      ...metrics,
      hasFlatStats: Boolean(stats),
      flatStatsName: stats?.name ?? null,
      landingUrl: landingUrl || null,
    }
  })
}

export function indexFlatStats(rows: FlatStatsOfferRow[]): Map<string, FlatStatsOfferRow> {
  const map = new Map<string, FlatStatsOfferRow>()
  for (const row of rows) {
    if (row?.id) {
      map.set(String(row.id), row)
    }
  }
  return map
}

export function buildOpsCenterReport(input: {
  funnels: FunnelListItem[]
  details: FunnelDetail[]
  groups: SyncedGroup[]
  flatStats: FlatStatsOfferRow[]
  primaryDay: string
  metricDays?: string[]
  pulledAt?: string
}): OpsCenterReport {
  const offers = flattenSyncedOffers(input.groups)
  const joined = joinOffersWithFlatStats(offers, indexFlatStats(input.flatStats))
  const matched = joined.filter((row) => row.hasFlatStats)

  const partnerRank = rankJoined(groupBy(joined, (row) => label(row.partnerName)))
  const urlRank = rankJoined(groupBy(joined, (row) => label(row.urlName)))
  const geoRank = rankJoined(groupBy(joined, (row) => label(row.geo || row.countryCode, '(默认/未标)')))
  const categoryRank = rankJoined(groupBy(joined, (row) => label(row.categoryName, '(无品类)')))

  const byFunnel = groupBy(input.groups, (row) => row.funnelId)
  const joinedByFunnel = groupBy(joined, (row) => row.funnelId)

  const funnelRank: FunnelSummaryRow[] = input.funnels
    .map((funnel) => {
      const groups = byFunnel.get(funnel.funnelId) || []
      const funnelOffers = joinedByFunnel.get(funnel.funnelId) || []
      const totals = emptyMetrics()
      for (const offer of funnelOffers) {
        addMetrics(totals, offer)
      }
      const categoryHits = new Map<string, number>()
      for (const offer of funnelOffers) {
        const key = label(offer.categoryName, '(无品类)')
        categoryHits.set(key, (categoryHits.get(key) || 0) + offer.revenue)
      }
      return {
        funnelId: funnel.funnelId,
        funnelName: funnel.funnelName,
        partnerName: funnel.partnerName ?? null,
        urlName: funnel.urlName ?? null,
        platform: funnel.platform ?? null,
        groupCount: groups.length,
        offerCount: funnelOffers.length,
        matchedStats: funnelOffers.filter((row) => row.hasFlatStats).length,
        revenue: totals.revenue,
        visits: totals.visits,
        views: totals.views,
        conversion: totals.conversion,
        funnelImpressions: totals.funnelImpressions,
        funnelClicks: totals.funnelClicks,
        clicks: totals.clicks,
        funnelRpmAvg: funnelOffers.length ? totals.funnelRpm / funnelOffers.length : 0,
        funnelCtrAvg: funnelOffers.length ? totals.funnelCtr / funnelOffers.length : 0,
        geos: [...new Set(groups.map((group) => label(group.geo, '默认')))],
        topCategories: [...categoryHits.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([name]) => name),
      }
    })
    .sort(
      (a, b) =>
        b.revenue - a.revenue || b.funnelClicks - a.funnelClicks || a.funnelName.localeCompare(b.funnelName),
    )

  const topOffers = [...joined]
    .sort(
      (a, b) =>
        b.revenue - a.revenue || b.funnelClicks - a.funnelClicks || b.visits - a.visits || a.offerName.localeCompare(b.offerName),
    )
    .slice(0, 20)
    .map((offer) => ({
      funnelName: offer.funnelName,
      partnerName: offer.partnerName,
      urlName: offer.urlName,
      geo: offer.geo,
      categoryName: offer.categoryName ?? null,
      offerName: offer.offerName,
      channelId: offer.channelId ?? null,
      offerId: offer.offerId,
      weight: offer.weight ?? null,
      revenue: offer.revenue,
      visits: offer.visits,
      views: offer.views,
      conversion: offer.conversion,
      funnelImpressions: offer.funnelImpressions,
      funnelClicks: offer.funnelClicks,
      clicks: offer.clicks,
      funnelRpm: offer.funnelRpm,
      funnelCtr: offer.funnelCtr,
      cvr1: offer.cvr1,
    }))

  const totals = emptyMetrics()
  for (const offer of joined) {
    addMetrics(totals, offer)
  }

  const { items: replaceAdvice, funnelSummaries: funnelReplaceSummaries } = buildReplaceAdvice(joined)
  const insights = buildInsights({
    totals,
    partnerRank,
    geoRank,
    categoryRank,
    funnelRank,
    offerCount: joined.length,
    matchedOfferCount: matched.length,
    primaryDay: input.primaryDay,
    replaceLines: formatReplaceAdviceLines(funnelReplaceSummaries, replaceAdvice),
  })

  return {
    pulledAt: input.pulledAt || new Date().toISOString(),
    metricDays: input.metricDays || [input.primaryDay],
    primaryDay: input.primaryDay,
    funnelCount: input.funnels.length,
    groupCount: input.groups.length,
    offerCount: joined.length,
    matchedOfferCount: matched.length,
    totals,
    partnerRank,
    urlRank,
    geoRank,
    categoryRank,
    funnelRank,
    topOffers,
    insights,
    replaceAdvice,
    funnelReplaceSummaries,
  }
}

export function buildInsights(input: {
  totals: OfferMetrics
  partnerRank: RankRow[]
  geoRank: RankRow[]
  categoryRank: RankRow[]
  funnelRank: FunnelSummaryRow[]
  offerCount: number
  matchedOfferCount: number
  primaryDay: string
  replaceLines?: string[]
}): string[] {
  const lines: string[] = []
  lines.push(
    `${input.primaryDay} 对齐结果：${input.matchedOfferCount}/${input.offerCount} 条 offer 命中 flatStats`,
  )
  if (input.replaceLines?.length) {
    lines.push(...input.replaceLines.slice(0, 6))
  }

  if (input.totals.visits > 0 || input.totals.funnelImpressions > 0) {
    lines.push(
      `流量：访问 ${Math.round(input.totals.visits)} · 浏览 ${Math.round(input.totals.views)} · 漏斗展示 ${Math.round(input.totals.funnelImpressions)} · 漏斗点击 ${Math.round(input.totals.funnelClicks)}`,
    )
  }

  if (input.totals.conversion > 0 || input.totals.clicks > 0) {
    lines.push(
      `转化：conversion ${Math.round(input.totals.conversion)} · 广告点击 ${Math.round(input.totals.clicks)} · 收入 $${formatMoney(input.totals.revenue)}`,
    )
  }

  const topGeo = input.geoRank[0]
  if (topGeo && input.totals.revenue > 0) {
    const share = (topGeo.revenue / input.totals.revenue) * 100
    lines.push(`收入集中国家：${topGeo.key} $${formatMoney(topGeo.revenue)}（约 ${share.toFixed(0)}%）`)
  }

  const topPartner = input.partnerRank.find((row) => row.key !== '(未填)') || input.partnerRank[0]
  if (topPartner) {
    lines.push(
      `合作方头部：${topPartner.key} 收入 $${formatMoney(topPartner.revenue)} / 访问 ${Math.round(topPartner.visits)} / CTR ${formatMoney(topPartner.funnelCtrAvg)}`,
    )
  }

  const topCategory =
    input.categoryRank.find((row) => row.key !== '(无品类)' && row.key !== '(未填)') || input.categoryRank[0]
  if (topCategory) {
    lines.push(
      `品类头部：${topCategory.key}（收入 $${formatMoney(topCategory.revenue)} · 漏斗点击 ${Math.round(topCategory.funnelClicks)}）`,
    )
  }

  const weak = input.funnelRank
    .filter((row) => row.visits > 0 && row.revenue <= 0)
    .slice(0, 5)
  if (weak.length) {
    lines.push(`有访问但 0 收入的漏斗：${weak.map((row) => row.funnelName).join('、')}`)
  }

  const hot = input.funnelRank.filter((row) => row.revenue > 0).slice(0, 3)
  if (hot.length) {
    lines.push(`漏斗 Top：${hot.map((row) => `${row.funnelName} $${formatMoney(row.revenue)}`).join(' · ')}`)
  }

  return lines
}

export function formatOpsCenterFeishuText(report: OpsCenterReport): string {
  const time = new Date(report.pulledAt).toLocaleString('zh-CN', { hour12: false })
  return [
    '运营中心 · 漏斗表现报告',
    `同步时间 ${time}`,
    `指标日 ${report.primaryDay}`,
    `漏斗 ${report.funnelCount} · 组 ${report.groupCount} · offer ${report.offerCount} · 对齐 ${report.matchedOfferCount}`,
    `收入 $${formatMoney(report.totals.revenue)} · 访问 ${Math.round(report.totals.visits)} · 漏斗点击 ${Math.round(report.totals.funnelClicks)} · 转化 ${Math.round(report.totals.conversion)}`,
    '',
    '【结论】',
    ...report.insights.map((line) => `· ${line}`),
    '',
    '【合作方 Top】',
    ...report.partnerRank
      .slice(0, 6)
      .map(
        (row, index) =>
          `${index + 1}. ${row.key}  rev $${formatMoney(row.revenue)}  visits ${Math.round(row.visits)}  ctr ${formatMoney(row.funnelCtrAvg)}`,
      ),
    '',
    '【品类 Top】',
    ...report.categoryRank
      .slice(0, 8)
      .map(
        (row, index) =>
          `${index + 1}. ${row.key}  rev $${formatMoney(row.revenue)}  clicks ${Math.round(row.funnelClicks)}  n=${row.count}`,
      ),
    '',
    '【换文建议】',
    ...(report.funnelReplaceSummaries?.length
      ? report.funnelReplaceSummaries.slice(0, 10).map(
          (row, index) =>
            `${index + 1}. ${row.funnelName} 当前[${row.currentCategories.join('、')}] → 建议[${row.suggestCategories.join('、')}]；弱offer ${row.weakOfferCount}`,
        )
      : ['暂无待换漏斗']),
    '',
    '【Offer Top】',
    ...report.topOffers
      .slice(0, 8)
      .map(
        (row, index) =>
          `${index + 1}. ${row.funnelName}/${row.geo || '默认'}/${row.categoryName || '无品类'}  rev $${formatMoney(row.revenue)}  visits ${Math.round(row.visits)}  ctr ${formatMoney(row.funnelCtr)}`,
      ),
  ].join('\n')
}

export function loadOpsCenterReport(storage: Pick<Storage, 'getItem'> = localStorage): OpsCenterReport | null {
  try {
    const raw = storage.getItem(OPS_CENTER_REPORT_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as OpsCenterReport
    if (!parsed || typeof parsed !== 'object' || !parsed.pulledAt) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveOpsCenterReport(
  report: OpsCenterReport,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(OPS_CENTER_REPORT_KEY, JSON.stringify(report))
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const total = items.length
  const results = new Array<R>(total)
  let next = 0
  let done = 0

  async function run(): Promise<void> {
    while (next < total) {
      const index = next
      next += 1
      results[index] = await worker(items[index], index)
      done += 1
      onProgress?.(done, total)
    }
  }

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, total || 1)) }, () => run())
  await Promise.all(runners)
  return results
}
