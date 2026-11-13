import { describe, expect, it } from 'vitest'
import {
  adClickRate,
  configIdFromWarning,
  dayBeforeAndYesterday,
  emptyDayMetrics,
  makeRequestFailure,
  sumDayMetrics,
  yesterdayAndToday,
} from './dashboardStore'

describe('dashboardStore', () => {
  it('reads config id from warning text', () => {
    expect(configIdFromWarning('配置 146 运营配置 接口超时，请稍后重试或缩短日期')).toBe('146')
    expect(configIdFromWarning('配置 7 没有域名')).toBe('7')
    expect(configIdFromWarning('渠道 123 超时')).toBe('')
  })

  it('sums known domain revenues even when some are missing', () => {
    const mixed = sumDayMetrics([
      { ...emptyDayMetrics(), revenue: 10, pageViews: 3, articleCount: 1, channelCount: 1 },
      { ...emptyDayMetrics(), revenue: null, pageViews: 2, articleCount: 2, channelCount: 1 },
    ])
    expect(mixed.revenue).toBe(10)
    expect(mixed.pageViews).toBe(5)
    expect(mixed.articleCount).toBe(3)

    const allMissing = sumDayMetrics([
      { ...emptyDayMetrics(), revenue: null, pageViews: 1 },
      { ...emptyDayMetrics(), revenue: null, pageViews: 2 },
    ])
    expect(allMissing.revenue).toBeNull()

    const ok = sumDayMetrics([
      { ...emptyDayMetrics(), revenue: 1.5, pageViews: 1 },
      { ...emptyDayMetrics(), revenue: 2.5, pageViews: 2 },
    ])
    expect(ok.revenue).toBe(4)
  })

  it('returns yesterday and today keys', () => {
    const days = yesterdayAndToday(new Date('2026-11-03T12:00:00'))
    expect(days).toEqual({ yesterday: '2026-11-02', today: '2026-11-03' })
  })

  it('returns two complete days for wow attribution', () => {
    expect(dayBeforeAndYesterday(new Date('2026-11-05T12:00:00'))).toEqual({
      dayBefore: '2026-11-03',
      yesterday: '2026-11-04',
      calendarToday: '2026-11-05',
    })
    expect(adClickRate(20, 100)).toBe(0.2)
    expect(adClickRate(0, 0)).toBeNull()
  })

  it('builds request failure entries', () => {
    const item = makeRequestFailure({
      kind: 'revenue',
      target: '渠道 9',
      message: '超时',
      channelId: '9',
      source: '3',
      at: '2026-11-05T01:00:00.000Z',
      id: 'revenue:9',
    })
    expect(item).toMatchObject({
      id: 'revenue:9',
      kind: 'revenue',
      channelId: '9',
      source: '3',
      message: '超时',
    })
  })
})
