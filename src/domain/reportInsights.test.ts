import { describe, expect, it } from 'vitest'
import {
  articleClickContributions,
  countryContributions,
  growingArticles,
  replaceCandidates,
  type InsightArticleDay,
} from './reportInsights'

function row(partial: Partial<InsightArticleDay> & Pick<InsightArticleDay, 'day' | 'articleId'>): InsightArticleDay {
  return {
    channelId: 'c1',
    pageViews: 0,
    termClicks: 0,
    adClicks: 0,
    countryCode: 'US',
    kept: false,
    ...partial,
  }
}

describe('reportInsights', () => {
  it('ranks growing articles by ad click delta', () => {
    const newest = [row({ day: '2026-11-03', articleId: '1', adClicks: 10, pageViews: 100 }), row({ day: '2026-11-03', articleId: '2', adClicks: 1, pageViews: 20 })]
    const older = [row({ day: '2026-11-02', articleId: '1', adClicks: 2, pageViews: 80 }), row({ day: '2026-11-02', articleId: '2', adClicks: 5, pageViews: 40 })]
    expect(growingArticles([newest, older], 5).map((item) => item.articleId)).toEqual(['1'])
  })

  it('flags replace candidates by zero views or below median', () => {
    const newest = [
      row({ day: '2026-11-03', articleId: 'dead', pageViews: 0, adClicks: 0 }),
      row({ day: '2026-11-03', articleId: 'weak', pageViews: 2, adClicks: 0 }),
      row({ day: '2026-11-03', articleId: 'ok', pageViews: 40, adClicks: 3 }),
      row({ day: '2026-11-03', articleId: 'kept', pageViews: 0, adClicks: 0, kept: true }),
    ]
    const older = [
      row({ day: '2026-11-02', articleId: 'dead', pageViews: 0, adClicks: 0 }),
      row({ day: '2026-11-02', articleId: 'weak', pageViews: 8, adClicks: 1 }),
      row({ day: '2026-11-02', articleId: 'ok', pageViews: 30, adClicks: 2 }),
    ]
    const ids = replaceCandidates([newest, older]).map((item) => item.articleId)
    expect(ids).toContain('dead')
    expect(ids).toContain('weak')
    expect(ids).not.toContain('ok')
    expect(ids).not.toContain('kept')
  })

  it('aggregates country and article contributions', () => {
    const articles = [
      row({ day: '2026-11-03', articleId: '1', countryCode: 'US', pageViews: 100, termClicks: 10, adClicks: 8 }),
      row({ day: '2026-11-03', articleId: '2', countryCode: 'US', pageViews: 50, termClicks: 4, adClicks: 2 }),
      row({ day: '2026-11-03', articleId: '3', countryCode: 'GB', pageViews: 20, termClicks: 1, adClicks: 0 }),
    ]
    expect(countryContributions(articles)[0]).toMatchObject({ countryCode: 'US', adClicks: 10, pageViews: 150, articleCount: 2 })
    expect(articleClickContributions(articles, 2)[0].articleId).toBe('1')
    expect(articleClickContributions(articles, 2)[0].adShare).toBeCloseTo(0.8)
  })
})
