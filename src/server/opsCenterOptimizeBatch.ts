import fs from 'node:fs'
import path from 'node:path'
import {
  buildMetricSnapshot,
  defaultOptimizeSchedule,
  formatOptimizeCompareReport,
  partnerPrefix,
  refFromUrl,
  upsertBatchIndex,
  type OptimizeBatch,
  type OptimizeBatchIndex,
  type OptimizeBatchItem,
  type OptimizePriority,
  type OptimizeScheduleConfig,
} from '../domain/offerOptimizeBatch'
import { isAllowedBrowseFunnel } from '../domain/funnelBrowseAllowlist'
import { opsCenterRoot, readOpsCenterJson, writeOpsCenterJson } from './opsCenterStore'

type StatsRow = {
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

function batchPath(id: string): string {
  return `optimize-batches/${id}.json`
}

function indexPath(): string {
  return 'optimize-batches/index.json'
}

function reportPath(id: string): string {
  return `optimize-batches/${id}.report.txt`
}

function schedulePath(): string {
  return 'optimize-batches/schedule.json'
}

export function loadOptimizeSchedule(projectRoot: string): OptimizeScheduleConfig {
  const saved = readOpsCenterJson<OptimizeScheduleConfig>(projectRoot, schedulePath())
  if (!saved) return defaultOptimizeSchedule()
  return {
    ...defaultOptimizeSchedule(),
    ...saved,
    intervalHours: Number(saved.intervalHours) > 0 ? Number(saved.intervalHours) : 3,
    maxPerRun: Number(saved.maxPerRun) > 0 ? Number(saved.maxPerRun) : 10,
    priorities: Array.isArray(saved.priorities) && saved.priorities.length ? saved.priorities : ['P0'],
  }
}

export function saveOptimizeSchedule(
  projectRoot: string,
  patch: Partial<OptimizeScheduleConfig>,
): OptimizeScheduleConfig {
  const current = loadOptimizeSchedule(projectRoot)
  const next: OptimizeScheduleConfig = {
    ...current,
    ...patch,
    intervalHours: Number(patch.intervalHours ?? current.intervalHours) || 3,
    maxPerRun: Number(patch.maxPerRun ?? current.maxPerRun) || 10,
    priorities:
      Array.isArray(patch.priorities) && patch.priorities.length
        ? patch.priorities
        : current.priorities,
    updatedAt: new Date().toISOString(),
  }
  writeOpsCenterJson(projectRoot, schedulePath(), next)
  return next
}

export function listOptimizeBatches(projectRoot: string): OptimizeBatchIndex {
  const index = readOpsCenterJson<OptimizeBatchIndex>(projectRoot, indexPath())
  return index || { updatedAt: new Date().toISOString(), batches: [] }
}

export function loadOptimizeBatch(projectRoot: string, id: string): OptimizeBatch | null {
  return readOpsCenterJson<OptimizeBatch>(projectRoot, batchPath(id))
}

export function saveOptimizeBatch(projectRoot: string, batch: OptimizeBatch): OptimizeBatch {
  const rel = batchPath(batch.id)
  writeOpsCenterJson(projectRoot, rel, batch)
  const index = listOptimizeBatches(projectRoot)
  writeOpsCenterJson(projectRoot, indexPath(), upsertBatchIndex(index, batch, rel))
  if (batch.reportText) {
    const full = path.join(opsCenterRoot(projectRoot), reportPath(batch.id))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, batch.reportText, 'utf8')
  }
  return batch
}

export function loadMetricsOfferMap(
  projectRoot: string,
  day: string,
): Map<string, StatsRow> {
  const metrics = readOpsCenterJson<{ statsList?: StatsRow[] }>(
    projectRoot,
    `metrics/${day}/all.json`,
  )
  const map = new Map<string, StatsRow>()
  for (const row of metrics?.statsList || []) {
    const id = String(row.id || '').trim()
    if (id) map.set(id, row)
  }
  return map
}

export function loadOfferFunnelMeta(projectRoot: string): Map<
  string,
  { funnelName: string; partner: string; offerName: string }
> {
  const groups = readOpsCenterJson<
    Array<{ funnelName: string; offerList?: Array<{ offerId?: string; offerName?: string }> }>
  >(projectRoot, 'raw/groups.json')
  const map = new Map<string, { funnelName: string; partner: string; offerName: string }>()
  for (const g of groups || []) {
    if (!isAllowedBrowseFunnel(g.funnelName)) continue
    const partner = partnerPrefix(g.funnelName)
    for (const o of g.offerList || []) {
      const id = String(o.offerId || '').trim()
      if (!id) continue
      map.set(id, {
        funnelName: g.funnelName,
        partner,
        offerName: String(o.offerName || ''),
      })
    }
  }
  return map
}

