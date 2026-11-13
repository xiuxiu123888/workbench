import fs from 'node:fs'
import { isAllowedBrowseFunnel } from '../src/domain/funnelBrowseAllowlist'

type Stats = {
  id?: string
  name?: string
  visits?: number
  conversion?: number
  revenue?: string | number
  funnelImpressions?: number
  funnelClicks?: number
  clicks?: number
  cvr1?: string | number
  cvr2?: string | number
  url?: string | null
}

function num(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function refFromUrl(url: string | null | undefined): string {
  try {
    return String(new URL(String(url || '')).searchParams.get('ref') || '')
      .replace(/\+/g, ' ')
      .trim()
  } catch {
    return ''
  }
}

const day = '2026-11-13'
const metrics = JSON.parse(fs.readFileSync(`data/ops-center/metrics/${day}/all.json`, 'utf8')) as {
  statsList?: Stats[]
}
const groups = JSON.parse(fs.readFileSync('data/ops-center/raw/groups.json', 'utf8')) as Array<{
  funnelName: string
  offerList?: Array<{ offerId?: string; offerName?: string }>
}>

const allow = new Set<string>()
for (const g of groups) {
  if (!isAllowedBrowseFunnel(g.funnelName)) continue
  for (const o of g.offerList || []) {
    const id = String(o.offerId || '')
    const name = String(o.offerName || '')
    if (!id || /default/i.test(name)) continue
    allow.add(id)
  }
}

type Row = {
  offer: string
  ref: string
  funnelClicks: number
  adClicks: number
  conversion: number
  revenue: number
  keywordCtr: number
  secondHop: number
  cvr1: number
  cvr2: number
}

const offers: Row[] = []
for (const r of metrics.statsList || []) {
  if (!allow.has(String(r.id || ''))) continue
  const fc = num(r.funnelClicks)
  const ac = num(r.clicks)
  const conv = num(r.conversion)
  const rev = num(r.revenue)
  const fi = num(r.funnelImpressions)
  if (fc < 50) continue
  offers.push({
    offer: String(r.name || '').slice(0, 80),
    ref: refFromUrl(r.url) || '(空)',
    funnelClicks: fc,
    adClicks: ac,
    conversion: conv,
    revenue: Number(rev.toFixed(2)),
    keywordCtr: fi > 0 ? Number(((fc / fi) * 100).toFixed(1)) : 0,
    secondHop: fc > 0 ? Number(((ac / fc) * 100).toFixed(2)) : 0,
    cvr1: num(r.cvr1),
    cvr2: num(r.cvr2),
  })
}
offers.sort((a, b) => a.secondHop - b.secondHop || b.funnelClicks - a.funnelClicks)

const noAd = offers.filter((o) => o.adClicks <= 0 && o.conversion <= 0)
const low2 = offers.filter((o) => o.secondHop < 2 && o.funnelClicks >= 100)
const mid = offers.filter((o) => o.secondHop >= 2 && o.secondHop < 8 && o.funnelClicks >= 100)
const high = offers.filter((o) => o.secondHop >= 8 && o.funnelClicks >= 100)

function avgRpc(arr: Row[]) {
  if (!arr.length) return 0
  return Number(
    (
      arr.reduce((s, x) => s + x.revenue / Math.max(x.funnelClicks, 1), 0) / arr.length
    ).toFixed(4),
  )
}

// ref-level: any offer with no ad clicks under that ref
const byRef = new Map<
  string,
  { offers: number; noAdOffers: number; funnelClicks: number; adClicks: number; revenue: number }
>()
for (const o of offers) {
  let a = byRef.get(o.ref)
  if (!a) a = { offers: 0, noAdOffers: 0, funnelClicks: 0, adClicks: 0, revenue: 0 }
  a.offers += 1
  a.funnelClicks += o.funnelClicks
  a.adClicks += o.adClicks
  a.revenue += o.revenue
  if (o.adClicks <= 0 && o.conversion <= 0) a.noAdOffers += 1
  byRef.set(o.ref, a)
}

const refsWithNoAdOffers = [...byRef.entries()]
  .map(([ref, a]) => ({
    ref,
    ...a,
    secondHop: a.funnelClicks > 0 ? Number(((a.adClicks / a.funnelClicks) * 100).toFixed(2)) : 0,
    noAdShare: a.offers > 0 ? Number(((a.noAdOffers / a.offers) * 100).toFixed(1)) : 0,
  }))
  .filter((r) => r.noAdOffers > 0)
  .sort((a, b) => b.noAdOffers - a.noAdOffers || b.funnelClicks - a.funnelClicks)

const summary = {
  day,
  offerRowsFc50: offers.length,
  noAdOfferCount: noAd.length,
  lowSecondHop_lt2pct: low2.length,
  mid2to8: mid.length,
  high_gte8: high.length,
  avgRpcPerKeywordClick: {
    low_lt2: avgRpc(low2),
    mid_2to8: avgRpc(mid),
    high_gte8: avgRpc(high),
  },
  noAdTop20: noAd.slice(0, 20),
  lowSecondTop15: low2.slice(0, 15),
  refsWithNoAdOffers: refsWithNoAdOffers.slice(0, 25),
}

fs.writeFileSync('tmp/ref-offer-noad.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
