import fs from 'node:fs'

const raw = JSON.parse(fs.readFileSync('tmp/ref-double-click-analysis.json', 'utf8')) as {
  day: string
}

// rebuild from metrics with clearer second-hop ratios
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
  funnelCtr?: string | number
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

type Agg = {
  ref: string
  offers: number
  visits: number
  funnelImpressions: number
  funnelClicks: number
  adClicks: number
  conversion: number
  revenue: number
  zeroAdClickOffers: number
  zeroConvOffers: number
}

const map = new Map<string, Agg>()
for (const r of metrics.statsList || []) {
  if (!allow.has(String(r.id || ''))) continue
  const ref = refFromUrl(r.url) || '(空ref)'
  let a = map.get(ref)
  if (!a) {
    a = {
      ref,
      offers: 0,
      visits: 0,
      funnelImpressions: 0,
      funnelClicks: 0,
      adClicks: 0,
      conversion: 0,
      revenue: 0,
      zeroAdClickOffers: 0,
      zeroConvOffers: 0,
    }
    map.set(ref, a)
  }
  a.offers += 1
  a.visits += num(r.visits)
  a.funnelImpressions += num(r.funnelImpressions)
  a.funnelClicks += num(r.funnelClicks)
  a.adClicks += num(r.clicks)
  a.conversion += num(r.conversion)
  a.revenue += num(r.revenue)
  if (num(r.clicks) <= 0 && num(r.funnelClicks) >= 10) a.zeroAdClickOffers += 1
  if (num(r.conversion) <= 0 && num(r.visits) >= 10) a.zeroConvOffers += 1
}

const list = [...map.values()]
  .map((a) => {
    const keywordCtr = a.funnelImpressions > 0 ? (a.funnelClicks / a.funnelImpressions) * 100 : 0
    const secondHopRate = a.funnelClicks > 0 ? (a.adClicks / a.funnelClicks) * 100 : 0 // 词点击→广告点击
    const convFromKeyword = a.funnelClicks > 0 ? (a.conversion / a.funnelClicks) * 100 : 0
    const weakSecond =
      a.funnelClicks >= 200 &&
      secondHopRate < 1 && // 二跳极低
      a.revenue / Math.max(a.funnelClicks, 1) < 0.005
    const noAdPattern =
      a.funnelClicks >= 100 &&
      a.adClicks <= 0 &&
      a.conversion <= 0 &&
      a.revenue <= 0.05
    return {
      ref: a.ref,
      offers: a.offers,
      funnelClicks: a.funnelClicks,
      adClicks: a.adClicks,
      conversion: a.conversion,
      revenue: Number(a.revenue.toFixed(2)),
      keywordCtrPct: Number(keywordCtr.toFixed(2)),
      secondHopPct: Number(secondHopRate.toFixed(2)),
      convFromKeywordPct: Number(convFromKeyword.toFixed(2)),
      rpcPerKeywordClick: Number((a.revenue / Math.max(a.funnelClicks, 1)).toFixed(4)),
      zeroAdClickOffers: a.zeroAdClickOffers,
      zeroConvOffers: a.zeroConvOffers,
      weakSecond,
      noAdPattern,
    }
  })
  .sort((a, b) => a.secondHopPct - b.secondHopPct)

const noAd = list.filter((r) => r.noAdPattern)
const weakSecond = list.filter((r) => r.weakSecond).sort((a, b) => b.funnelClicks - a.funnelClicks)
const healthy = [...list]
  .filter((r) => r.funnelClicks >= 200 && r.secondHopPct >= 3 && r.revenue > 5)
  .sort((a, b) => b.secondHopPct - a.secondHopPct)

const out = {
  day,
  meaning: {
    keywordCtr: 'funnelClicks / funnelImpressions ≈ 一跳（点关键词）',
    secondHop: 'clicks(广告点击) / funnelClicks ≈ 二跳（点广告）',
    note: 'cvr1/cvr2 与 clicks 同量级有值；完全无广告更可能表现为：一跳高、广告点击≈0、转化≈0',
  },
  counts: {
    refs: list.length,
    noAdPattern: noAd.length,
    weakSecondHop: weakSecond.length,
  },
  noAdPattern: noAd.slice(0, 20),
  weakestSecondHop: weakSecond.slice(0, 20),
  healthySecondHop: healthy.slice(0, 12),
}

fs.writeFileSync('tmp/ref-second-hop-analysis.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