export function createOptimizeBatchFromQueue(input: {
  projectRoot: string
  id?: string
  title: string
  beforeMetricsDay: string
  notes?: string
  queue: Array<{
    offerId: string
    priority: OptimizePriority
    reason: string
    plannedSeedRef: string
    donorOfferName?: string | null
    donorFunnelName?: string | null
    action?: OptimizeBatchItem['action']
    status?: OptimizeBatchItem['status']
    note?: string
  }>
}): OptimizeBatch {
  const { projectRoot, title, beforeMetricsDay } = input
  const metrics = loadMetricsOfferMap(projectRoot, beforeMetricsDay)
  const meta = loadOfferFunnelMeta(projectRoot)
  const createdAt = new Date().toISOString()
  const id =
    input.id ||
    `opt-${beforeMetricsDay.replace(/-/g, '')}-${createdAt.slice(11, 19).replace(/:/g, '')}`

  const items: OptimizeBatchItem[] = []
  for (const row of input.queue) {
    const m = metrics.get(row.offerId)
    const funnelMeta = meta.get(row.offerId)
    if (!m || !funnelMeta) continue
    if (/default/i.test(funnelMeta.offerName) || /default/i.test(String(m.name || ''))) continue
    const ref = refFromUrl(m.url)
    const before = buildMetricSnapshot({
      offerId: row.offerId,
      offerName: funnelMeta.offerName || String(m.name || ''),
      funnelName: funnelMeta.funnelName,
      partner: funnelMeta.partner,
      ref,
      url: m.url,
      visits: m.visits,
      funnelImpressions: m.funnelImpressions,
      funnelClicks: m.funnelClicks,
      adClicks: m.clicks,
      conversion: m.conversion,
      revenue: m.revenue,
      funnelRpm: m.funnelRpm,
      metricsDay: beforeMetricsDay,
      capturedAt: createdAt,
    })
    const planned = String(row.plannedSeedRef || '').trim()
    const action =
      row.action ||
      (!planned
        ? 'manual-seed'
        : planned.toLowerCase() === ref.toLowerCase()
          ? 'same-ref-skip'
          : 'produce-write')
    items.push({
      offerId: row.offerId,
      offerName: before.offerName,
      funnelName: before.funnelName,
      partner: before.partner,
      priority: row.priority,
      reason: row.reason,
      beforeRef: ref,
      plannedSeedRef: planned,
      afterRef: null,
      beforeUrl: before.url,
      afterUrl: null,
      donorOfferName: row.donorOfferName ?? null,
      donorFunnelName: row.donorFunnelName ?? null,
      action,
      status: row.status || (action === 'same-ref-skip' ? 'skipped' : 'planned'),
      note: row.note || '',
      before,
      after: null,
    })
  }

  const batch: OptimizeBatch = {
    id,
    title,
    createdAt,
    beforeMetricsDay,
    afterMetricsDay: null,
    harvestedAt: null,
    rulesVersion: '2026-11-13-v1',
    notes: input.notes || '',
    itemCount: items.length,
    items,
    reportText: null,
  }
  batch.reportText = formatOptimizeCompareReport(batch)
  return saveOptimizeBatch(projectRoot, batch)
}

export function harvestOptimizeBatch(input: {
  projectRoot: string
  batchId: string
  afterMetricsDay: string
}): OptimizeBatch {
  const batch = loadOptimizeBatch(input.projectRoot, input.batchId)
  if (!batch) {
    throw new Error(`优化批次不存在: ${input.batchId}`)
  }
  const metrics = loadMetricsOfferMap(input.projectRoot, input.afterMetricsDay)
  const harvestedAt = new Date().toISOString()
  const items = batch.items.map((item) => {
    const m = metrics.get(item.offerId)
    if (!m) {
      return { ...item, after: null }
    }
    const ref = refFromUrl(m.url)
    const after = buildMetricSnapshot({
      offerId: item.offerId,
      offerName: item.offerName || String(m.name || ''),
      funnelName: item.funnelName,
      partner: item.partner,
      ref,
      url: m.url,
      visits: m.visits,
      funnelImpressions: m.funnelImpressions,
      funnelClicks: m.funnelClicks,
      adClicks: m.clicks,
      conversion: m.conversion,
      revenue: m.revenue,
      funnelRpm: m.funnelRpm,
      metricsDay: input.afterMetricsDay,
      capturedAt: harvestedAt,
    })
    return {
      ...item,
      afterRef: ref || item.afterRef,
      afterUrl: after.url,
      after,
    }
  })
  const next: OptimizeBatch = {
    ...batch,
    afterMetricsDay: input.afterMetricsDay,
    harvestedAt,
    items,
    itemCount: items.length,
    reportText: null,
  }
  next.reportText = formatOptimizeCompareReport(next)
  return saveOptimizeBatch(input.projectRoot, next)
}

export function markOptimizeBatchWritten(
  projectRoot: string,
  batchId: string,
  updates: Array<{ offerId: string; afterRef?: string; afterUrl?: string | null; note?: string }>,
): OptimizeBatch {
  const batch = loadOptimizeBatch(projectRoot, batchId)
  if (!batch) throw new Error(`优化批次不存在: ${batchId}`)
  const byId = new Map(updates.map((u) => [u.offerId, u]))
  const items = batch.items.map((item) => {
    const u = byId.get(item.offerId)
    if (!u) return item
    return {
      ...item,
      status: 'written' as const,
      afterRef: u.afterRef ?? item.afterRef,
      afterUrl: u.afterUrl ?? item.afterUrl,
      note: u.note || item.note,
    }
  })
  return saveOptimizeBatch(projectRoot, { ...batch, items, itemCount: items.length })
}
