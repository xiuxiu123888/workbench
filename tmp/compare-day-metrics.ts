import fs from 'node:fs'
import { isAllowedBrowseFunnel } from '../src/domain/funnelBrowseAllowlist'

type Stats = {
  id?: string
  name?: string
  revenue?: number
  visits?: number
  conversion?: number
  funnelClicks?: number
  funnelImpressions?: number
  impressions?: number
  funnelRpm?: number
  rpm?: number
  funnelCtr?: number
}

type Group = {
  funnelId: string
  funnelName: string
  offerList?: Array<{ offerId?: string; offerName?: string }>
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

function loadDay(day: string) {
  const path = `data/ops-center/metrics/${day}/all.json`
  if (!fs.existsSync(path)) return null
  const body = JSON.parse(fs.readFileSync(path, 'utf8')) as { statsList?: Stats[] }
  const map = new Map<string, Stats>()
  for (const row of body.statsList || []) {
    if (row?.id) map.set(String(row.id), row)
  }
  return map
}

function num(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pct(values: number[], p: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[i]
}

const groups = JSON.parse(fs.readFileSync('data/ops-center/raw/groups.json', 'utf8')) as Group[]
const offerMeta = new Map<string, { offerName: string; funnelName: string; partner: string }>()
for (const g of groups) {
  if (!isAllowedBrowseFunnel(g.funnelName)) continue
  for (const o of g.offerList || []) {
    const id = String(o.offerId || '').trim()
    if (!id) continue
    const offerName = String(o.offerName || id)
    if (/default/i.test(offerName)) continue
    const prev = offerMeta.get(id)
    if (!prev) {
      offerMeta.set(id, {
        offerName,
        funnelName: g.funnelName,
        partner: partnerPrefix(g.funnelName),
      })
    }
  }
}

const dayA = '2026-11-12'
const dayB = '2026-11-13'
const mapA = loadDay(dayA)
const mapB = loadDay(dayB)
if (!mapA || !mapB) {
  console.log(JSON.stringify({ error: 'missing day metrics', dayA: Boolean(mapA), dayB: Boolean(mapB) }))
  process.exit(0)
}

type Agg = {
  offerCount: number
  revenue: number
  visits: number
  conversion: number
  funnelClicks: number
  rpmList: number[]
  rpmPosList: number[]
  below1: number
  below1WithVisits10: number
}

function summarize(map: Map<string, Stats>): Agg {
  const agg: Agg = {
    offerCount: 0,
    revenue: 0,
    visits: 0,
    conversion: 0,
    funnelClicks: 0,
    rpmList: [],
    rpmPosList: [],
    below1: 0,
    below1WithVisits10: 0,
  }
  for (const [id] of offerMeta) {
    const s = map.get(id)
    if (!s) continue
    agg.offerCount += 1
    const revenue = num(s.revenue)
    const visits = num(s.visits)
    const conversion = num(s.conversion)
    const funnelClicks = num(s.funnelClicks)
    const rpm = num(s.funnelRpm ?? s.rpm)
    agg.revenue += revenue
    agg.visits += visits
    agg.conversion += conversion
    agg.funnelClicks += funnelClicks
    agg.rpmList.push(rpm)
    if (rpm > 0) agg.rpmPosList.push(rpm)
    if (rpm < 1) agg.below1 += 1
    if (rpm < 1 && visits >= 10) agg.below1WithVisits10 += 1
  }
  return agg
}

function pack(label: string, agg: Agg) {
  return {
    day: label,
    matchedOffers: agg.offerCount,
    revenue: Number(agg.revenue.toFixed(2)),
    visits: agg.visits,
    conversion: Number(agg.conversion.toFixed(2)),
    funnelClicks: agg.funnelClicks,
    rpm: {
      p50: Number(pct(agg.rpmList, 0.5).toFixed(3)),
      p75: Number(pct(agg.rpmList, 0.75).toFixed(3)),
      p90: Number(pct(agg.rpmList, 0.9).toFixed(3)),
      avgPos: agg.rpmPosList.length
        ? Number((agg.rpmPosList.reduce((a, b) => a + b, 0) / agg.rpmPosList.length).toFixed(3))
        : 0,
      positiveCount: agg.rpmPosList.length,
    },
    weak: {
      rpmBelow1: agg.below1,
      rpmBelow1VisitsGe10: agg.below1WithVisits10,
    },
  }
}

const a = summarize(mapA)
const b = summarize(mapB)

// partner compare
const partners = [...new Set([...offerMeta.values()].map((x) => x.partner))].sort()
const byPartner = partners.map((partner) => {
  const ids = [...offerMeta.entries()].filter(([, m]) => m.partner === partner).map(([id]) => id)
  function sum(map: Map<string, Stats>) {
    let revenue = 0
    let visits = 0
    let weak = 0
    for (const id of ids) {
      const s = map.get(id)
      if (!s) continue
      revenue += num(s.revenue)
      visits += num(s.visits)
      if (num(s.funnelRpm ?? s.rpm) < 1 && num(s.visits) >= 10) weak += 1
    }
    return { revenue: Number(revenue.toFixed(2)), visits, weak }
  }
  const pa = sum(mapA)
  const pb = sum(mapB)
  return {
    partner,
    yesterday: pa,
    today: pb,
    revenueDelta: Number((pb.revenue - pa.revenue).toFixed(2)),
    visitsDelta: pb.visits - pa.visits,
    weakDelta: pb.weak - pa.weak,
  }
})

// top improved / worsened offers (non-default) by revenue delta
const deltas = [...offerMeta.entries()]
  .map(([id, meta]) => {
    const sa = mapA.get(id)
    const sb = mapB.get(id)
    const revA = num(sa?.revenue)
    const revB = num(sb?.revenue)
    const rpmA = num(sa?.funnelRpm ?? sa?.rpm)
    const rpmB = num(sb?.funnelRpm ?? sb?.rpm)
    const visA = num(sa?.visits)
    const visB = num(sb?.visits)
    return {
      offerId: id,
      offerName: meta.offerName,
      funnelName: meta.funnelName,
      partner: meta.partner,
      revenueDelta: Number((revB - revA).toFixed(2)),
      rpmDelta: Number((rpmB - rpmA).toFixed(3)),
      visitsDelta: visB - visA,
      yesterday: { revenue: revA, rpm: rpmA, visits: visA },
      today: { revenue: revB, rpm: rpmB, visits: visB },
    }
  })
  .filter((r) => r.yesterday.visits > 0 || r.today.visits > 0 || r.yesterday.revenue > 0 || r.today.revenue > 0)

const improved = [...deltas].sort((x, y) => y.revenueDelta - x.revenueDelta).slice(0, 8)
const worsened = [...deltas].sort((x, y) => x.revenueDelta - y.revenueDelta).slice(0, 8)

const out = {
  scope: 'whitelist · exclude offerName contains default',
  yesterday: pack(dayA, a),
  today: pack(dayB, b),
  delta: {
    revenue: Number((b.revenue - a.revenue).toFixed(2)),
    visits: b.visits - a.visits,
    conversion: Number((b.conversion - a.conversion).toFixed(2)),
    funnelClicks: b.funnelClicks - a.funnelClicks,
    weakRpmBelow1VisitsGe10: b.below1WithVisits10 - a.below1WithVisits10,
  },
  byPartner: byPartner.sort((x, y) => y.revenueDelta - x.revenueDelta),
  topImproved: improved,
  topWorsened: worsened,
}

fs.writeFileSync('tmp/compare-day-metrics.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
