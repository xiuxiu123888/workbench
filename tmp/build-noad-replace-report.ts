/**
 * 今日优先换文报告：无广告/二跳断 offer → 同合作商前缀借高收 ref
 */
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
  funnelRpm?: string | number
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

/** Blinkdrama-sign-v01 / moboreels-v02 → blinkdrama / moboreels */
function partnerPrefix(funnelName: string): string {
  const s = String(funnelName || '').trim().toLowerCase()
  const m = s.match(/^([a-z0-9]+)/)
  return m?.[1] || s
}

function rpc(rev: number, funnelClicks: number) {
  return funnelClicks > 0 ? rev / funnelClicks : 0
}

const day = '2026-11-13'
const metrics = JSON.parse(fs.readFileSync(`data/ops-center/metrics/${day}/all.json`, 'utf8')) as {
  statsList?: Stats[]
}
const groups = JSON.parse(fs.readFileSync('data/ops-center/raw/groups.json', 'utf8')) as Array<{
  funnelName: string
  offerList?: Array<{ offerId?: string; offerName?: string }>
}>

const offerMeta = new Map<string, { funnelName: string; partner: string; offerName: string }>()
for (const g of groups) {
  if (!isAllowedBrowseFunnel(g.funnelName)) continue
  const partner = partnerPrefix(g.funnelName)
  for (const o of g.offerList || []) {
    const id = String(o.offerId || '')
    const name = String(o.offerName || '')
    if (!id) continue
    offerMeta.set(id, { funnelName: g.funnelName, partner, offerName: name })
  }
}

type Row = {
  offerId: string
  offerName: string
  funnelName: string
  partner: string
  ref: string
  visits: number
  funnelClicks: number
  adClicks: number
  conversion: number
  revenue: number
  funnelRpm: number
  rpc: number
  secondHop: number
  isDefault: boolean
  url: string
}

const rows: Row[] = []
for (const r of metrics.statsList || []) {
  const id = String(r.id || '')
  const meta = offerMeta.get(id)
  if (!meta) continue
  const isDefault = /default/i.test(meta.offerName) || /default/i.test(String(r.name || ''))
  const fc = num(r.funnelClicks)
  const ac = num(r.clicks)
  const rev = num(r.revenue)
  rows.push({
    offerId: id,
    offerName: meta.offerName || String(r.name || ''),
    funnelName: meta.funnelName,
    partner: meta.partner,
    ref: refFromUrl(r.url),
    visits: num(r.visits),
    funnelClicks: fc,
    adClicks: ac,
    conversion: num(r.conversion),
    revenue: rev,
    funnelRpm: num(r.funnelRpm),
    rpc: rpc(rev, fc),
    secondHop: fc > 0 ? (ac / fc) * 100 : 0,
    isDefault,
    url: String(r.url || ''),
  })
}

const nonDefault = rows.filter((r) => !r.isDefault)

// 同商高收 donor：收入最高，且有正转化或正广告点击，且有 ref
const donorsByPartner = new Map<string, Row>()
for (const r of nonDefault) {
  if (!r.ref) continue
  if (r.revenue < 5) continue
  if (r.adClicks <= 0 && r.conversion <= 0) continue
  const cur = donorsByPartner.get(r.partner)
  if (!cur || r.revenue > cur.revenue) donorsByPartner.set(r.partner, r)
}

// P0：无广告模式（词点击够、广告点击0、转化0）
const p0 = nonDefault
  .filter((r) => r.funnelClicks >= 50 && r.adClicks <= 0 && r.conversion <= 0)
  .sort((a, b) => b.funnelClicks - a.funnelClicks)

// P1：弱二跳（二跳<2% 且词点击>=100）且非 P0
const p0Ids = new Set(p0.map((r) => r.offerId))
const p1 = nonDefault
  .filter(
    (r) =>
      !p0Ids.has(r.offerId) &&
      r.funnelClicks >= 100 &&
      r.secondHop < 2 &&
      (r.funnelRpm < 1 || r.rpc < 0.01),
  )
  .sort((a, b) => b.funnelClicks - a.funnelClicks)

// P2：常规自动规则候选 RPM<1 + visits>=50
const p2 = nonDefault
  .filter(
    (r) =>
      !p0Ids.has(r.offerId) &&
      !p1.some((x) => x.offerId === r.offerId) &&
      r.visits >= 50 &&
      r.funnelRpm < 1,
  )
  .sort((a, b) => a.funnelRpm - b.funnelRpm || b.visits - a.visits)

function pickSeed(target: Row): {
  seedRef: string
  donorOffer: string
  donorFunnel: string
  donorRevenue: number
  donorSecondHop: number
  reason: string
} {
  const donor = donorsByPartner.get(target.partner)
  if (!donor) {
    return {
      seedRef: '',
      donorOffer: '',
      donorFunnel: '',
      donorRevenue: 0,
      donorSecondHop: 0,
      reason: '同商无合格高收 donor',
    }
  }
  if (donor.offerId === target.offerId) {
    return {
      seedRef: '',
      donorOffer: donor.offerName,
      donorFunnel: donor.funnelName,
      donorRevenue: donor.revenue,
      donorSecondHop: donor.secondHop,
      reason: '自身即商内最高收，跳过借词',
    }
  }
  return {
    seedRef: donor.ref,
    donorOffer: donor.offerName,
    donorFunnel: donor.funnelName,
    donorRevenue: Number(donor.revenue.toFixed(2)),
    donorSecondHop: Number(donor.secondHop.toFixed(2)),
    reason: `同商 ${target.partner} 收入最高非default`,
  }
}

