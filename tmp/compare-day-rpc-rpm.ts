import fs from 'node:fs'
import { isAllowedBrowseFunnel } from '../src/domain/funnelBrowseAllowlist'

type Stats = {
  id?: string
  revenue?: number
  visits?: number
  conversion?: number
  funnelClicks?: number
  funnelRpm?: number
  rpm?: number
  rpc?: number
  funnelCtr?: number
}

type Group = {
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

function loadDay(day: string) {
  const body = JSON.parse(fs.readFileSync(`data/ops-center/metrics/${day}/all.json`, 'utf8')) as {
    statsList?: Stats[]
  }
  const map = new Map<string, Stats>()
  for (const row of body.statsList || []) {
    if (row?.id) map.set(String(row.id), row)
  }
  return map
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
    if (!offerMeta.has(id)) {
      offerMeta.set(id, {
        offerName,
        funnelName: g.funnelName,
        partner: partnerPrefix(g.funnelName),
      })
    }
  }
}

function summarize(map: Map<string, Stats>) {
  let revenue = 0
  let visits = 0
  let clicks = 0
  let conversion = 0
  const rpms: number[] = []
  const rpcs: number[] = []
  const rpcPos: number[] = []
  const rpmPos: number[] = []
  let weakRpm = 0
  let weakRpc = 0
  let weakBoth = 0
  let matched = 0

  for (const [id] of offerMeta) {
    const s = map.get(id)
    if (!s) continue
    matched += 1
    const rev = num(s.revenue)
    const vis = num(s.visits)
    const clk = num(s.funnelClicks)
    const conv = num(s.conversion)
    const rpm = num(s.funnelRpm ?? s.rpm)
    // 优先用字段 rpc；没有则用 revenue/clicks 推
    let rpc = num(s.rpc)
    if (!(rpc > 0) && clk > 0 && rev > 0) rpc = rev / clk
    revenue += rev
    visits += vis
    clicks += clk
    conversion += conv
    rpms.push(rpm)
    rpcs.push(rpc)
    if (rpm > 0) rpmPos.push(rpm)
    if (rpc > 0) rpcPos.push(rpc)
    if (rpm < 1 && vis >= 10) weakRpm += 1
    if (rpc < 0.01 && clk >= 20) weakRpc += 1
    if (rpm < 1 && rpc < 0.01 && vis >= 10) weakBoth += 1
  }

  const overallRpc = clicks > 0 ? revenue / clicks : 0
  const overallRpmApprox = visits > 0 ? (revenue / visits) * 1000 : 0

  return {
    matched,
    revenue: Number(revenue.toFixed(2)),
    visits,
    funnelClicks: clicks,
    conversion: Number(conversion.toFixed(2)),
    overallRpc: Number(overallRpc.toFixed(4)),
    overallRpmFromVisits: Number(overallRpmApprox.toFixed(3)),
    rpm: {
      p50: Number(pct(rpms, 0.5).toFixed(3)),
      p75: Number(pct(rpms, 0.75).toFixed(3)),
      p90: Number(pct(rpms, 0.9).toFixed(3)),
      avgPos: rpmPos.length
        ? Number((rpmPos.reduce((a, b) => a + b, 0) / rpmPos.length).toFixed(3))
        : 0,
      positiveCount: rpmPos.length,
    },
    rpc: {
      p50: Number(pct(rpcs, 0.5).toFixed(4)),
      p75: Number(pct(rpcs, 0.75).toFixed(4)),
      p90: Number(pct(rpcs, 0.9).toFixed(4)),
      avgPos: rpcPos.length
        ? Number((rpcPos.reduce((a, b) => a + b, 0) / rpcPos.length).toFixed(4))
        : 0,
      positiveCount: rpcPos.length,
    },
    weak: {
      rpmBelow1VisitsGe10: weakRpm,
      rpcBelow0_01ClicksGe20: weakRpc,
      bothWeak: weakBoth,
    },
  }
}

const dayA = '2026-11-12'
const dayB = '2026-11-13'
const a = summarize(loadDay(dayA))
const b = summarize(loadDay(dayB))

const partners = [...new Set([...offerMeta.values()].map((x) => x.partner))].sort()
const byPartner = partners
  .map((partner) => {
    const ids = [...offerMeta.entries()].filter(([, m]) => m.partner === partner).map(([id]) => id)
    function one(map: Map<string, Stats>) {
      let revenue = 0
      let clicks = 0
      let visits = 0
      for (const id of ids) {
        const s = map.get(id)
        if (!s) continue
        revenue += num(s.revenue)
        clicks += num(s.funnelClicks)
        visits += num(s.visits)
      }
      return {
        revenue: Number(revenue.toFixed(2)),
        visits,
        clicks,
        rpc: clicks > 0 ? Number((revenue / clicks).toFixed(4)) : 0,
      }
    }
    const ya = one(loadDay(dayA))
    const yb = one(loadDay(dayB))
    return {
      partner,
      yesterday: ya,
      today: yb,
      revenueDelta: Number((yb.revenue - ya.revenue).toFixed(2)),
      rpcDelta: Number((yb.rpc - ya.rpc).toFixed(4)),
    }
  })
  .sort((x, y) => y.rpcDelta - x.rpcDelta)

const out = {
  scope: 'whitelist · exclude default offerName · half-day caution for today',
  yesterday: a,
  today: b,
  delta: {
    revenue: Number((b.revenue - a.revenue).toFixed(2)),
    visits: b.visits - a.visits,
    funnelClicks: b.funnelClicks - a.funnelClicks,
    overallRpc: Number((b.overallRpc - a.overallRpc).toFixed(4)),
    rpmP50: Number((b.rpm.p50 - a.rpm.p50).toFixed(3)),
    rpcP50: Number((b.rpc.p50 - a.rpc.p50).toFixed(4)),
    weakRpm: b.weak.rpmBelow1VisitsGe10 - a.weak.rpmBelow1VisitsGe10,
    weakRpc: b.weak.rpcBelow0_01ClicksGe20 - a.weak.rpcBelow0_01ClicksGe20,
  },
  byPartner,
}

fs.writeFileSync('tmp/compare-day-rpc-rpm.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
