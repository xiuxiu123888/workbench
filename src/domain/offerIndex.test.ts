import { describe, expect, it } from 'vitest'
import { dedupeOffersByOfferId } from './offerIndex'
import type { JoinedOffer } from './opsCenter'

function offer(partial: Partial<JoinedOffer> & Pick<JoinedOffer, 'offerId' | 'offerName'>): JoinedOffer {
  return {
    groupId: 'g',
    groupName: 'g',
    geo: null,
    routing: null,
    yesterdayRpm: 0,
    yesterdayRev: 0,
    funnelId: 'f1',
    funnelName: 'funnel-a',
    partnerName: null,
    urlName: null,
    urlId: null,
    platform: null,
    visits: 0,
    views: 0,
    conversion: 0,
    revenue: 0,
    funnelImpressions: 0,
    funnelClicks: 0,
    clicks: 0,
    funnelRpm: 0,
    rpc: 0,
    funnelCtr: 0,
    cvr1: 0,
    cvr2: 0,
    hasFlatStats: false,
    flatStatsName: null,
    landingUrl: null,
    channelId: null,
    categoryName: null,
    ...partial,
  } as JoinedOffer
}

describe('dedupeOffersByOfferId', () => {
  it('keeps one row per offerId and merges funnel names', () => {
    const rows = dedupeOffersByOfferId([
      offer({ offerId: 'o1', offerName: 'A', funnelId: 'f1', funnelName: 'fa', revenue: 1 }),
      offer({ offerId: 'o1', offerName: 'A', funnelId: 'f2', funnelName: 'fb', revenue: 5 }),
      offer({ offerId: 'o2', offerName: 'B', funnelId: 'f1', funnelName: 'fa', revenue: 2 }),
    ])
    expect(rows).toHaveLength(2)
    const first = rows.find((row) => row.offerId === 'o1')!
    expect(first.funnelNames.sort()).toEqual(['fa', 'fb'])
    expect(first.funnelIds.sort()).toEqual(['f1', 'f2'])
    expect(first.revenue).toBe(5)
  })
})