function pack(list: Row[], priority: string, reason: string) {
  return list.map((r, i) => {
    const seed = pickSeed(r)
    return {
      rank: i + 1,
      priority,
      reason,
      offerId: r.offerId,
      offerName: r.offerName,
      funnelName: r.funnelName,
      partner: r.partner,
      currentRef: r.ref,
      funnelClicks: r.funnelClicks,
      adClicks: r.adClicks,
      conversion: r.conversion,
      revenue: Number(r.revenue.toFixed(2)),
      funnelRpm: Number(r.funnelRpm.toFixed(2)),
      rpc: Number(r.rpc.toFixed(4)),
      secondHopPct: Number(r.secondHop.toFixed(2)),
      borrowSeedRef: seed.seedRef,
      donorOffer: seed.donorOffer,
      donorFunnel: seed.donorFunnel,
      donorRevenue: seed.donorRevenue,
      donorSecondHopPct: seed.donorSecondHop,
      seedNote: seed.reason,
      action:
        seed.seedRef && seed.seedRef.toLowerCase() !== r.ref.toLowerCase()
          ? '产文+写回'
          : seed.seedRef
            ? '同词跳过/换域再试'
            : '人工指定种子',
    }
  })
}

const report = {
  day,
  generatedAt: new Date().toISOString(),
  rules: {
    excludeDefault: true,
    allowlistOnly: true,
    seedSource: '同合作商前缀内收入最高且有广告点击/转化的非default offer.ref',
    p0: 'funnelClicks≥50 & adClicks=0 & conversion=0（疑似无广告，本批优先）',
    p1: 'funnelClicks≥100 & 二跳<2% & (RPM<1|RPC<0.01)',
    p2: 'visits≥50 & RPM<1（常规自动队列，本轮建议暂缓全自动）',
    writeback: '产文 publish=true → 预览确认 → 写 resultUrl；url 仅替换文章id+ref',
  },
  donorByPartner: [...donorsByPartner.entries()].map(([partner, d]) => ({
    partner,
    offerName: d.offerName,
    funnelName: d.funnelName,
    ref: d.ref,
    revenue: Number(d.revenue.toFixed(2)),
    secondHopPct: Number(d.secondHop.toFixed(2)),
    funnelRpm: Number(d.funnelRpm.toFixed(2)),
  })),
  counts: { p0: p0.length, p1: p1.length, p2: p2.length },
  p0Queue: pack(p0, 'P0-无广告', '词点击有、广告点击/转化≈0，优先换文'),
  p1Queue: pack(p1.slice(0, 30), 'P1-弱二跳', '二跳极低且效率差'),
  p2Preview: pack(p2.slice(0, 15), 'P2-低RPM', '常规阈值候选（建议先人工/半自动）'),
}

fs.writeFileSync('tmp/noad-replace-report.json', JSON.stringify(report, null, 2))

const lines: string[] = []
lines.push(`【优先换文报告】指标日 ${day}`)
lines.push(`P0无广告 ${report.counts.p0} · P1弱二跳 ${report.counts.p1} · P2低RPM预览 ${report.counts.p2}`)
lines.push('')
lines.push('## 同商借词 Donor（高收非default）')
for (const d of report.donorByPartner) {
  lines.push(
    `- ${d.partner}: ${d.ref} ← ${d.offerName} (${d.funnelName}) rev$${d.revenue} 二跳${d.secondHopPct}%`,
  )
}
lines.push('')
lines.push('## P0 无广告优先队列（建议本批先换）')
for (const r of report.p0Queue) {
  lines.push(
    `${r.rank}. [${r.partner}/${r.funnelName}] ${r.offerName}`,
  )
  lines.push(
    `   现状: 词点击${r.funnelClicks} 广告点击${r.adClicks} 转化${r.conversion} rev$${r.revenue} RPM${r.funnelRpm} 二跳${r.secondHopPct}%`,
  )
  lines.push(
    `   当前ref: ${r.currentRef || '(空)'}`,
  )
  lines.push(
    `   借种: ${r.borrowSeedRef || '—'} ← ${r.donorOffer || '—'} (${r.donorFunnel || '—'}) | ${r.action}`,
  )
}
lines.push('')
lines.push('## P1 弱二跳（次优先，前15）')
for (const r of report.p1Queue.slice(0, 15)) {
  lines.push(
    `${r.rank}. ${r.offerName} | 词点击${r.funnelClicks} 二跳${r.secondHopPct}% RPM${r.funnelRpm} → 借 ${r.borrowSeedRef || '—'}`,
  )
}
lines.push('')
lines.push('## 规则摘要')
lines.push('- 排除 default；仅白名单漏斗')
lines.push('- 种子：同合作商前缀收入最高且有二跳的非default offer.ref')
lines.push('- 写回：预览后再写；resultUrl整链，url仅文章id+ref')
lines.push('- 自动节奏建议：先跑 P0 半自动；P2 全自动等傍晚整天数据后再定')

fs.writeFileSync('tmp/noad-replace-report.txt', lines.join('\n'), 'utf8')
console.log(lines.join('\n'))
console.log('\nJSON: tmp/noad-replace-report.json')
