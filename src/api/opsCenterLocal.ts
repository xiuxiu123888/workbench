import type {
  FunnelBrowseCatalog,
  FunnelBrowseDetail,
  OfferBrowseIndex,
} from '../domain/opsCenterBrowse'
import type { HourlyCompareResult, HourlySnapshotMeta } from '../domain/opsCenterHourly'
import type { OpsCenterReport } from '../domain/opsCenter'
import type {
  ArticleStockPool,
  ReplaceRunAssignment,
} from '../domain/articleStockPool'
import type {
  OptimizeBatch,
  OptimizeBatchIndex,
  OptimizeScheduleConfig,
} from '../domain/offerOptimizeBatch'

type StockWater = {
  ordered: number
  ready: number
  consumed: number
  failed: number
  byPartner: Array<{ partner: string; ordered: number; ready: number }>
}
import {
  emptyOfferTags,
  emptySeedLexicon,
  normalizeOfferTags,
  normalizeSeedLexicon,
  type OfferTagsFile,
  type SeedLexiconFile,
} from '../domain/offerSeedLexicon'

export async function writeOpsCenterFile(path: string, data: unknown): Promise<void> {
  const response = await fetch('/local-api/ops-center/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, data }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || '写入本地落盘失败')
  }
}

export async function writeOpsCenterBatch(files: Array<{ path: string; data: unknown }>): Promise<void> {
  const response = await fetch('/local-api/ops-center/write-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || '批量写入本地落盘失败')
  }
}

export async function saveOpsCenterReportLocal(report: OpsCenterReport): Promise<void> {
  const response = await fetch('/local-api/ops-center/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || '保存分析报告失败')
  }
}

export async function saveOpsCenterMeta(meta: Record<string, unknown>): Promise<void> {
  const response = await fetch('/local-api/ops-center/meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || '保存同步元数据失败')
  }
}

export async function loadOpsCenterReportLocal(): Promise<OpsCenterReport | null> {
  const response = await fetch('/local-api/ops-center/report')
  if (!response.ok) {
    return null
  }
  const body = (await response.json()) as { report?: OpsCenterReport | null }
  return body.report ?? null
}

export async function loadOpsCenterFunnelCatalog(): Promise<FunnelBrowseCatalog> {
  const response = await fetch('/local-api/ops-center/funnels')
  const body = (await response.json().catch(() => null)) as (FunnelBrowseCatalog & { message?: string }) | null
  if (!response.ok || !body?.funnels) {
    throw new Error(body?.message || '读取漏斗总览失败，请先拉取一次')
  }
  return body
}

export async function loadOpsCenterOfferIndex(): Promise<OfferBrowseIndex> {
  const response = await fetch('/local-api/ops-center/offers')
  const body = (await response.json().catch(() => null)) as (OfferBrowseIndex & { message?: string }) | null
  if (!response.ok || !Array.isArray(body?.offers)) {
    throw new Error(body?.message || '读取 offer 库失败，请先拉取一次漏斗数据')
  }
  return body
}

export async function loadOpsCenterFunnelOfferDrafts(): Promise<unknown[]> {
  const tryUrls = ['/local-api/ops-center/funnel-offer-drafts', '/funnel-offer-drafts.json']
  const byKey = new Map<string, unknown>()
  for (const url of tryUrls) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        continue
      }
      const body = (await response.json().catch(() => null)) as { jobs?: unknown[] } | null
      if (!Array.isArray(body?.jobs)) {
        continue
      }
      for (const job of body.jobs) {
        if (!job || typeof job !== 'object') {
          continue
        }
        const key = String((job as { key?: string }).key || '')
        if (!key) {
          continue
        }
        byKey.set(key, job)
      }
    } catch {
      /* try next */
    }
  }
  return [...byKey.values()]
}

export async function loadOpsCenterFunnelDetailLocal(funnelId: string): Promise<FunnelBrowseDetail> {
  const response = await fetch(`/local-api/ops-center/funnels/${encodeURIComponent(funnelId)}`)
  const body = (await response.json().catch(() => null)) as (FunnelBrowseDetail & { message?: string }) | null
  if (!response.ok || !body?.funnel) {
    throw new Error(body?.message || '读取漏斗明细失败')
  }
  return body
}

export async function listOpsCenterHourlyLocal(day: string): Promise<HourlySnapshotMeta[]> {
  const response = await fetch(`/local-api/ops-center/hourly?day=${encodeURIComponent(day)}`)
  const body = (await response.json().catch(() => null)) as {
    hours?: HourlySnapshotMeta[]
    message?: string
  } | null
  if (!response.ok) {
    throw new Error(body?.message || '读取小时快照失败')
  }
  return Array.isArray(body?.hours) ? body.hours : []
}

