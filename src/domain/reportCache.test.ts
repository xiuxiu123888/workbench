import { describe, expect, it } from 'vitest'
import { contiguousSpans, normalizeCacheBatch, planReportFetch } from './reportCache'

describe('日报缓存', () => {
  it('连续日期合成一段，跨月也连续，中间断开就拆开', () => {
    expect(contiguousSpans(['2026-10-31', '2026-11-01', '2026-10-29', '2026-10-29'])).toEqual([
      ['2026-10-29'],
      ['2026-10-31', '2026-11-01'],
    ])
    expect(contiguousSpans(['2026-10-31', '2026-11-02'])).toEqual([['2026-10-31'], ['2026-11-02']])
  })

  it('今天以前都齐了就不再请求，今天仍要查；空收入不算齐', () => {
    const plan = planReportFetch({
      days: ['2026-10-27', '2026-10-28', '2026-10-29'],
      today: '2026-10-29',
      articleIds: ['a'],
      channelIds: ['c'],
      investor: ' jiayao ',
      articles: [
        { articleId: 'a', day: '2026-10-27', pageViews: 1, keywords: [] },
        { articleId: 'a', day: '2026-10-28', pageViews: 2, keywords: [] },
        { articleId: 'a', day: '2026-10-29', pageViews: 9, keywords: [] },
      ],
      channels: [
        { channelId: 'c', investor: 'jiayao', day: '2026-10-27', revenue: 1 },
        { channelId: 'c', investor: 'jiayao', day: '2026-10-28', revenue: null },
      ],
    })
    expect(plan.cachedDayCount).toBe(1)
    expect(plan.pendingDayCount).toBe(2)
    expect(plan.articles).toEqual([{ id: 'a', days: ['2026-10-29'] }])
    expect(plan.channels).toEqual([{ id: 'c', days: ['2026-10-28', '2026-10-29'] }])
  })

  it('缺的历史天按洞拆开，另一篇文章和另一个优化师互不影响', () => {
    const plan = planReportFetch({
      days: ['2026-10-27', '2026-10-28', '2026-10-29'],
      today: '2026-10-30',
      articleIds: ['a', 'b', 'a'],
      channelIds: ['c'],
      investor: 'jiayao',
      articles: [
        { articleId: 'a', day: '2026-10-28', pageViews: 1, keywords: [] },
        { articleId: 'b', day: '2026-10-27', pageViews: 1, keywords: [] },
        { articleId: 'b', day: '2026-10-28', pageViews: 1, keywords: [] },
        { articleId: 'b', day: '2026-10-29', pageViews: 1, keywords: [] },
      ],
      channels: [
        { channelId: 'c', investor: 'other', day: '2026-10-27', revenue: 3 },
        { channelId: 'c', investor: 'jiayao', day: '2026-10-28', revenue: 4 },
      ],
    })
    expect(plan.cachedDayCount).toBe(1)
    expect(plan.pendingDayCount).toBe(2)
    expect(plan.articles).toEqual([
      { id: 'a', days: ['2026-10-27'] },
      { id: 'a', days: ['2026-10-29'] },
    ])
    expect(plan.channels).toEqual([{ id: 'c', days: ['2026-10-27'] }, { id: 'c', days: ['2026-10-29'] }])
  })

  it('没有渠道 ID 时只看文章是否已缓存', () => {
    const plan = planReportFetch({
      days: ['2026-10-27'],
      today: '2026-10-29',
      articleIds: ['a'],
      channelIds: [''],
      investor: '',
      articles: [{ articleId: 'a', day: '2026-10-27', pageViews: 0, keywords: [] }],
      channels: [],
    })
    expect(plan.cachedDayCount).toBe(1)
    expect(plan.pendingDayCount).toBe(0)
    expect(plan.articles).toEqual([])
    expect(plan.channels).toEqual([])
  })

  it('缓存内容保留空收入和关键词原文', () => {
    expect(
      normalizeCacheBatch({
        articles: [
          {
            articleId: ' 12 ',
            day: '2026-10-27',
            pageViews: 4,
            keywords: [{ keyword: 'drain ', termClicks: 2, adClicks: 0 }],
          },
        ],
        channels: [
          { channelId: '88', investor: ' jiayao ', day: '2026-10-27', revenue: null },
          { channelId: '88', investor: '', day: '2026-10-28', revenue: 0 },
        ],
      }),
    ).toEqual({
      articles: [
        {
          articleId: '12',
          day: '2026-10-27',
          pageViews: 4,
          termClicks: 2,
          adClicks: 0,
          keywordCount: 1,
          keywords: [{ keyword: 'drain ', termClicks: 2, adClicks: 0 }],
        },
      ],
      channels: [
        { channelId: '88', investor: 'jiayao', day: '2026-10-27', revenue: null },
        { channelId: '88', investor: '', day: '2026-10-28', revenue: 0 },
      ],
    })
  })
})
