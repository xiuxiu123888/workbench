import { describe, expect, it } from 'vitest'
import {
  aggregateHarvestKeywords,
  enrichHarvestWithCategories,
  harvestKeywordsFromDaily,
  harvestRowsToSeeds,
  mergeHarvestIntoLexiconByCategory,
  scoreHarvestKeyword,
  voteCategoryId,
} from './keywordHarvest'
import { emptySeedLexicon } from './offerSeedLexicon'

describe('keywordHarvest', () => {
  it('scores ad-heavy keywords higher', () => {
    expect(
      scoreHarvestKeyword({ termClicks: 100, adClicks: 20, adRate: 0.2 }),
    ).toBeGreaterThan(scoreHarvestKeyword({ termClicks: 100, adClicks: 2, adRate: 0.02 }))
  })

  it('aggregates keywords and keeps article ids', () => {
    const rows = aggregateHarvestKeywords(
      [
        {
          articleId: '1',
          day: '2026-11-13',
          pageViews: 100,
          termClicks: 50,
          adClicks: 10,
          keywordCount: 2,
          keywords: [
            { keyword: 'Good Seed', termClicks: 40, adClicks: 8 },
            { keyword: 'weak', termClicks: 5, adClicks: 0 },
          ],
        },
        {
          articleId: '2',
          day: '2026-11-13',
          pageViews: 80,
          termClicks: 30,
          adClicks: 6,
          keywordCount: 1,
          keywords: [{ keyword: 'good seed', termClicks: 30, adClicks: 6 }],
        },
      ],
      { minTermClicks: 20, minAdClicks: 1, minAdRate: 0.05 },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].keyword).toBe('Good Seed')
    expect(rows[0].termClicks).toBe(70)
    expect(rows[0].adClicks).toBe(14)
    expect(rows[0].articleIds.sort()).toEqual(['1', '2'])
  })

  it('votes category from article map and merges lexicon by categoryId', () => {
    expect(voteCategoryId(['a', 'b', 'c'], { a: 10, b: 10, c: 20 }, { a: 1, b: 1, c: 5 })).toBe(20)
    const enriched = enrichHarvestWithCategories(
      [
        {
          keyword: 'facelift',
          termClicks: 50,
          adClicks: 10,
          adRate: 0.2,
          articleCount: 1,
          articleIds: ['9'],
          categoryId: null,
          categoryKey: null,
          days: ['2026-11-13'],
          score: 1,
        },
      ],
      { '9': 5162 },
      [{ id: 5162, name: '面部提拉', parentId: null }],
    )
    expect(enriched[0].categoryId).toBe(5162)
    expect(enriched[0].categoryKey).toContain('面部提拉')

    const lexicon = mergeHarvestIntoLexiconByCategory(emptySeedLexicon(), enriched)
    expect(lexicon.categories[0].categoryId).toBe(5162)
    expect(lexicon.categories[0].seeds[0].keyword).toBe('facelift')
  })

  it('parses subid2DailyStat payload', () => {
    const rows = harvestKeywordsFromDaily(
      [
        {
          date: '2026-11-13',
          items: [
            {
              subid2: '99',
              pageViewCount: 10,
              termClickCount: 50,
              adClicksCount: 10,
              keywords: [{ keyword: 'facelift near me', termClickCount: 50, adClicksCount: 10 }],
            },
          ],
        },
      ],
      { minTermClicks: 10 },
    )
    expect(harvestRowsToSeeds(rows)[0]).toMatchObject({
      keyword: 'facelift near me',
      regionId: 'US',
    })
    expect(rows[0].articleIds).toEqual(['99'])
  })
})
