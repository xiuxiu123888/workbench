import type { FlatStatsOfferRow } from '../api/flatStats'
import type { FunnelListItem } from '../api/ruoyiFunnel'
import { metricsFromFlatStats, type OfferMetrics } from './opsCenter'

export interface HourlyOfferRow extends OfferMetrics {
  offerId: string
  offerName: string
  funnelId: string
  funnelName: string
  landingUrl: string | null
}

export interface HourlyFunnelRow extends OfferMetrics {
  funnelId: string
  funnelName: string
  partnerName: string | null
  offerCount: number
}

export interface HourlySnapshot {
  day: string
  hour: string
  pulledAt: string
  query: { startTime: string; endTime: string }
  offerCount: number
  funnelCount: number
  totals: OfferMetrics
  funnels: HourlyFunnelRow[]
  offers: HourlyOfferRow[]
}

export interface HourlySnapshotMeta {
  day: string
  hour: string
  pulledAt: string
  offerCount: number
  funnelCount: number
  totals: OfferMetrics
}

export interface HourlyDeltaMetrics extends OfferMetrics {
  revenueDelta: number
  visitsDelta: number
  viewsDelta: number
  conversionDelta: number
  funnelImpressionsDelta: number
  funnelClicksDelta: number
  clicksDelta: number
}

export interface HourlyFunnelDelta extends HourlyFunnelRow, HourlyDeltaMetrics {}

export interface HourlyOfferDelta extends HourlyOfferRow, HourlyDeltaMetrics {}

export interface HourlyCompareResult {
  day: string
  currentHour: string
  baselineHour: string | null
  currentPulledAt: string
  baselinePulledAt: string | null
  totals: HourlyDeltaMetrics
  funnels: HourlyFunnelDelta[]
  offers: HourlyOfferDelta[]
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

function avgRates(target: OfferMetrics, count: number): void {
  if (count <= 0) {
    return
  }
  target.funnelRpm = target.funnelRpm / count
  target.rpc = target.rpc / count
  target.funnelCtr = target.funnelCtr / count
  target.cvr1 = target.cvr1 / count
  target.cvr2 = target.cvr2 / count
}

function withDelta(current: OfferMetrics, baseline: OfferMetrics | null): HourlyDeltaMetrics {
  const base = baseline || emptyMetrics()
  return {
    ...current,
    revenueDelta: current.revenue - base.revenue,
    visitsDelta: current.visits - base.visits,
    viewsDelta: current.views - base.views,
    conversionDelta: current.conversion - base.conversion,
    funnelImpressionsDelta: current.funnelImpressions - base.funnelImpressions,
    funnelClicksDelta: current.funnelClicks - base.funnelClicks,
    clicksDelta: current.clicks - base.clicks,
  }
}

export function buildHourlySnapshot(input: {
  day: string
  hour: string
  pulledAt?: string
  query: { startTime: string; endTime: string }
  funnels: FunnelListItem[]
  statsByFunnelId: Map<string, FlatStatsOfferRow[]>
}): HourlySnapshot {
  const offers: HourlyOfferRow[] = []
  const funnelRows: HourlyFunnelRow[] = []
  const totals = emptyMetrics()

  for (const funnel of input.funnels) {
    const rows = input.statsByFunnelId.get(funnel.funnelId) || []
    const funnelTotals = emptyMetrics()
    for (const row of rows) {
      const metrics = metricsFromFlatStats(row)
      addMetrics(funnelTotals, metrics)
      addMetrics(totals, metrics)
      offers.push({
        offerId: String(row.id),
        offerName: String(row.name || row.id),
        funnelId: funnel.funnelId,
        funnelName: funnel.funnelName,
        landingUrl: String(row.url || '').trim() || null,
        ...metrics,
      })
    }
    avgRates(funnelTotals, rows.length)
    funnelRows.push({
      funnelId: funnel.funnelId,
      funnelName: funnel.funnelName,
      partnerName: funnel.partnerName ?? null,
      offerCount: rows.length,
      ...funnelTotals,
    })
  }

  avgRates(totals, offers.length)
  funnelRows.sort((a, b) => b.revenue - a.revenue || a.funnelName.localeCompare(b.funnelName))
  offers.sort((a, b) => b.revenue - a.revenue || a.offerName.localeCompare(b.offerName))

  return {
    day: input.day,
    hour: input.hour,
    pulledAt: input.pulledAt || new Date().toISOString(),
    query: input.query,
    offerCount: offers.length,
    funnelCount: input.funnels.length,
    totals,
    funnels: funnelRows,
    offers,
  }
}

export function summarizeHourlySnapshot(snapshot: HourlySnapshot): HourlySnapshotMeta {
  return {
    day: snapshot.day,
    hour: snapshot.hour,
    pulledAt: snapshot.pulledAt,
    offerCount: snapshot.offerCount,
    funnelCount: snapshot.funnelCount,
    totals: snapshot.totals,
  }
}

export function compareHourlySnapshots(
  current: HourlySnapshot,
  baseline: HourlySnapshot | null,
): HourlyCompareResult {
  const baselineFunnels = new Map((baseline?.funnels || []).map((row) => [row.funnelId, row]))
  const baselineOffers = new Map((baseline?.offers || []).map((row) => [row.offerId, row]))

  const funnels = current.funnels
    .map((row) => {
      const prev = baselineFunnels.get(row.funnelId) || null
      return {
        ...row,
        ...withDelta(row, prev),
      }
    })
    .sort(
      (a, b) =>
        Math.abs(b.revenueDelta) - Math.abs(a.revenueDelta) ||
        b.revenue - a.revenue ||
        a.funnelName.localeCompare(b.funnelName),
    )

  const offers = current.offers
    .map((row) => {
      const prev = baselineOffers.get(row.offerId) || null
      return {
        ...row,
        ...withDelta(row, prev),
      }
    })
    .sort(
      (a, b) =>
        Math.abs(b.revenueDelta) - Math.abs(a.revenueDelta) ||
        b.revenue - a.revenue ||
        a.offerName.localeCompare(b.offerName),
    )

  return {
    day: current.day,
    currentHour: current.hour,
    baselineHour: baseline?.hour ?? null,
    currentPulledAt: current.pulledAt,
    baselinePulledAt: baseline?.pulledAt ?? null,
    totals: withDelta(current.totals, baseline?.totals ?? null),
    funnels,
    offers,
  }
}

export function previousHourLabel(hour: string): string | null {
  const n = Number(hour)
  if (!Number.isFinite(n) || n <= 0) {
    return null
  }
  return String(n - 1).padStart(2, '0')
}
