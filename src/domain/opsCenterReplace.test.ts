import { describe, expect, it } from 'vitest'
import type { JoinedOffer } from './opsCenter'
import { buildReplaceAdvice } from './opsCenterReplace'

function offer(partial: Partial<JoinedOffer> & Pick<JoinedOffer, 'offerId' | 'funnelId' | 'funnelName' | 'categoryName'>): JoinedOffer {
  return {
    offerName: partial.offerName || partial.offerId,
    groupId: 'g',
    groupName: 'g',
    geo: partial.geo ?? 'US',
    routing: 'rotator',
    yesterdayRpm: 0,
    yesterdayRev: 0,
    partnerName: partial.partnerName ?? 'p1',
    urlName: partial.urlName ?? 'u1',
    urlId: 1,
    platform: 'MIS',
    hasFlatStats: true,
    flatStatsName: null,
    landingUrl: null,
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
    ...partial,
  }
}

describe('buildReplaceAdvice', () => {
  it('flags weak high-traffic offers and suggests stronger categories', () => {
    const rows: JoinedOffer[] = [
      offer({
        offerId: 'weak',
        funnelId: 'f1',
        funnelName: 'weak-funnel',
        categoryName: '个人贷款',
        visits: 1000,
        funnelClicks: 300,
        revenue: 0,
        conversion: 0,
        funnelRpm: 0.1,
        funnelCtr: 5,
      }),
      offer({
        offerId: 'strong1',
        funnelId: 'f2',
        funnelName: 'strong-funnel',
        categoryName: 'HIV',
        visits: 900,
        funnelClicks: 280,
        revenue: 200,
        conversion: 20,
        funnelRpm: 40,
        funnelCtr: 35,
      }),
      offer({
        offerId: 'strong2',
        funnelId: 'f3',
        funnelName: 'strong-funnel-2',
        categoryName: '丁丙诺啡市场',
        visits: 800,
        funnelClicks: 250,
        revenue: 180,
        conversion: 18,
        funnelRpm: 38,
        funnelCtr: 33,
      }),
      offer({
        offerId: 'mid',
        funnelId: 'f4',
        funnelName: 'mid-funnel',
        categoryName: '事故律师',
        visits: 850,
        funnelClicks: 260,
        revenue: 90,
        conversion: 10,
        funnelRpm: 20,
        funnelCtr: 25,
      }),
    ]

    const { items, funnelSummaries } = buildReplaceAdvice(rows)
    expect(items.some((row) => row.offerId === 'weak')).toBe(true)
    const weak = items.find((row) => row.offerId === 'weak')!
    expect(weak.suggestCategories[0]?.categoryName).not.toBe('个人贷款')
    expect(weak.reasons.length).toBeGreaterThan(0)
    expect(funnelSummaries.some((row) => row.funnelName === 'weak-funnel')).toBe(true)
    expect(funnelSummaries.find((row) => row.funnelName === 'weak-funnel')?.suggestCategories.length).toBeGreaterThan(0)
  })
})
