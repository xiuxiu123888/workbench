export type OfferSeedAssignOffer = {
  offerId: string
}

export type OfferSeedAssignment<T> = {
  offerId: string
  seed: T
}

function shuffleInPlace<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const tmp = items[i]
    items[i] = items[j]
    items[j] = tmp
  }
  return items
}

/**
 * 多 offer × 多/单种子：打乱词后一人一词；词少则循环复用，词多则多余不用。
 */
export function assignSeedsToOffers<T>(
  offers: OfferSeedAssignOffer[],
  seeds: T[],
  random: () => number = Math.random,
): OfferSeedAssignment<T>[] {
  if (offers.length === 0) {
    throw new Error('请至少选择一个 offer')
  }
  if (seeds.length === 0) {
    throw new Error('请至少选择一个种子词')
  }
  const shuffled = shuffleInPlace(seeds.slice(), random)
  return offers.map((offer, index) => ({
    offerId: offer.offerId,
    seed: shuffled[index % shuffled.length],
  }))
}
