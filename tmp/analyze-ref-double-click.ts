import fs from 'node:fs'
import { isAllowedBrowseFunnel } from '../src/domain/funnelBrowseAllowlist'

type Stats = {
  id?: string
  name?: string
  visits?: number
  views?: number
  conversion?: number
  revenue?: string | number
  funnelImpressions?: number
  funnelClicks?: number
  clicks?: number
  funnelRpm?: string | number
  rpc?: string | number
  funnelCtr?: string | number
  cvr1?: string | number
  cvr2?: string | number
  url?: string | null
  category?: string | null
}

type Group = {
  funnelName: string
  offerList?: Array<{ offerId?: string; offerName?: string }>
}

function num(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function refFromUrl(url: string | null | undefined): string {
  const text = String(url || '').trim()
  if (!text) return ''
  try {
    return String(new URL(text).searchParams.get('ref') || '')
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
const groups = JSON.parse(fs.readFileSync('data/ops-center/raw/groups.json', 'utf8')) as Group[]

const whitelistOfferIds = new Set<string>()
const offerNameById = new Map<string, string>()
for (const g of groups) {
  if (!isAllowedBrowseFunnel(g.funnelName)) continue
  for (const o of g.offerList || []) {
    const id = String(o.offerId || '').trim()
    if (!id) continue
    const name = String(o.offerName || id)
    if (/default/i.test(name)) continue
    whitelistOfferIds.add(id)
    offerNameById.set(id, name)
  }
}

const rows = (metrics.statsList || []).filter((r) => whitelistOfferIds.has(String(r.id || '')))

// field sanity
let clicksPositive = 0
let conversionPositive = 0
let revenuePositive = 0
let cvr1Positive = 0
let cvr2Positive = 0
for (const r of rows) {
  if (num(r.clicks) > 0) clicksPositive += 1
  if (num(r.conversion) > 0) conversionPositive += 1
  if (num(r.revenue) > 0) revenuePositive += 1
  if (num(r.cvr1) > 0) cvr1Positive += 1
  if (num(r.cvr2) > 0) cvr2Positive += 1
}

type Agg = {
  ref: string
  offers: number
  visits: number
  funnelImpressions: number
  funnelClicks: number
  clicks: number
  conversion: number
  revenue: number
  cvr1Sum: number
  cvr2Sum: number
  funnelCtrSum: number
  samples: string[]
}

const byRef = new Map<string, Agg>()
for (const r of rows) {
  const ref = refFromUrl(r.url) || '(空ref)'
  let agg = byRef.get(ref)
  if (!agg) {
    agg = {
      ref,
      offers: 0,
      visits: 0,
      funnelImpressions: 0,
      funnelClicks: 0,
      clicks: 0,
      conversion: 0,
      revenue: 0,
      cvr1Sum: 0,
      cvr2Sum: 0,
      funnelCtrSum: 0,
      samples: [],
    }
    byRef.set(ref, agg)
  }
  agg.offers += 1
  agg.visits += num(r.visits)
  agg.funnelImpressions += num(r.funnelImpressions)
  agg.funnelClicks += num(r.funnelClicks)
  agg.clicks += num(r.clicks)
  agg.conversion += num(r.conversion)
  agg.revenue += num(r.revenue)
  agg.cvr1Sum += num(r.cvr1)
  agg.cvr2Sum += num(r.cvr2)
  agg.funnelCtrSum += num(r.funnelCtr)
  if (agg.samples.length < 3) {
    agg.samples.push(String(r.name || r.id))
  }
}

function rate(n: number, d: number) {
  return d > 0 ? n / d : 0
}

const list = [...byRef.values()]
  .map((a) => {
    const keywordCtr = rate(a.funnelClicks, a.funnelImpressions) // 一跳：漏斗CTR
    const visitToConv = rate(a.conversion, a.visits) // 落地→转化
    const clickToConv = rate(a.conversion, a.funnelClicks) // 词点击→转化（二跳近似）
    const avgCvr1 = a.offers ? a.cvr1Sum / a.offers : 0
    const avgCvr2 = a.offers ? a.cvr2Sum / a.offers : 0
    const avgFunnelCtr = a.offers ? a.funnelCtrSum / a.offers : 0
    const rpc = rate(a.revenue, a.funnelClicks)
    // 疑似无广告：有词点击/访问，但转化和收入都接近 0
    const suspectNoAd =
      a.visits >= 20 &&
      a.funnelClicks >= 5 &&
      a.revenue <= 0.01 &&
      a.conversion <= 0
    // 一跳高、二跳低：漏斗CTR高但转化率极低
    const highKeywordLowSecond =
      a.funnelImpressions >= 50 &&
      keywordCtr >= 0.05 &&
      a.conversion <= 0 &&
      a.revenue <= 0.01
    return {
      ref: a.ref,
      offers: a.offers,
      visits: a.visits,
      funnelImpressions: a.funnelImpressions,
      funnelClicks: a.funnelClicks,
      adClicksField: a.clicks,
      conversion: a.conversion,
      revenue: Number(a.revenue.toFixed(2)),
      keywordCtr: Number((keywordCtr * 100).toFixed(2)), // %
      avgFunnelCtrField: Number(avgFunnelCtr.toFixed(2)),
      visitToConvPct: Number((visitToConv * 100).toFixed(2)),
      clickToConvPct: Number((clickToConv * 100).toFixed(2)),
      avgCvr1: Number(avgCvr1.toFixed(4)),
      avgCvr2: Number(avgCvr2.toFixed(4)),
      rpcPerFunnelClick: Number(rpc.toFixed(4)),
      suspectNoAd,
      highKeywordLowSecond,
      samples: a.samples,
    }
  })
  .sort((x, y) => y.funnelClicks - x.funnelClicks)

const suspect = list.filter((r) => r.suspectNoAd || r.highKeywordLowSecond)
const monetizing = list.filter((r) => r.revenue > 1).slice(0, 15)
const noAdTop = [...suspect].sort((a, b) => b.funnelClicks - a.funnelClicks).slice(0, 30)

const out = {
  day,
  scope: 'whitelist · exclude default',
  fieldSanity: {
    rows: rows.length,
    clicksPositiveOffers: clicksPositive,
    conversionPositiveOffers: conversionPositive,
    revenuePositiveOffers: revenuePositive,
    cvr1PositiveOffers: cvr1Positive,
    cvr2PositiveOffers: cvr2Positive,
    note: '若 clicks 几乎全 0，则二跳广告点击更应看 conversion / cvr1 / cvr2，而不是 clicks 字段',
  },
  totals: {
    refs: list.length,
    suspectNoAdOrHighKeywordLowSecond: suspect.length,
    monetizingRefsRevenueGt1: list.filter((r) => r.revenue > 1).length,
  },
  /** 有词点击/访问但几乎无转化无收入：疑似词条页没出广告或二跳断了 */
  suspectNoAdRefs: noAdTop,
  /** 收入较好的词，作对照 */
  topMonetizingRefs: monetizing,
}

fs.writeFileSync('tmp/ref-double-click-analysis.json', JSON.stringify(out, null, 2))

// also write a compact txt
const lines: string[] = []
lines.push(`# 词条双跳排查 ${day}`)
lines.push(`白名单非 default · 按 url.ref 聚合`)
lines.push(
  `字段体检: clicks>0 的 offer=${clicksPositive}/${rows.length} · conversion>0=${conversionPositive} · cvr1>0=${cvr1Positive} · cvr2>0=${cvr2Positive}`,
)
lines.push(`疑似无广告/二跳断 (visits≥20 且 funnelClicks≥5 且 revenue≈0 且 conversion=0): ${suspect.length} 个词`)
lines.push('')
lines.push('## 疑似无广告词条 TOP')
for (const r of noAdTop.slice(0, 25)) {
  lines.push(
    `- ${r.ref} | visits=${r.visits} funnelClicks=${r.funnelClicks} keywordCtr=${r.keywordCtr}% conv=${r.conversion} rev=$${r.revenue} cvr1=${r.avgCvr1} cvr2=${r.avgCvr2}`,
  )
}
lines.push('')
lines.push('## 有收入对照 TOP')
for (const r of monetizing.slice(0, 15)) {
  lines.push(
    `- ${r.ref} | visits=${r.visits} funnelClicks=${r.funnelClicks} keywordCtr=${r.keywordCtr}% conv=${r.conversion} rev=$${r.revenue} visitCVR=${r.visitToConvPct}% cvr1=${r.avgCvr1} cvr2=${r.avgCvr2}`,
  )
}
fs.writeFileSync('tmp/ref-double-click-analysis.txt', lines.join('\n'))
console.log(JSON.stringify({
  fieldSanity: out.fieldSanity,
  totals: out.totals,
  suspectTop10: noAdTop.slice(0, 10),
  monetizingTop8: monetizing.slice(0, 8),
  txt: 'tmp/ref-double-click-analysis.txt',
}, null, 2))
