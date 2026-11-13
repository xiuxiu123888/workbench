import { describe, expect, it } from 'vitest'
import {
  appendGeneratedUrls,
  applyGeneratedUrl,
  buildUpdatePayload,
  normalizeRecentArticles,
  recentArticleItems,
  removeRecentArticle,
  replaceRecentArticle,
} from './recentArticles'

describe('recentArticles', () => {
  it('把字符串、对象和 JSON 字符串整理成 URL 数组', () => {
    expect(normalizeRecentArticles([' https://a.com ', '', { url: 'https://b.com' }, { title: 'x' }])).toEqual([
      'https://a.com',
      'https://b.com',
    ])
    expect(normalizeRecentArticles('["https://a.com",{"url":"https://b.com"}]')).toEqual([
      'https://a.com',
      'https://b.com',
    ])
    expect(normalizeRecentArticles('https://only.com')).toEqual(['https://only.com'])
    expect(normalizeRecentArticles(null)).toEqual([])
  })

  it('从详情里的推荐文章读出 countryCode', () => {
    expect(
      recentArticleItems([
        { url: 'https://a.com/detail/1', countryCode: 'US', title: 't' },
        { url: 'https://b.com', countryCode: '  ' },
        'https://c.com',
      ]),
    ).toEqual([
      { url: 'https://a.com/detail/1', countryCode: 'US' },
      { url: 'https://b.com', countryCode: '' },
      { url: 'https://c.com', countryCode: '' },
    ])
  })

  it('替换选中下标，越界时不改原数组', () => {
    const urls = ['https://old.com']
    const replaced = applyGeneratedUrl(urls, 'replace', 0, 'https://new.com')
    expect(replaced).toEqual({ ok: true, urls: ['https://new.com'], highlightIndex: 0 })
    expect(urls).toEqual(['https://old.com'])

    const missed = applyGeneratedUrl(urls, 'replace', 3, 'https://new.com')
    expect(missed.ok).toBe(false)
    expect(urls).toEqual(['https://old.com'])
  })

  it('追加到末尾', () => {
    expect(applyGeneratedUrl(['https://a.com'], 'append', null, 'https://b.com')).toEqual({
      ok: true,
      urls: ['https://a.com', 'https://b.com'],
      highlightIndex: 1,
    })
  })

  it('更新体只改推荐文章、标签和广告类型', () => {
    const detail = {
      id: 7,
      siteId: 3,
      isPut: true,
      recentArticles: [{ url: 'https://old.com' }],
      adsType: ['ttq'],
      refList: [
        {
          tagId: 1,
          categoryInfoList: [{ categoryId: 9 }, { categoryId: 10 }],
          categoryIds: [1, 2],
        },
        {
          tagId: 2,
          categoryIds: [[4, 5], '6'],
        },
      ],
      email: 'a@b.c',
    }

    const payload = buildUpdatePayload(detail, ['https://new.com'])
    expect(payload.recentArticles).toEqual(['https://new.com'])
    expect(payload.adsType).toBe('["ttq"]')
    expect(payload.refList).toEqual([
      { tagId: 1, categoryIds: [9, 10] },
      { tagId: 2, categoryIds: [5, 6] },
    ])
    expect(payload.email).toBe('a@b.c')
    expect(detail.recentArticles).toEqual([{ url: 'https://old.com' }])
    expect(buildUpdatePayload({ adsType: '["fbq"]', refList: null }, []).adsType).toBe('["fbq"]')
    expect(buildUpdatePayload({ refList: null }, []).refList).toEqual([])
  })

  it('一次追加多条，并标出新写入的下标', () => {
    const current = ['https://old.com']
    const applied = appendGeneratedUrls(current, ['https://a.com', 'https://b.com'])
    expect(applied).toEqual({
      ok: true,
      urls: ['https://old.com', 'https://a.com', 'https://b.com'],
      highlightIndexes: [1, 2],
    })
    expect(current).toEqual(['https://old.com'])
  })

  it('替换或删除某一条时，原数组不变，对不上原来的链接就中止', () => {
    const current = ['https://a.com', 'https://b.com']
    expect(replaceRecentArticle(current, 1, 'https://b.com', 'https://c.com')).toEqual({
      ok: true,
      urls: ['https://a.com', 'https://c.com'],
      highlightIndexes: [1],
    })
    expect(removeRecentArticle(current, 0, 'https://a.com')).toEqual({
      ok: true,
      urls: ['https://b.com'],
      highlightIndexes: [],
    })
    expect(replaceRecentArticle(current, 0, 'https://gone.com', 'https://c.com').ok).toBe(false)
    expect(removeRecentArticle(current, 2, 'https://b.com').ok).toBe(false)
    expect(current).toEqual(['https://a.com', 'https://b.com'])
  })
})
