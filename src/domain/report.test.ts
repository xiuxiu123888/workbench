import { describe, expect, it } from 'vitest'
import {
  afsReportDomain,
  articleDayStatsFromDaily,
  articleLinks,
  changedArticleLinks,
  linksForReportDay,
  eachDay,
  compareDailyRevenue,
  dailyRevenueTotal,
  formatClickRate,
  formatMoney,
  groupByDay,
  keywordTable,
  namedKeywordCount,
  revenueByCountryCode,
  revenueByDay,
  revenueByDayAndCountry,
  revenueCountriesOnDay,
  sourceFromAccountName,
} from './report'

describe('日报', () => {
  it('从推荐链接取出文章 ID 和渠道 ID，同一篇文章只保留一次', () => {
    expect(
      articleLinks([
        'https://vitafluxly.com/detail/773317117881?subid1=5949606886&subid2=773317117881&channel=5949606886&rType=2&ref=a',
        'https://vitafluxly.com/detail/773317117881?channel=111',
        'https://vitafluxly.com/about',
        'https://vitafluxly.com/detail/12?subid1=88',
      ]),
    ).toEqual([
      { articleId: '773317117881', channelId: '5949606886' },
      { articleId: '12', channelId: '88' },
    ])
  })

  it('今天换下的文章留在当天，过去有记录的日期只用当时的文章', () => {
    const current = [{ articleId: 'new', channelId: '2' }]
    const kept = [{ day: '2026-10-29', articleId: 'old', channelId: '1' }]
    expect(linksForReportDay('2026-10-29', '2026-10-29', current, kept)).toEqual([
      { articleId: 'new', channelId: '2' },
      { articleId: 'old', channelId: '1' },
    ])
    expect(linksForReportDay('2026-10-28', '2026-10-29', current, kept)).toEqual(current)
    expect(
      linksForReportDay('2026-10-28', '2026-10-29', current, [{ day: '2026-10-28', articleId: 'old', channelId: '1' }]),
    ).toEqual([{ articleId: 'old', channelId: '1' }])
  })

  it('换链接时记下换下和换上的文章', () => {
    expect(
      changedArticleLinks(
        [{ url: 'https://a.com/detail/111?channel=9', countryCode: 'US' }],
        ['https://a.com/detail/222?channel=8'],
      ),
    ).toEqual([
      { articleId: '111', channelId: '9', countryCode: 'US' },
      { articleId: '222', channelId: '8', countryCode: '' },
    ])
    expect(changedArticleLinks([{ url: 'https://a.com/detail/111?channel=9' }], ['https://a.com/detail/111?channel=9'])).toEqual(
      [],
    )
  })

  it('日期按天展开，包含起止两天', () => {
    expect(eachDay('2026-10-27', '2026-10-29')).toEqual(['2026-10-27', '2026-10-28', '2026-10-29'])
    expect(eachDay('2026-10-29', '2026-10-27')).toEqual([])
  })

  it('重复关键词按次累加，空关键词单独计数', () => {
    const rows = keywordTable(
      [
        { keyword: 'drain' },
        { keyword: 'drain' },
        { keyword: ' hvac ' },
        { keyword: ' ' },
      ],
      [{ keyword: 'drain' }, { keyword: 'drain' }, { keyword: 'drain' }, { keyword: '' }],
    )
    expect(rows).toEqual([
      { keyword: 'drain', termClicks: 2, adClicks: 3 },
      { keyword: 'hvac', termClicks: 1, adClicks: 0 },
      { keyword: '', termClicks: 1, adClicks: 1 },
    ])
    expect(namedKeywordCount(rows)).toBe(2)
  })

  it('埋点按创建日期分天，毫秒时间戳按本地日期归入当天', () => {
    const grouped = groupByDay([
      { createTime: '2026-10-28 10:00:00', keyword: 'a' },
      { createTime: '2026-10-28 23:00:00', keyword: 'b' },
      { createTime: '2026-10-29 00:01:00', keyword: 'c' },
      { createTime: null },
    ])
    expect(grouped.get('2026-10-28')).toHaveLength(2)
    expect(grouped.get('2026-10-29')).toHaveLength(1)

    const stamp = new Date(2026, 9, 25, 15, 30, 0).getTime()
    const stamped = groupByDay([
      { createTime: stamp, keyword: 'a' },
      { createTime: String(stamp), keyword: 'b' },
    ])
    expect(stamped.get('2026-10-25')).toHaveLength(2)
    expect(stamped.has('1793')).toBe(false)
  })

  it('收入丢掉汇总行，同一天多行相加', () => {
    const totals = revenueByDay([
      { date: '汇总', estimatedEarnings: '21.09' },
      { date: '2026-10-29 00:00:00', estimatedEarnings: '3.79' },
      { date: '2026-10-29 00:00:00', estimatedEarnings: '2.72' },
      { date: '2026-10-30 00:00:00', estimatedEarnings: '2.84' },
      { targetTime: '2026-10-28', revenue: '1.00000' },
    ])
    expect(totals.get('2026-10-29')).toBeCloseTo(6.51)
    expect(formatMoney(totals.get('2026-10-30') ?? 0)).toBe('2.84')
    expect(totals.get('2026-10-28')).toBeCloseTo(1)
    expect(totals.has('汇总')).toBe(false)
  })

  it('afsData 按国家汇总收入', () => {
    const rows = [
      { date: '2026-11-05', countryCode: 'us', estimatedEarnings: '3.5', customChannelId: '1' },
      { date: '2026-11-05', countryCode: 'JP', estimatedEarnings: '2', customChannelId: '1' },
      { date: '2026-11-06', countryCode: 'US', estimatedEarnings: '1.5', customChannelId: '2' },
      { date: '汇总', countryCode: 'US', estimatedEarnings: '99' },
    ]
    expect(revenueByCountryCode(rows).get('US')).toBeCloseTo(5)
    expect(revenueByCountryCode(rows).get('JP')).toBeCloseTo(2)
    expect(revenueByDayAndCountry(rows).get('2026-11-05\nUS')).toBeCloseTo(3.5)
    expect(revenueCountriesOnDay(rows, '2026-11-05')).toEqual([
      { countryCode: 'US', revenue: 3.5 },
      { countryCode: 'JP', revenue: 2 },
    ])
  })

  it('文章账户名 A3 / AFS3 得到收入 source，并拼 domain', () => {
    expect(sourceFromAccountName('A3')).toBe('3')
    expect(sourceFromAccountName('A4')).toBe('4')
    expect(sourceFromAccountName('AFS3')).toBe('3')
    expect(sourceFromAccountName('jiayao')).toBe('')
    expect(afsReportDomain('3', '28461')).toBe('3-28461')
    expect(afsReportDomain('11', '28461')).toBe('11-28461')
    expect(afsReportDomain('', '28461')).toBe('')
  })

  it('每日总收入和前一天比较，缺数时不算变化', () => {
    expect(dailyRevenueTotal([1.2, 3])).toBeCloseTo(4.2)
    expect(dailyRevenueTotal([1, null])).toBe(1)
    expect(dailyRevenueTotal([null, null])).toBeNull()
    expect(compareDailyRevenue([10, 5], [8, 2])).toEqual({ total: 15, delta: 5, rate: 0.5 })
    expect(compareDailyRevenue([4], [8])).toMatchObject({ total: 4, delta: -4, rate: -0.5 })
    expect(compareDailyRevenue([3], null)).toEqual({ total: 3, delta: null, rate: null })
    expect(compareDailyRevenue([1, null], [4])).toEqual({ total: 1, delta: -3, rate: -0.75 })
    expect(compareDailyRevenue([2], [0])).toEqual({ total: 2, delta: 2, rate: null })
  })

  it('点击率是点击数除以曝光', () => {
    expect(formatClickRate(12, 1200)).toBe('1.00%')
    expect(formatClickRate(0, 10)).toBe('0.00%')
    expect(formatClickRate(3, 0)).toBe('—')
  })

  it('把按日统计接口整理成文章日报，总数不依赖关键词截断', () => {
    expect(
      articleDayStatsFromDaily([
        {
          date: '2026-10-28',
          items: [
            {
              subid2: '123',
              pageViewCount: 100,
              termClickCount: 40,
              adClicksCount: 9,
              keywordCount: 5,
              keywords: [{ keyword: 'a', termClickCount: 3, adClicksCount: 1 }],
            },
            {
              subid2: '556',
              pageViewCount: 20,
              termClickCount: 2,
              adClicksCount: 0,
              keywords: [],
            },
          ],
        },
      ]),
    ).toEqual([
      {
        articleId: '123',
        day: '2026-10-28',
        pageViews: 100,
        termClicks: 40,
        adClicks: 9,
        keywordCount: 5,
        keywords: [{ keyword: 'a', termClicks: 3, adClicks: 1 }],
      },
      {
        articleId: '556',
        day: '2026-10-28',
        pageViews: 20,
        termClicks: 2,
        adClicks: 0,
        keywordCount: 0,
        keywords: [],
      },
    ])
  })
})
