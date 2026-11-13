import type { JoinedOffer } from './opsCenter'

export type OfferIndexRow = JoinedOffer & {
  /** 该 offer 出现过的漏斗名（去重） */
  funnelNames: string[]
  funnelIds: string[]
}

/** 跨漏斗按 offerId 去重；漏斗只作归属展示，不作为主键 */
export function dedupeOffersByOfferId(offers: JoinedOffer[]): OfferIndexRow[] {
  const map = new Map<string, OfferIndexRow>()
  for (const offer of offers) {
    const offerId = String(offer.offerId || '').trim()
    if (!offerId) {
      continue
    }
    const funnelId = String(offer.funnelId || '').trim()
    const funnelName = String(offer.funnelName || '').trim() || funnelId || '—'
    const existing = map.get(offerId)
    if (!existing) {
      map.set(offerId, {
        ...offer,
        funnelIds: funnelId ? [funnelId] : [],
        funnelNames: [funnelName],
      })
      continue
    }
    if (funnelId && !existing.funnelIds.includes(funnelId)) {
      existing.funnelIds.push(funnelId)
    }
    if (!existing.funnelNames.includes(funnelName)) {
      existing.funnelNames.push(funnelName)
    }
    // 指标取更高收入那条（同 offer 在不同漏斗统计可能不同）
    if (offer.revenue > existing.revenue) {
      Object.assign(existing, offer, {
        funnelIds: existing.funnelIds,
        funnelNames: existing.funnelNames,
      })
    }
  }
  return [...map.values()].sort(
    (a, b) => b.revenue - a.revenue || a.offerName.localeCompare(b.offerName),
  )
}
