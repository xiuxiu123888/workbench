import {
  channelIdFromUrl,
  emptyArticleStockPool,
  markStockReady,
  planReplaceRun,
  stockWaterLevel,
  upsertStockItem,
  consumeStockItem,
  type ArticleStockItem,
  type ArticleStockPool,
  type ReplaceRunAssignment,
} from '../domain/articleStockPool'
import { partnerPrefix } from '../domain/offerOptimizeBatch'
import { loadOptimizeBatch } from './opsCenterOptimizeBatch'
import { readOpsCenterJson, writeOpsCenterJson } from './opsCenterStore'

function stockPath(): string {
  return 'optimize-batches/article-stock.json'
}

export function loadArticleStockPool(projectRoot: string): ArticleStockPool {
  const saved = readOpsCenterJson<ArticleStockPool>(projectRoot, stockPath())
  if (!saved || !Array.isArray(saved.items)) return emptyArticleStockPool()
  return {
    updatedAt: saved.updatedAt || new Date().toISOString(),
    items: saved.items,
  }
}

export function saveArticleStockPool(
  projectRoot: string,
  pool: ArticleStockPool,
): ArticleStockPool {
  const next = {
    ...pool,
    updatedAt: new Date().toISOString(),
  }
  writeOpsCenterJson(projectRoot, stockPath(), next)
  return next
}

export function getArticleStockSummary(projectRoot: string) {
  const pool = loadArticleStockPool(projectRoot)
  return {
    pool,
    water: stockWaterLevel(pool),
  }
}

/** 从优化批次导入备货单（ordered）：只收 planned + produce-write */
export function orderStockFromOptimizeBatch(
  projectRoot: string,
  batchId: string,
): { pool: ArticleStockPool; added: number; skipped: number } {
  const batch = loadOptimizeBatch(projectRoot, batchId)
  if (!batch) throw new Error(`优化批次不存在: ${batchId}`)
  let pool = loadArticleStockPool(projectRoot)
  const existingKeys = new Set(
    pool.items
      .filter((row) => row.status === 'ordered' || row.status === 'ready')
      .map((row) => `${row.targetOfferId}::${row.seedRef.toLowerCase()}`),
  )
  let added = 0
  let skipped = 0
  const now = new Date().toISOString()
  for (const item of batch.items) {
    if (item.status === 'written' || item.status === 'skipped') {
      skipped += 1
      continue
    }
    if (item.action !== 'produce-write') {
      skipped += 1
      continue
    }
    const seedRef = String(item.plannedSeedRef || '').trim()
    if (!seedRef) {
      skipped += 1
      continue
    }
    const key = `${item.offerId}::${seedRef.toLowerCase()}`
    if (existingKeys.has(key)) {
      skipped += 1
      continue
    }
    const channelId = channelIdFromUrl(item.beforeUrl)
    const stock: ArticleStockItem = {
      id: `stock-${item.offerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: now,
      updatedAt: now,
      partner: item.partner || partnerPrefix(item.funnelName),
      seedRef,
      targetOfferId: item.offerId,
      targetOfferName: item.offerName,
      targetFunnelName: item.funnelName,
      beforeUrl: item.beforeUrl,
      channelId: channelId || null,
      articleId: null,
      landingUrl: null,
      status: 'ordered',
      batchId,
      note: `自批次 ${batchId} 导入 · 待产文`,
      consumedAt: null,
      consumedOfferId: null,
    }
    pool = upsertStockItem(pool, stock)
    existingKeys.add(key)
    added += 1
  }
  pool = saveArticleStockPool(projectRoot, pool)
  return { pool, added, skipped }
}

export function readyStockItem(
  projectRoot: string,
  stockId: string,
  input: { articleId: string; landingUrl: string; note?: string },
): ArticleStockPool {
  const pool = loadArticleStockPool(projectRoot)
  return saveArticleStockPool(projectRoot, markStockReady(pool, stockId, input))
}

export function planStockReplaceRun(
  projectRoot: string,
  input?: { batchId?: string; maxPerRun?: number },
): {
  assignments: ReplaceRunAssignment[]
  water: ReturnType<typeof stockWaterLevel>
  batchId: string | null
} {
  const pool = loadArticleStockPool(projectRoot)
  const batchId = String(input?.batchId || '').trim()
  let targets: Array<{
    offerId: string
    offerName: string
    funnelName: string
    partner: string
    seedRef: string
    beforeUrl: string | null
    channelId: string | null
    batchId: string | null
    status?: string
  }> = []

  if (batchId) {
    const batch = loadOptimizeBatch(projectRoot, batchId)
    if (!batch) throw new Error(`优化批次不存在: ${batchId}`)
    targets = batch.items.map((item) => ({
      offerId: item.offerId,
      offerName: item.offerName,
      funnelName: item.funnelName,
      partner: item.partner,
      seedRef: item.plannedSeedRef,
      beforeUrl: item.beforeUrl,
      channelId: channelIdFromUrl(item.beforeUrl),
      batchId: batch.id,
      status: item.status,
    }))
  } else {
    targets = pool.items
      .filter((row) => row.status === 'ordered' || row.status === 'ready')
      .map((row) => ({
        offerId: row.targetOfferId,
        offerName: row.targetOfferName,
        funnelName: row.targetFunnelName,
        partner: row.partner,
        seedRef: row.seedRef,
        beforeUrl: row.beforeUrl,
        channelId: row.channelId,
        batchId: row.batchId,
        status: row.status === 'ready' ? 'planned' : 'planned',
      }))
  }

  const assignments = planReplaceRun({
    pool,
    targets,
    maxPerRun: input?.maxPerRun ?? 10,
  })
  return {
    assignments,
    water: stockWaterLevel(pool),
    batchId: batchId || null,
  }
}

export function markStockConsumed(
  projectRoot: string,
  stockId: string,
  offerId: string,
): ArticleStockPool {
  const pool = loadArticleStockPool(projectRoot)
  return saveArticleStockPool(projectRoot, consumeStockItem(pool, stockId, offerId))
}
