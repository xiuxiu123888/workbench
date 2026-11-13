/** Offer 优化批次：优化前快照 + 可请求的优化后回收对比报告 */

export type OptimizePriority = 'P0' | 'P1' | 'P2'

export interface OfferMetricSnapshot {
  offerId: string
  offerName: string
  funnelName: string
  partner: string
  ref: string
  url: string | null
  visits: number
  funnelImpressions: number
  funnelClicks: number
  adClicks: number
  conversion: number
  revenue: number
  funnelRpm: number
  rpc: number
  secondHopPct: number
  capturedAt: string
  metricsDay: string
}

export interface OptimizeBatchItem {
  offerId: string
  offerName: string
  funnelName: string
  partner: string
  priority: OptimizePriority
  reason: string
  /** 优化前落地 ref */
  beforeRef: string
  /** 计划借种 / 换文种子 */
  plannedSeedRef: string
  /** 实际写回后的 ref（换文成功后回填） */
  afterRef: string | null
  beforeUrl: string | null
  afterUrl: string | null
  donorOfferName: string | null
  donorFunnelName: string | null
  action: 'produce-write' | 'same-ref-skip' | 'manual-seed'
  status: 'planned' | 'written' | 'skipped' | 'failed'
  note: string
  before: OfferMetricSnapshot
  after: OfferMetricSnapshot | null
}

export interface OptimizeBatch {
  id: string
  title: string
  createdAt: string
  beforeMetricsDay: string
  afterMetricsDay: string | null
  harvestedAt: string | null
  rulesVersion: string
  notes: string
  itemCount: number
  items: OptimizeBatchItem[]
  reportText: string | null
}

export interface OptimizeBatchIndexEntry {
  id: string
  title: string
  createdAt: string
  beforeMetricsDay: string
  afterMetricsDay: string | null
  harvestedAt: string | null
  itemCount: number
  writtenCount: number
  path: string
}

export interface OptimizeBatchIndex {
  updatedAt: string
  batches: OptimizeBatchIndexEntry[]
}

/** 定时换文节奏（页面可配；调度器后续接） */
export interface OptimizeScheduleConfig {
  enabled: boolean
  /** 每隔多少小时跑一轮，默认 3 */
  intervalHours: number
  /** 每轮最多换几条（半自动建议先小） */
  maxPerRun: number
  /** 优先队列：P0 / P0+P1 */
  priorities: OptimizePriority[]
  excludeDefault: boolean
  samePartnerBorrow: boolean
  /** 写回是否需预览确认（默认 true） */
  requirePreview: boolean
  lastPlannedAt: string | null
  lastRunAt: string | null
  notes: string
  updatedAt: string
}

export function defaultOptimizeSchedule(): OptimizeScheduleConfig {
  return {
    enabled: false,
    intervalHours: 3,
    maxPerRun: 10,
    priorities: ['P0'],
    excludeDefault: true,
    samePartnerBorrow: true,
    requirePreview: true,
    lastPlannedAt: null,
    lastRunAt: null,
    notes: '每 3 小时按 P0 优先建优化批次；写回前预览。调度器下一阶段接通。',
    updatedAt: new Date().toISOString(),
  }
}

export function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function secondHopPct(adClicks: number, funnelClicks: number): number {
  return funnelClicks > 0 ? (adClicks / funnelClicks) * 100 : 0
}

export function rpcOf(revenue: number, funnelClicks: number): number {
  return funnelClicks > 0 ? revenue / funnelClicks : 0
}

