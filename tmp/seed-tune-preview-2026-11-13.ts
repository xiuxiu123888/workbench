import fs from 'node:fs'
import { FUNNEL_BROWSE_ALLOWLIST } from '../src/domain/funnelBrowseAllowlist'
import { partnerPrefix } from '../src/domain/offerOptimizeBatch'

function refFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).searchParams.get('ref') || '').trim()
  } catch {
    const m = String(url || '').match(/[?&]ref=([^&#]*)/)
    return m?.[1] ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : ''
  }
}

function funnelFromOfferName(name: string): string {
  // Blinkdrama-v01-A4-... → try match allowlist prefixes
  const n = String(name || '')
  const hit = FUNNEL_BROWSE_ALLOWLIST.find((f) => n.toLowerCase().startsWith(f.toLowerCase() + '-'))
  return hit || n.split('-A')[0] || n
}

const day = '2026-11-13'
const j = JSON.parse(fs.readFileSync(`data/ops-center/metrics/${day}/all.json`, 'utf8')) as {
  statsList: any[]
}
const allow = new Set(FUNNEL_BROWSE_ALLOWLIST.map((x) => x.toLowerCase()))

type Agg = {
  ref: string
  offers: number
  partners: Set<string>
  funnelClicks: number
  adClicks: number
  revenue: number
  visits: number
}

const byRef = new Map<string, Agg>()
const rows: any[] = []

for (const item of j.statsList || []) {
  const name = String(item.name || '')
  if (/default/i.test(name)) continue
  const funnel = funnelFromOfferName(name)
  if (!allow.has(funnel.toLowerCase())) continue
  const ref = refFromUrl(String(item.url || ''))
  if (!ref) continue
  const fc = Number(item.funnelClicks || 0)
  const ad = Number(item.clicks || 0)
  const rev = Number(item.revenue || 0)
  const visits = Number(item.visits || 0)
  const partner = partnerPrefix(funnel)
  rows.push({ name, funnel, partner, ref, fc, ad, rev, visits, rpm: Number(item.funnelRpm || 0) })
  const cur = byRef.get(ref.toLowerCase()) || {
    ref,
    offers: 0,
    partners: new Set<string>(),
    funnelClicks: 0,
    adClicks: 0,
    revenue: 0,
    visits: 0,
  }
  cur.offers += 1
  cur.partners.add(partner)
  cur.funnelClicks += fc
  cur.adClicks += ad
  cur.revenue += rev
  cur.visits += visits
  byRef.set(ref.toLowerCase(), cur)
}

function second(a: Agg) {
  return a.funnelClicks > 0 ? (a.adClicks / a.funnelClicks) * 100 : 0
}
function rpm(a: Agg) {
  return a.visits > 0 ? (a.revenue / a.visits) * 1000 : 0
}

const aggs = [...byRef.values()].map((a) => ({
  ref: a.ref,
  offers: a.offers,
  partners: [...a.partners].sort(),
  partnerCount: a.partners.size,
  funnelClicks: a.funnelClicks,
  adClicks: a.adClicks,
  revenue: Number(a.revenue.toFixed(2)),
  visits: a.visits,
  secondHopPct: Number(second(a).toFixed(2)),
  rpm: Number(rpm(a).toFixed(2)),
}))

const donors = aggs
  .filter((a) => a.funnelClicks >= 200 && a.adClicks > 0 && a.revenue >= 5)
  .sort((a, b) => b.revenue - a.revenue || b.secondHopPct - a.secondHopPct)

const weak = aggs
  .filter((a) => a.funnelClicks >= 100 && (a.adClicks === 0 || a.secondHopPct < 2 || a.rpm < 1))
  .sort((a, b) => b.funnelClicks - a.funnelClicks)

// cross-partner: refs that win on >=2 partners
const crossWinners = donors.filter((a) => a.partnerCount >= 2).slice(0, 15)

const suggestions = weak.slice(0, 25).map((w) => {
  const donor =
    donors.find((d) => d.ref.toLowerCase() !== w.ref.toLowerCase() && d.secondHopPct >= 5) ||
    donors.find((d) => d.ref.toLowerCase() !== w.ref.toLowerCase())
  return {
    weakRef: w.ref,
    weakFc: w.funnelClicks,
    weakSecond: w.secondHopPct,
    weakRpm: w.rpm,
    weakRev: w.revenue,
    suggestRef: donor?.ref || null,
    donorRev: donor?.revenue ?? null,
    donorSecond: donor?.secondHopPct ?? null,
    donorPartners: donor?.partners ?? [],
  }
})

const out = {
  day,
  whitelistOffers: rows.length,
  uniqueRefs: aggs.length,
  topDonors: donors.slice(0, 15),
  crossPartnerWinners: crossWinners,
  weakRefs: weak.slice(0, 20),
  suggestions: suggestions.slice(0, 20),
}
fs.writeFileSync('tmp/seed-tune-preview-2026-11-13.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