export async function compareOpsCenterHourlyLocal(input: {
  day: string
  current: string
  baseline?: string | null
}): Promise<HourlyCompareResult> {
  const params = new URLSearchParams({
    day: input.day,
    current: input.current,
  })
  if (input.baseline) {
    params.set('baseline', input.baseline)
  }
  const response = await fetch(`/local-api/ops-center/hourly/compare?${params}`)
  const body = (await response.json().catch(() => null)) as (HourlyCompareResult & { message?: string }) | null
  if (!response.ok || !body?.currentHour) {
    throw new Error(body?.message || '小时对比失败')
  }
  return body
}

export async function rebuildOpsCenterReportLocal(): Promise<{
  report: OpsCenterReport
  message: string
}> {
  const response = await fetch('/local-api/ops-center/rebuild', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const body = (await response.json().catch(() => null)) as {
    report?: OpsCenterReport
    message?: string
  } | null
  if (!response.ok || !body?.report) {
    throw new Error(body?.message || '基于本地重算失败')
  }
  return {
    report: body.report,
    message: body.message || '已基于本地重算',
  }
}

export async function loadSeedLexicon(): Promise<{
  lexicon: SeedLexiconFile
  meta: Record<string, unknown> | null
}> {
  const response = await fetch('/local-api/ops-center/seed-lexicon')
  const body = (await response.json().catch(() => null)) as {
    lexicon?: Partial<SeedLexiconFile> | null
    meta?: Record<string, unknown> | null
    message?: string
  } | null
  if (!response.ok) {
    throw new Error(body?.message || '读取种子词库失败')
  }
  return {
    lexicon: normalizeSeedLexicon(body?.lexicon || emptySeedLexicon()),
    meta: body?.meta ?? null,
  }
}

export async function saveSeedLexicon(lexicon: SeedLexiconFile): Promise<void> {
  const normalized = normalizeSeedLexicon({
    ...lexicon,
    updatedAt: new Date().toISOString(),
  })
  await writeOpsCenterFile('seed-lexicon/by-category.json', normalized)
  await writeOpsCenterFile('seed-lexicon/meta.json', {
    updatedAt: normalized.updatedAt,
    categoryCount: normalized.categories.length,
    seedCount: normalized.categories.reduce((sum, row) => sum + row.seeds.length, 0),
  })
}

export async function loadOfferTags(): Promise<OfferTagsFile> {
  const response = await fetch('/local-api/ops-center/offer-tags')
  const body = (await response.json().catch(() => null)) as {
    tags?: Partial<OfferTagsFile> | null
    message?: string
  } | null
  if (!response.ok) {
    throw new Error(body?.message || '读取 offer 标签失败')
  }
  return normalizeOfferTags(body?.tags || emptyOfferTags())
}

export async function saveOfferTags(tags: OfferTagsFile): Promise<void> {
  const normalized = normalizeOfferTags({
    ...tags,
    updatedAt: new Date().toISOString(),
  })
  await writeOpsCenterFile('offer-tags/by-offer.json', normalized)
}

export async function listOptimizeBatchesLocal(): Promise<OptimizeBatchIndex> {
  const response = await fetch('/local-api/ops-center/optimize-batches')
  const body = (await response.json().catch(() => null)) as (OptimizeBatchIndex & {
    message?: string
  }) | null
  if (!response.ok) {
    throw new Error(body?.message || '读取优化批次失败')
  }
  return {
    updatedAt: body?.updatedAt || new Date().toISOString(),
    batches: Array.isArray(body?.batches) ? body.batches : [],
  }
}

export async function loadOptimizeBatchLocal(id: string): Promise<OptimizeBatch> {
  const response = await fetch(`/local-api/ops-center/optimize-batches/${encodeURIComponent(id)}`)
  const body = (await response.json().catch(() => null)) as (OptimizeBatch & { message?: string }) | null
  if (!response.ok || !body?.id) {
    throw new Error(body?.message || '读取优化批次详情失败')
  }
  return body
}

export async function harvestOptimizeBatchLocal(
  id: string,
  day?: string,
): Promise<{
  ok: boolean
  reportText: string | null
  message: string
  batch: OptimizeBatch
}> {
  const response = await fetch(
    `/local-api/ops-center/optimize-batches/${encodeURIComponent(id)}/harvest`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day }),
    },
  )
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean
    reportText?: string | null
    message?: string
    batch?: OptimizeBatch
  } | null
  if (!response.ok || !body?.batch) {
    throw new Error(body?.message || '回收优化后数据失败')
  }
  return {
    ok: Boolean(body.ok),
    reportText: body.reportText ?? null,
    message: body.message || '已回收',
    batch: body.batch,
  }
}

export async function loadOptimizeScheduleLocal(): Promise<OptimizeScheduleConfig> {
  const response = await fetch('/local-api/ops-center/optimize-schedule')
  const body = (await response.json().catch(() => null)) as (OptimizeScheduleConfig & {
    message?: string
  }) | null
  if (!response.ok) {
    throw new Error(body?.message || '读取换文节奏失败')
  }
  return body as OptimizeScheduleConfig
}

