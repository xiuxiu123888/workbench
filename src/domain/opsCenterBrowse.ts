import type { FunnelSummaryRow, JoinedOffer } from './opsCenter'
import type { OfferIndexRow } from './offerIndex'

export interface FunnelBrowseMeta {
  primaryDay?: string
  metricDays?: string[]
  pulledAt?: string
  funnelCount?: number
  groupCount?: number
  offerCount?: number
  matchedOfferCount?: number
}

export interface FunnelBrowseCatalog {
  meta: FunnelBrowseMeta
  primaryDay: string
  funnelCount: number
  groupCount: number
  offerCount: number
  matchedOfferCount: number
  funnels: FunnelSummaryRow[]
}

export interface FunnelBrowseGroup {
  groupId: string
  groupName: string
  geo: string | null
  routing: string | null
  yesterdayRpm: number
  yesterdayRev: number
  offerCount: number
  matchedStats: number
  revenue: number
  visits: number
  conversion: number
  funnelClicks: number
  offers: JoinedOffer[]
}

export interface FunnelBrowseDetail {
  primaryDay: string
  funnel: FunnelSummaryRow
  groups: FunnelBrowseGroup[]
}

/** 跨漏斗去重后的 offer 库（创编工作台用） */
export interface OfferBrowseIndex {
  primaryDay: string
  rawOfferRows: number
  uniqueOfferCount: number
  offers: OfferIndexRow[]
}
