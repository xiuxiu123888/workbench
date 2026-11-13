import fs from 'node:fs'
import { isAllowedBrowseFunnel } from '../src/domain/funnelBrowseAllowlist'

type Group = {
  funnelId: string
  funnelName: string
  offerList?: Array<{
    offerId?: string
    offerName?: string
    resultUrl?: string
    url?: string
  }>
}

function partnerPrefix(funnelName: string): string {
  const lower = String(funnelName || '')
    .trim()
    .toLowerCase()
  const known = ['cd-reader', 'blinkdrama', 'moboreels', 'vibeshort', 'shortmax', 'storyreel', 'reader']
  for (const key of known) {
    if (lower === key || lower.startsWith(`${key}-`)) return key
  }
  return lower.split('-')[0] || lower
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[index]
}

const root = process.cwd()
const meta = JSON.parse(fs.readFileSync('data/ops-center/meta.json', 'utf8')) as { primaryDay?: string }
const day = meta.primaryDay || new Date().toISOString().slice(0, 10)
const metricsPath = `data/ops-center/metrics/${day}/all.json`
const metrics = fs.existsSync(metricsPath)
  ? (JSON.parse(fs.readFileSync(metricsPath, 'utf8')) as {
      statsList?: Array<{
        id?: string
        name?: string
        revenue?: number
        visits?: number
        impressions?: number
        funnelRpm?: number
        rpm?: number
      }>
    })
  : { statsList: [] }

const groups = JSON.parse(fs.readFileSync('data/ops-center/raw/groups.json', 'utf8')) as Group[]
const statsById = new Map<string, NonNullable<typeof metrics.statsList>[number]>()
for (const row of metrics.statsList || []) {
  if (row?.id) statsById.set(String(row.id), row)
}

type Row = {
  offerId: string
  offerName: string
  funnelName: string
  partner: string
  revenue: number
  visits: number
  funnelRpm: number
  ref: string
}

const rows: Row[] = []
for (const group of groups) {
  if (!isAllowedBrowseFunnel(group.funnelName)) continue
  for (const offer of group.offerList || []) {
    const offerId = String(offer.offerId || '').trim()
    if (!offerId) continue
    const stats = statsById.get(offerId)
    const revenue = Number(stats?.revenue) || 0
    const visits = Number(stats?.visits) || 0
    const funnelRpm = Number(stats?.funnelRpm ?? stats?.rpm) || 0
    let ref = ''
    const landing = String(offer.resultUrl || offer.url || '')
    try {
      ref = new URL(landing).searchParams.get('ref') || ''
    } catch {
      ref = ''
    }
    const offerName = String(offer.offerName || offerId)
    if (/default/i.test(offerName)) continue
    rows.push({
      offerId,
      offerName,
      funnelName: group.funnelName,
      partner: partnerPrefix(group.funnelName),
      revenue,
      visits,
      funnelRpm,
      ref,
    })
  }
}

// dedupe by offerId keep higher revenue
const byOffer = new Map<string, Row>()
for (const row of rows) {
  const prev = byOffer.get(row.offerId)
  if (!prev || row.revenue > prev.revenue) byOffer.set(row.offerId, row)
}
const unique = [...byOffer.values()]
const withTraffic = unique.filter((r) => r.visits > 0 || r.revenue > 0 || r.funnelRpm > 0)
const rpms = withTraffic.map((r) => r.funnelRpm).filter((n) => Number.isFinite(n))

function countBelow(threshold: number) {
  return withTraffic.filter((r) => r.funnelRpm < threshold).length
}

const byPartner: Record<string, { n: number; p25: number; p50: number; p75: number; below1: number; below2: number; below5: number }> = {}
for (const partner of [...new Set(withTraffic.map((r) => r.partner))]) {
  const list = withTraffic.filter((r) => r.partner === partner).map((r) => r.funnelRpm)
  const rowsP = withTraffic.filter((r) => r.partner === partner)
  byPartner[partner] = {
    n: list.length,
    p25: Number(percentile(list, 0.25).toFixed(3)),
    p50: Number(percentile(list, 0.5).toFixed(3)),
    p75: Number(percentile(list, 0.75).toFixed(3)),
    below1: rowsP.filter((r) => r.funnelRpm < 1).length,
    below2: rowsP.filter((r) => r.funnelRpm < 2).length,
    below5: rowsP.filter((r) => r.funnelRpm < 5).length,
  }
}

const visitFloors = [1, 10, 50, 100, 200].map((minVisits) => {
  const rows = unique.filter((r) => r.visits >= minVisits)
  const list = rows.map((r) => r.funnelRpm)
  const below = (t: number) => rows.filter((r) => r.funnelRpm < t).length
  return {
    minVisits,
    n: rows.length,
    p25: Number(percentile(list, 0.25).toFixed(3)),
    p50: Number(percentile(list, 0.5).toFixed(3)),
    p75: Number(percentile(list, 0.75).toFixed(3)),
    below0_5: below(0.5),
    below1: below(1),
    below2: below(2),
    below3: below(3),
  }
})

console.log(
  JSON.stringify(
    {
      day,
      whitelistOfferCount: unique.length,
      withTrafficCount: withTraffic.length,
      rpm: {
        min: Number(Math.min(...rpms, 0).toFixed(3)),
        p25: Number(percentile(rpms, 0.25).toFixed(3)),
        p50: Number(percentile(rpms, 0.5).toFixed(3)),
        p75: Number(percentile(rpms, 0.75).toFixed(3)),
        p90: Number(percentile(rpms, 0.9).toFixed(3)),
        max: Number(Math.max(...rpms, 0).toFixed(3)),
      },
      candidates: {
        below1: countBelow(1),
        below2: countBelow(2),
        below3: countBelow(3),
        below5: countBelow(5),
        below10: countBelow(10),
      },
      visitFloors,
      byPartner,
      topRefsSample: [...withTraffic]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8)
        .map((r) => ({
          partner: r.partner,
          funnelName: r.funnelName,
          offerName: r.offerName,
          revenue: r.revenue,
          funnelRpm: r.funnelRpm,
          ref: r.ref,
        })),
    },
    null,
    2,
  ),
)
