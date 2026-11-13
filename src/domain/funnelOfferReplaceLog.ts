export const FUNNEL_OFFER_REPLACE_LOG_KEY = 'workbench.funnel-offer-replace-log.v1'
export const FUNNEL_OFFER_REPLACE_LOG_LIMIT = 300

export interface FunnelOfferReplaceLogItem {
  id: string
  createdAt: number
  funnelId: string
  funnelName: string
  offerId: string
  offerName: string
  channelId: string | null
  articleId: string
  ref: string
  oldUrl: string | null
  newUrl: string | null
  resultUrl: string | null
  ok: boolean
  message: string
}

export function createFunnelOfferReplaceLogItem(
  draft: Omit<FunnelOfferReplaceLogItem, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): FunnelOfferReplaceLogItem {
  const createdAt = draft.createdAt ?? Date.now()
  return {
    id:
      draft.id ||
      `${createdAt}-${String(draft.offerId || 'offer').trim()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    funnelId: String(draft.funnelId || '').trim(),
    funnelName: String(draft.funnelName || '').trim(),
    offerId: String(draft.offerId || '').trim(),
    offerName: String(draft.offerName || '').trim(),
    channelId: draft.channelId == null || String(draft.channelId).trim() === '' ? null : String(draft.channelId).trim(),
    articleId: String(draft.articleId || '').trim(),
    ref: String(draft.ref || '').trim(),
    oldUrl: draft.oldUrl == null || String(draft.oldUrl).trim() === '' ? null : String(draft.oldUrl).trim(),
    newUrl: draft.newUrl == null || String(draft.newUrl).trim() === '' ? null : String(draft.newUrl).trim(),
    resultUrl:
      draft.resultUrl == null || String(draft.resultUrl).trim() === '' ? null : String(draft.resultUrl).trim(),
    ok: Boolean(draft.ok),
    message: String(draft.message || '').trim(),
  }
}

export function loadFunnelOfferReplaceLog(
  storage: Pick<Storage, 'getItem'> = localStorage,
): FunnelOfferReplaceLogItem[] {
  try {
    const text = storage.getItem(FUNNEL_OFFER_REPLACE_LOG_KEY)
    if (!text) {
      return []
    }
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item): item is FunnelOfferReplaceLogItem =>
        Boolean(item && typeof item === 'object' && (item as FunnelOfferReplaceLogItem).id),
      )
      .map((item) => createFunnelOfferReplaceLogItem(item))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, FUNNEL_OFFER_REPLACE_LOG_LIMIT)
  } catch {
    return []
  }
}

export function saveFunnelOfferReplaceLog(
  records: FunnelOfferReplaceLogItem[],
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(
    FUNNEL_OFFER_REPLACE_LOG_KEY,
    JSON.stringify(records.slice(0, FUNNEL_OFFER_REPLACE_LOG_LIMIT)),
  )
}

export function prependFunnelOfferReplaceLog(
  current: FunnelOfferReplaceLogItem[],
  record: FunnelOfferReplaceLogItem,
): FunnelOfferReplaceLogItem[] {
  return [record, ...current.filter((item) => item.id !== record.id)].slice(
    0,
    FUNNEL_OFFER_REPLACE_LOG_LIMIT,
  )
}

export function filterFunnelOfferReplaceLog(
  records: FunnelOfferReplaceLogItem[],
  query: string,
): FunnelOfferReplaceLogItem[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return records
  }
  return records.filter((row) => {
    const hay = [
      row.funnelName,
      row.funnelId,
      row.offerName,
      row.offerId,
      row.channelId || '',
      row.articleId,
      row.ref,
      row.oldUrl || '',
      row.newUrl || '',
      row.resultUrl || '',
      row.message,
      row.ok ? '成功' : '失败',
    ]
      .join('\n')
      .toLowerCase()
    return hay.includes(q)
  })
}
