import type { FlatStatsOfferRow } from '../api/flatStats'
import type { FunnelListItem } from '../api/ruoyiFunnel'
import type {
  FunnelBrowseCatalog,
  FunnelBrowseDetail,
  FunnelBrowseGroup,
  FunnelBrowseMeta,
  OfferBrowseIndex,
} from '../domain/opsCenterBrowse'
import {
  flattenSyncedOffers,
  indexFlatStats,
  joinOffersWithFlatStats,
  type FunnelSummaryRow,
  type JoinedOffer,
  type SyncedGroup,
} from '../domain/opsCenter'
import { isAllowedBrowseFunnel } from '../domain/funnelBrowseAllowlist'
import { dedupeOffersByOfferId } from '../domain/offerIndex'
import { readOpsCenterJson } from './opsCenterStore'

interface LocalListFile {
  data?: FunnelListItem[]
}

interface LocalMetricsFile {
  day?: string
  statsList?: FlatStatsOfferRow[]
}

type LocalMeta = FunnelBrowseMeta

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function label(value: string | null | undefined, empty = '(未填)'): string {
  const text = String(value ?? '').trim()
  return text || empty
}

function emptyTotals() {
  return {
    visits: 0,
    views: 0,
    conversion: 0,
    revenue: 0,
    funnelImpressions: 0,
    funnelClicks: 0,
    clicks: 0,
    funnelRpm: 0,
    funnelCtr: 0,
  }
}

function loadJoinedFromDisk(projectRoot: string): {
  meta: LocalMeta
  primaryDay: string
  funnels: FunnelListItem[]
  groups: SyncedGroup[]
  joined: JoinedOffer[]
} {
  const meta = readOpsCenterJson<LocalMeta>(projectRoot, 'meta.json') || {}
  const listFile = readOpsCenterJson<LocalListFile>(projectRoot, 'raw/list.json')
  const funnels = listFile?.data
  if (!Array.isArray(funnels) || !funnels.length) {
    throw new Error('本地还没有漏斗列表，请先在总览页拉取一次')
  }

  const groups = readOpsCenterJson<SyncedGroup[]>(projectRoot, 'raw/groups.json')
  if (!Array.isArray(groups) || !groups.length) {
    throw new Error('本地还没有页面组数据，请先在总览页拉取一次')
  }

  const primaryDay = meta.primaryDay || new Date().toISOString().slice(0, 10)
  const metrics = readOpsCenterJson<LocalMetricsFile>(projectRoot, `metrics/${primaryDay}/all.json`)
  const flatStats = Array.isArray(metrics?.statsList) ? metrics.statsList : []
  const joined = joinOffersWithFlatStats(flattenSyncedOffers(groups), indexFlatStats(flatStats))

  return { meta, primaryDay, funnels, groups, joined }
}

function summarizeFunnel(
  funnel: FunnelListItem,
  groups: SyncedGroup[],
  offers: JoinedOffer[],
): FunnelSummaryRow {
  const totals = emptyTotals()
  for (const offer of offers) {
    totals.visits += offer.visits
    totals.views += offer.views
    totals.conversion += offer.conversion
    totals.revenue += offer.revenue
    totals.funnelImpressions += offer.funnelImpressions
    totals.funnelClicks += offer.funnelClicks
    totals.clicks += offer.clicks
    totals.funnelRpm += offer.funnelRpm
    totals.funnelCtr += offer.funnelCtr
  }

  const categoryHits = new Map<string, number>()
  for (const offer of offers) {
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
    offerCount: offers.length,
    matchedStats: offers.filter((row) => row.hasFlatStats).length,
    revenue: totals.revenue,
    visits: totals.visits,
    views: totals.views,
    conversion: totals.conversion,
    funnelImpressions: totals.funnelImpressions,
    funnelClicks: totals.funnelClicks,
    clicks: totals.clicks,
    funnelRpmAvg: offers.length ? totals.funnelRpm / offers.length : 0,
    funnelCtrAvg: offers.length ? totals.funnelCtr / offers.length : 0,
    geos: [...new Set(groups.map((group) => label(group.geo, '默认')))],
    topCategories: [...categoryHits.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name]) => name),
  }
}