export function buildMetricSnapshot(input: {
  offerId: string
  offerName: string
  funnelName: string
  partner: string
  ref: string
  url?: string | null
  visits?: unknown
  funnelImpressions?: unknown
  funnelClicks?: unknown
  adClicks?: unknown
  conversion?: unknown
  revenue?: unknown
  funnelRpm?: unknown
  metricsDay: string
  capturedAt?: string
}): OfferMetricSnapshot {
  const funnelClicks = num(input.funnelClicks)
  const adClicks = num(input.adClicks)
  const revenue = num(input.revenue)
  return {
    offerId: String(input.offerId || '').trim(),
    offerName: String(input.offerName || '').trim(),
    funnelName: String(input.funnelName || '').trim(),
    partner: String(input.partner || '').trim(),
    ref: String(input.ref || '').trim(),
    url: input.url == null || String(input.url).trim() === '' ? null : String(input.url).trim(),
    visits: num(input.visits),
    funnelImpressions: num(input.funnelImpressions),
    funnelClicks,
    adClicks,
    conversion: num(input.conversion),
    revenue,
    funnelRpm: num(input.funnelRpm),
    rpc: rpcOf(revenue, funnelClicks),
    secondHopPct: secondHopPct(adClicks, funnelClicks),
    capturedAt: input.capturedAt || new Date().toISOString(),
    metricsDay: String(input.metricsDay || '').trim(),
  }
}

export function delta(before: number, after: number): number {
  return after - before
}

export function formatOptimizeCompareReport(batch: OptimizeBatch): string {
  const lines: string[] = []
  lines.push(`【Offer优化对比报告】${batch.title}`)
  lines.push(`批次 ${batch.id}`)
  lines.push(`优化前指标日 ${batch.beforeMetricsDay}`)
  lines.push(`优化后指标日 ${batch.afterMetricsDay || '（尚未回收）'}`)
  lines.push(`回收时间 ${batch.harvestedAt || '—'}`)
  lines.push(`条目 ${batch.itemCount}`)
  lines.push('')

  const harvested = batch.items.filter((item) => item.after)
  if (!harvested.length) {
    lines.push('尚未回收优化后数据。请求 harvest 后再看对比。')
    return lines.join('\n')
  }

  let revUp = 0
  let hopUp = 0
  let stillNoAd = 0
  for (const item of harvested) {
    const after = item.after!
    if (after.revenue > item.before.revenue) revUp += 1
    if (after.secondHopPct > item.before.secondHopPct) hopUp += 1
    if (after.adClicks <= 0 && after.conversion <= 0 && after.funnelClicks >= 50) stillNoAd += 1
  }

  lines.push('## 汇总')
  lines.push(`已回收 ${harvested.length}/${batch.itemCount}`)
  lines.push(`收入上升 ${revUp} · 二跳上升 ${hopUp} · 仍疑似无广告 ${stillNoAd}`)
  lines.push('')
  lines.push('## 明细')

  for (const item of batch.items) {
    const b = item.before
    const a = item.after
    lines.push(`- ${item.offerName} (${item.funnelName}) [${item.priority}/${item.status}]`)
    lines.push(
      `  前: ref=${b.ref || '—'} 词点击=${b.funnelClicks} 广告点击=${b.adClicks} 转化=${b.conversion} rev=$${b.revenue.toFixed(2)} RPM=${b.funnelRpm.toFixed(2)} 二跳=${b.secondHopPct.toFixed(2)}%`,
    )
    if (!a) {
      lines.push('  后: （未回收）')
      continue
    }
    lines.push(
      `  后: ref=${a.ref || item.afterRef || '—'} 词点击=${a.funnelClicks} 广告点击=${a.adClicks} 转化=${a.conversion} rev=$${a.revenue.toFixed(2)} RPM=${a.funnelRpm.toFixed(2)} 二跳=${a.secondHopPct.toFixed(2)}%`,
    )
    lines.push(
      `  Δ: 词点击${fmtDelta(delta(b.funnelClicks, a.funnelClicks))} 广告点击${fmtDelta(delta(b.adClicks, a.adClicks))} 转化${fmtDelta(delta(b.conversion, a.conversion))} rev$${fmtDelta(delta(b.revenue, a.revenue), 2)} 二跳${fmtDelta(delta(b.secondHopPct, a.secondHopPct), 2)}%`,
    )
  }

  return lines.join('\n')
}

