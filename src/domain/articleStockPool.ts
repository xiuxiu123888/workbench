/** 换文备货池：先产文入库，到点只写回漏斗 */

export type ArticleStockStatus = 'ordered' | 'ready' | 'consumed' | 'failed'

export interface ArticleStockItem {
  id: string
  createdAt: string
  updatedAt: string
  partner: string
  seedRef: string
  targetOfferId: string
  targetOfferName: string
  targetFunnelName: string
  beforeUrl: string | null
  channelId: string | null
  articleId: string | null
  landingUrl: string | null
  status: ArticleStockStatus
  batchId: string | null
  note: string
  consumedAt: string | null
  consumedOfferId: string | null
}

export interface ArticleStockPool {
  updatedAt: string
  items: ArticleStockItem[]
}

export interface ReplaceRunAssignment {
  stockId: string
  offerId: string
  offerName: string
  funnelName: string
  partner: string
  seedRef: string
  articleId: string
  beforeUrl: string
  landingUrl: string
  channelId: string
  batchId: string | null
}

export function emptyArticleStockPool(now = new Date()): ArticleStockPool {
  return {
    updatedAt: now.toISOString(),
    items: [],
  }
}

export function stockWaterLevel(pool: ArticleStockPool): {
  ordered: number
  ready: number
  consumed: number
  failed: number
  byPartner: Array<{ partner: string; ordered: number; ready: number }>
} {
  const byPartner = new Map<string, { partner: string; ordered: number; ready: number }>()
  let ordered = 0
  let ready = 0
  let consumed = 0
  let failed = 0
  for (const item of pool.items) {
    if (item.status === 'ordered') ordered += 1
    if (item.status === 'ready') ready += 1
    if (item.status === 'consumed') consumed += 1
    if (item.status === 'failed') failed += 1
    if (item.status === 'ordered' || item.status === 'ready') {
      const row = byPartner.get(item.partner) || {
        partner: item.partner,
        ordered: 0,
        ready: 0,
      }
      if (item.status === 'ordered') row.ordered += 1
      if (item.status === 'ready') row.ready += 1
      byPartner.set(item.partner, row)
    }
  }
  return {
    ordered,
    ready,
    consumed,
    failed,
    byPartner: [...byPartner.values()].sort((a, b) => a.partner.localeCompare(b.partner)),
  }
}

export function upsertStockItem(
  pool: ArticleStockPool,
  item: ArticleStockItem,
): ArticleStockPool {
  const items = [item, ...pool.items.filter((row) => row.id !== item.id)]
  return { updatedAt: new Date().toISOString(), items }
}

export function markStockReady(
  pool: ArticleStockPool,
  stockId: string,
  input: { articleId: string; landingUrl: string; note?: string },
): ArticleStockPool {
  const articleId = String(input.articleId || '').trim()
  const landingUrl = String(input.landingUrl || '').trim()
  if (!articleId || !landingUrl) {
    throw new Error('备货就绪需要 articleId 与 landingUrl')
  }
  const now = new Date().toISOString()
  const items = pool.items.map((row) => {
    if (row.id !== stockId) return row
    return {
      ...row,
      articleId,
      landingUrl,
      status: 'ready' as const,
      note: input.note || row.note || '已备货就绪',
      updatedAt: now,
    }
  })
  return { updatedAt: now, items }
}

export function consumeStockItem(
  pool: ArticleStockPool,
  stockId: string,
  offerId: string,
): ArticleStockPool {
  const now = new Date().toISOString()
  const items = pool.items.map((row) => {
    if (row.id !== stockId) return row
    return {
      ...row,
      status: 'consumed' as const,
      consumedAt: now,
      consumedOfferId: offerId,
      note: `已写回 ${offerId}`,
      updatedAt: now,
    }
  })
  return { updatedAt: now, items }
}

/** 为待换 offer 挑选 ready 备货：优先同 offerId，其次同 seedRef+partner */
export function pickReadyStock(
  pool: ArticleStockPool,
  target: {
    offerId: string
    partner: string
    seedRef: string
  },
  usedStockIds: Set<string>,
): ArticleStockItem | null {
  const ready = pool.items.filter(
    (row) =>
      row.status === 'ready' &&
      row.articleId &&
      row.landingUrl &&
      !usedStockIds.has(row.id),
  )
  const exact = ready.find(
    (row) =>
      row.targetOfferId === target.offerId &&
      row.seedRef.toLowerCase() === target.seedRef.toLowerCase(),
  )
  if (exact) return exact
  const sameSeed = ready.find(
    (row) =>
      row.partner === target.partner &&
      row.seedRef.toLowerCase() === target.seedRef.toLowerCase(),
  )
  if (sameSeed) return sameSeed
  return ready.find((row) => row.partner === target.partner) || null
}

export function planReplaceRun(input: {
  pool: ArticleStockPool
  targets: Array<{
    offerId: string
    offerName: string
    funnelName: string
    partner: string
    seedRef: string
    beforeUrl: string | null
    channelId: string | null
    batchId: string | null
    status?: string
  }>
  maxPerRun: number
}): ReplaceRunAssignment[] {
  const max = Math.max(1, Number(input.maxPerRun) || 10)
  const used = new Set<string>()
  const out: ReplaceRunAssignment[] = []
  for (const target of input.targets) {
    if (out.length >= max) break
    if (target.status === 'written' || target.status === 'skipped') continue
    const seedRef = String(target.seedRef || '').trim()
    if (!seedRef) continue
    const stock = pickReadyStock(
      input.pool,
      { offerId: target.offerId, partner: target.partner, seedRef },
      used,
    )
    if (!stock?.articleId || !stock.landingUrl) continue
    const beforeUrl = String(target.beforeUrl || stock.beforeUrl || '').trim()
    const channelId = String(target.channelId || stock.channelId || '').trim()
    if (!beforeUrl || !channelId) continue
    used.add(stock.id)
    out.push({
      stockId: stock.id,
      offerId: target.offerId,
      offerName: target.offerName,
      funnelName: target.funnelName,
      partner: target.partner,
      seedRef: stock.seedRef || seedRef,
      articleId: stock.articleId,
      beforeUrl,
      landingUrl: stock.landingUrl,
      channelId,
      batchId: target.batchId || stock.batchId,
    })
  }
  return out
}

export function channelIdFromUrl(url: string | null | undefined): string {
  try {
    return String(new URL(String(url || '')).searchParams.get('channel') || '').trim()
  } catch {
    return ''
  }
}