export function loadOpsCenterBrowseCatalog(projectRoot: string): FunnelBrowseCatalog {
  const { meta, primaryDay, funnels, groups, joined } = loadJoinedFromDisk(projectRoot)
  const groupsByFunnel = new Map<string, SyncedGroup[]>()
  for (const group of groups) {
    const bucket = groupsByFunnel.get(group.funnelId)
    if (bucket) {
      bucket.push(group)
    } else {
      groupsByFunnel.set(group.funnelId, [group])
    }
  }
  const offersByFunnel = new Map<string, JoinedOffer[]>()
  for (const offer of joined) {
    const bucket = offersByFunnel.get(offer.funnelId)
    if (bucket) {
      bucket.push(offer)
    } else {
      offersByFunnel.set(offer.funnelId, [offer])
    }
  }

  const rows = funnels
    .map((funnel) =>
      summarizeFunnel(funnel, groupsByFunnel.get(funnel.funnelId) || [], offersByFunnel.get(funnel.funnelId) || []),
    )
    .sort(
      (a, b) =>
        b.revenue - a.revenue || b.funnelClicks - a.funnelClicks || a.funnelName.localeCompare(b.funnelName),
    )

  return {
    meta,
    primaryDay,
    funnelCount: funnels.length,
    groupCount: groups.length,
    offerCount: joined.length,
    matchedOfferCount: joined.filter((row) => row.hasFlatStats).length,
    funnels: rows,
  }
}

export function loadOpsCenterOfferIndex(projectRoot: string): OfferBrowseIndex {
  const { primaryDay, joined } = loadJoinedFromDisk(projectRoot)
  // 创编工作台只展示白名单漏斗下的 offer（跨漏斗去重前先过滤）
  const allowed = joined.filter((row) => isAllowedBrowseFunnel(row.funnelName))
  const offers = dedupeOffersByOfferId(allowed)
  return {
    primaryDay,
    rawOfferRows: allowed.length,
    uniqueOfferCount: offers.length,
    offers,
  }
}

export function loadOpsCenterFunnelDetail(projectRoot: string, funnelId: string): FunnelBrowseDetail {
  const id = String(funnelId || '').trim()
  if (!id) {
    throw new Error('缺少 funnelId')
  }

  const { primaryDay, funnels, groups, joined } = loadJoinedFromDisk(projectRoot)
  const funnel = funnels.find((item) => item.funnelId === id)
  if (!funnel) {
    throw new Error(`找不到漏斗 ${id}`)
  }

  const funnelGroups = groups.filter((group) => group.funnelId === id)
  const funnelOffers = joined.filter((offer) => offer.funnelId === id)
  const summary = summarizeFunnel(funnel, funnelGroups, funnelOffers)

  const groupsOut: FunnelBrowseGroup[] = funnelGroups
    .map((group) => {
      const offers = funnelOffers
        .filter((offer) => offer.groupId === group.groupId)
        .sort(
          (a, b) =>
            b.revenue - a.revenue ||
            b.funnelClicks - a.funnelClicks ||
            b.visits - a.visits ||
            a.offerName.localeCompare(b.offerName),
        )
      const totals = emptyTotals()
      for (const offer of offers) {
        totals.revenue += offer.revenue
        totals.visits += offer.visits
        totals.conversion += offer.conversion
        totals.funnelClicks += offer.funnelClicks
      }
      return {
        groupId: group.groupId,
        groupName: group.groupName,
        geo: group.geo ?? null,
        routing: group.routing ?? null,
        yesterdayRpm: num(group.yesterdayRpm),
        yesterdayRev: num(group.yesterdayRev),
        offerCount: offers.length,
        matchedStats: offers.filter((row) => row.hasFlatStats).length,
        revenue: totals.revenue,
        visits: totals.visits,
        conversion: totals.conversion,
        funnelClicks: totals.funnelClicks,
        offers,
      }
    })
    .sort(
      (a, b) =>
        b.revenue - a.revenue || b.funnelClicks - a.funnelClicks || a.groupName.localeCompare(b.groupName),
    )

  return {
    primaryDay,
    funnel: summary,
    groups: groupsOut,
  }
}