function fmtDelta(n: number, digits = 0): string {
  const v = digits > 0 ? n.toFixed(digits) : String(Math.round(n * 1000) / 1000)
  if (Number(v) > 0) return `+${v}`
  return String(v)
}

export function upsertBatchIndex(
  index: OptimizeBatchIndex | null,
  batch: OptimizeBatch,
  relativePath: string,
): OptimizeBatchIndex {
  const entry: OptimizeBatchIndexEntry = {
    id: batch.id,
    title: batch.title,
    createdAt: batch.createdAt,
    beforeMetricsDay: batch.beforeMetricsDay,
    afterMetricsDay: batch.afterMetricsDay,
    harvestedAt: batch.harvestedAt,
    itemCount: batch.itemCount,
    writtenCount: batch.items.filter((item) => item.status === 'written').length,
    path: relativePath,
  }
  const batches = [entry, ...(index?.batches || []).filter((row) => row.id !== batch.id)].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
  return {
    updatedAt: new Date().toISOString(),
    batches,
  }
}

export function partnerPrefix(funnelName: string): string {
  const s = String(funnelName || '').trim().toLowerCase()
  const m = s.match(/^([a-z0-9]+)/)
  return m?.[1] || s
}

export type TuneVerdict = 'good' | 'watch' | 'bad'

/** 调优好坏判定：优先看优化后；未回收则看优化前 */
export function verdictOfItem(item: OptimizeBatchItem): TuneVerdict {
  const snap = item.after || item.before
  const second = snap.secondHopPct
  const rpm = snap.funnelRpm
  const fc = snap.funnelClicks
  if (item.after) {
    if (snap.adClicks <= 0 && fc >= 50) return 'bad'
    if (second >= 8 && rpm >= 1) return 'good'
    if (second >= 2 || rpm >= 0.4) return 'watch'
    return 'bad'
  }
  // 未回收：旧词基线，仅作参考
  if (fc >= 100 && snap.adClicks <= 0) return 'bad'
  if (second >= 8 && rpm >= 1) return 'good'
  if (second >= 2 || rpm >= 0.4) return 'watch'
  return 'bad'
}

export function summarizeTuneBySeed(items: OptimizeBatchItem[]): Array<{
  seed: string
  offers: number
  good: number
  watch: number
  bad: number
  revenue: number
  funnelClicks: number
  adClicks: number
  secondHopPct: number
  verdict: TuneVerdict
}> {
  const map = new Map<
    string,
    {
      seed: string
      offers: number
      good: number
      watch: number
      bad: number
      revenue: number
      funnelClicks: number
      adClicks: number
    }
  >()
  for (const item of items) {
    const seed = item.afterRef || item.plannedSeedRef || item.beforeRef || '(空)'
    const snap = item.after || item.before
    const row = map.get(seed) || {
      seed,
      offers: 0,
      good: 0,
      watch: 0,
      bad: 0,
      revenue: 0,
      funnelClicks: 0,
      adClicks: 0,
    }
    row.offers += 1
    const v = verdictOfItem(item)
    if (v === 'good') row.good += 1
    else if (v === 'watch') row.watch += 1
    else row.bad += 1
    row.revenue += snap.revenue
    row.funnelClicks += snap.funnelClicks
    row.adClicks += snap.adClicks
    map.set(seed, row)
  }
  return [...map.values()]
    .map((row) => {
      const secondHopPct = row.funnelClicks > 0 ? (row.adClicks / row.funnelClicks) * 100 : 0
      let verdict: TuneVerdict = 'watch'
      if (row.good >= row.bad && row.good > 0 && secondHopPct >= 5) verdict = 'good'
      else if (row.bad > row.good || secondHopPct < 2) verdict = 'bad'
      return { ...row, secondHopPct, verdict }
    })
    .sort((a, b) => b.revenue - a.revenue)
}

export function refFromUrl(url: string | null | undefined): string {
  try {
    return String(new URL(String(url || '')).searchParams.get('ref') || '')
      .replace(/\+/g, ' ')
      .trim()
  } catch {
    return ''
  }
}