export async function saveOptimizeScheduleLocal(
  config: OptimizeScheduleConfig,
): Promise<OptimizeScheduleConfig> {
  const response = await fetch('/local-api/ops-center/optimize-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  const body = (await response.json().catch(() => null)) as (OptimizeScheduleConfig & {
    message?: string
    config?: OptimizeScheduleConfig
  }) | null
  if (!response.ok) {
    throw new Error(body?.message || '保存换文节奏失败')
  }
  return body?.config || (body as OptimizeScheduleConfig)
}

export async function loadOptimizeBatchReportLocal(id: string): Promise<{
  id: string
  afterMetricsDay: string | null
  harvestedAt: string | null
  reportText: string | null
}> {
  const response = await fetch(
    `/local-api/ops-center/optimize-batches/${encodeURIComponent(id)}/report`,
  )
  const body = (await response.json().catch(() => null)) as {
    id?: string
    afterMetricsDay?: string | null
    harvestedAt?: string | null
    reportText?: string | null
    message?: string
  } | null
  if (!response.ok) {
    throw new Error(body?.message || '读取优化报告失败')
  }
  return {
    id: body?.id || id,
    afterMetricsDay: body?.afterMetricsDay ?? null,
    harvestedAt: body?.harvestedAt ?? null,
    reportText: body?.reportText ?? null,
  }
}

export async function loadArticleStockLocal(): Promise<{
  pool: ArticleStockPool
  water: StockWater
}> {
  const response = await fetch('/local-api/ops-center/article-stock')
  const body = (await response.json().catch(() => null)) as {
    pool?: ArticleStockPool
    water?: StockWater
    message?: string
  } | null
  if (!response.ok || !body?.pool) {
    throw new Error(body?.message || '读取备货池失败')
  }
  return {
    pool: body.pool,
    water: body.water || {
      ordered: 0,
      ready: 0,
      consumed: 0,
      failed: 0,
      byPartner: [],
    },
  }
}

export async function orderStockFromBatchLocal(batchId: string): Promise<{
  message: string
  added: number
  skipped: number
  pool: ArticleStockPool
  water: StockWater
}> {
  const response = await fetch('/local-api/ops-center/article-stock/order-from-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId }),
  })
  const body = (await response.json().catch(() => null)) as {
    message?: string
    added?: number
    skipped?: number
    pool?: ArticleStockPool
    water?: StockWater
  } | null
  if (!response.ok || !body?.pool) {
    throw new Error(body?.message || '导入备货单失败')
  }
  return {
    message: body.message || '已导入',
    added: body.added || 0,
    skipped: body.skipped || 0,
    pool: body.pool,
    water: body.water!,
  }
}

export async function readyStockLocal(input: {
  stockId: string
  articleId: string
  landingUrl: string
  note?: string
}): Promise<{ pool: ArticleStockPool; water: StockWater; message: string }> {
  const response = await fetch('/local-api/ops-center/article-stock/ready', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = (await response.json().catch(() => null)) as {
    pool?: ArticleStockPool
    water?: StockWater
    message?: string
  } | null
  if (!response.ok || !body?.pool) {
    throw new Error(body?.message || '标记备货就绪失败')
  }
  return {
    pool: body.pool,
    water: body.water!,
    message: body.message || '已就绪',
  }
}

export async function planStockRunLocal(input?: {
  batchId?: string
  maxPerRun?: number
}): Promise<{
  assignments: ReplaceRunAssignment[]
  water: StockWater
  batchId: string | null
}> {
  const response = await fetch('/local-api/ops-center/article-stock/plan-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input || {}),
  })
  const body = (await response.json().catch(() => null)) as {
    assignments?: ReplaceRunAssignment[]
    water?: StockWater
    batchId?: string | null
    message?: string
  } | null
  if (!response.ok) {
    throw new Error(body?.message || '规划换文轮次失败')
  }
  return {
    assignments: Array.isArray(body?.assignments) ? body.assignments : [],
    water: body?.water || {
      ordered: 0,
      ready: 0,
      consumed: 0,
      failed: 0,
      byPartner: [],
    },
    batchId: body?.batchId ?? null,
  }
}

export async function consumeStockLocal(
  stockId: string,
  offerId: string,
): Promise<{ pool: ArticleStockPool; water: StockWater; message: string }> {
  const response = await fetch('/local-api/ops-center/article-stock/consume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stockId, offerId }),
  })
  const body = (await response.json().catch(() => null)) as {
    pool?: ArticleStockPool
    water?: StockWater
    message?: string
  } | null
  if (!response.ok || !body?.pool) {
    throw new Error(body?.message || '消耗备货失败')
  }
  return {
    pool: body.pool,
    water: body.water!,
    message: body.message || '已消耗',
  }
}

export async function markOptimizeBatchWrittenLocal(
  batchId: string,
  updates: Array<{ offerId: string; afterRef?: string; afterUrl?: string | null; note?: string }>,
): Promise<void> {
  const response = await fetch(
    `/local-api/ops-center/optimize-batches/${encodeURIComponent(batchId)}/mark-written`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    },
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || '标记写回失败')
  }
}
