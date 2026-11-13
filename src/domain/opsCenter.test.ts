import { describe, expect, it } from 'vitest'
import type { FlatStatsOfferRow } from '../api/flatStats'
import type { FunnelListItem } from '../api/ruoyiFunnel'
import {
  buildInsights,
  buildOpsCenterReport,
  formatOpsCenterFeishuText,
  joinOffersWithFlatStats,
  loadOpsCenterReport,
  metricsFromFlatStats,
  saveOpsCenterReport,
  type SyncedGroup,
  type SyncedOffer,
} from './opsCenter'
import { shanghaiDayBounds, shiftShanghaiDay } from './opsCenterTime'

const funnels: FunnelListItem[] = [
  {
    funnelId: 'f1',
    funnelName: 'demo-v01',
    partnerName: 'partner-a',
    urlName: 'link-a',
    platform: 'MIS',
    status: 'active',
  },
  {
    funnelId: 'f2',
    funnelName: 'demo-v02',
    partnerName: 'partner-b',
    urlName: null,
    platform: 'FF',
    status: 'active',
  },
]

const groups: SyncedGroup[] = [
  {
    groupId: 'g1',
    groupName: 'demo-v01-us',
    routing: 'rotator',
    geo: 'US',
    yesterdayRpm: 10,
    yesterdayRev: 20,
    funnelId: 'f1',
    funnelName: 'demo-v01',
    partnerName: 'partner-a',
    urlName: 'link-a',
    urlId: 1,
    platform: 'MIS',
    offerList: [
      {
        offerId: 'o1',
        offerName: 'offer-1',
        categoryName: '个人贷款',
        weight: 1,
        channelId: '100',
        todayRpm: 30,
        todayRev: 50,
      },
      {
        offerId: 'o2',
        offerName: 'offer-2',
        categoryName: 'HIV',
        weight: 0.5,
        channelId: '101',
        todayRpm: 40,
        todayRev: 10,
      },
    ],
  },
  {
    groupId: 'g2',
    groupName: 'demo-v02-default',
    routing: 'rotator',
    geo: null,
    yesterdayRpm: 0,
    yesterdayRev: 0,
    funnelId: 'f2',
    funnelName: 'demo-v02',
    partnerName: 'partner-b',
    urlName: null,
    urlId: null,
    platform: 'FF',
    offerList: [
      {
        offerId: 'o3',
        offerName: 'offer-3',
        categoryName: '个人贷款',
        weight: 1,
        channelId: '102',
        todayRpm: 0,
        todayRev: 0,
      },
    ],
  },
]

const flatStats: FlatStatsOfferRow[] = [
  {
    id: 'o1',
    name: 'offer-1',
    visits: 1000,
    views: 1000,
    conversion: 20,
    revenue: '80.5',
    funnelImpressions: 2000,
    funnelClicks: 400,
    clicks: 15,
    funnelRpm: '8.2',
    funnelCtr: '20',
    cvr1: '2',
    cvr2: '1.5',
  },
  {
    id: 'o2',
    name: 'offer-2',
    visits: 100,
    views: 100,
    conversion: 2,
    revenue: '5',
    funnelImpressions: 200,
    funnelClicks: 40,
    clicks: 1,
    funnelRpm: '4',
    funnelCtr: '20',
  },
]

describe('opsCenter analysis with flatStats', () => {
  it('joins offerId and ranks by traffic metrics', () => {
    const report = buildOpsCenterReport({
      funnels,
      details: [],
      groups,
      flatStats,
      primaryDay: '2026-11-10',
      pulledAt: '2026-11-10T10:00:00.000Z',
    })
    expect(report.matchedOfferCount).toBe(2)
    expect(report.totals.visits).toBe(1100)
    expect(report.totals.revenue).toBe(85.5)
    expect(report.partnerRank[0]?.key).toBe('partner-a')
    expect(report.categoryRank[0]?.key).toBe('个人贷款')
    expect(report.topOffers[0]?.offerId).toBe('o1')
    expect(report.insights.some((line) => line.includes('访问'))).toBe(true)
    expect(Array.isArray(report.replaceAdvice)).toBe(true)
    expect(Array.isArray(report.funnelReplaceSummaries)).toBe(true)
  })

  it('metricsFromFlatStats and join helpers work', () => {
    const metrics = metricsFromFlatStats(flatStats[0])
    expect(metrics.funnelClicks).toBe(400)
    const offers: SyncedOffer[] = [
      {
        offerId: 'o1',
        offerName: 'offer-1',
        groupId: 'g1',
        groupName: 'g',
        geo: 'US',
        routing: 'rotator',
        yesterdayRpm: 0,
        yesterdayRev: 0,
        funnelId: 'f1',
        funnelName: 'demo-v01',
        partnerName: 'partner-a',
        urlName: 'link-a',
        urlId: 1,
        platform: 'MIS',
      },
    ]
    const joined = joinOffersWithFlatStats(offers, new Map([['o1', flatStats[0]]]))
    expect(joined[0]?.hasFlatStats).toBe(true)
    expect(joined[0]?.visits).toBe(1000)
  })

  it('formats feishu text and persists report', () => {
    const report = buildOpsCenterReport({
      funnels,
      details: [],
      groups,
      flatStats,
      primaryDay: '2026-11-10',
      pulledAt: '2026-11-10T10:00:00.000Z',
    })
    const text = formatOpsCenterFeishuText(report)
    expect(text).toContain('指标日 2026-11-10')
    expect(text).toContain('访问')

    const store = new Map<string, string>()
    saveOpsCenterReport(report, {
      setItem: (key, value) => {
        store.set(key, value)
      },
    })
    const loaded = loadOpsCenterReport({
      getItem: (key) => store.get(key) ?? null,
    })
    expect(loaded?.matchedOfferCount).toBe(2)
  })

  it('buildInsights mentions alignment', () => {
    const report = buildOpsCenterReport({
      funnels,
      details: [],
      groups,
      flatStats,
      primaryDay: '2026-11-10',
    })
    const lines = buildInsights(report)
    expect(lines.some((line) => line.includes('对齐结果'))).toBe(true)
  })

  it('shanghai day helpers', () => {
    expect(shanghaiDayBounds('2026-11-10')).toEqual({
      day: '2026-11-10',
      startTime: '2026-11-10 00:00:00',
      endTime: '2026-11-10 23:59:59',
    })
    expect(shiftShanghaiDay('2026-11-10', -1)).toBe('2026-11-09')
  })
})
