import { describe, expect, it } from 'vitest'
import {
  listSeedRegions,
  listSeedsForCategories,
  normalizeOfferTags,
  normalizeSeedLexicon,
} from './offerSeedLexicon'

describe('offerSeedLexicon', () => {
  it('merges categories and drops empty/duplicate keywords', () => {
    const file = normalizeSeedLexicon({
      updatedAt: '2026-01-01T00:00:00.000Z',
      categories: [
        {
          categoryKey: '医疗·皮肤',
          categoryId: 1,
          seeds: [{ keyword: 'A', regionId: 'US' }, { keyword: 'a', regionId: 'US' }, { keyword: '  ' }],
        },
        {
          categoryKey: '医疗·皮肤',
          seeds: [{ keyword: 'B', ref: 'B-ref', regionId: 'US' }],
        },
      ],
    })
    expect(file.categories).toHaveLength(1)
    expect(file.categories[0].seeds.map((row) => row.keyword)).toEqual(['A', 'B'])
    expect(file.categories[0].seeds[1].ref).toBe('B-ref')
  })

  it('keeps same keyword under different regions in one category', () => {
    const file = normalizeSeedLexicon({
      categories: [
        {
          categoryKey: '牙科',
          seeds: [
            { keyword: 'Implant Cost', regionId: 'US' },
            { keyword: 'Implant Cost', regionId: 'VI' },
          ],
        },
      ],
    })
    expect(file.categories[0].seeds).toHaveLength(2)
    expect(file.categories[0].seeds.map((row) => row.regionId)).toEqual(['US', 'VI'])
  })

  it('lists seeds filtered by category keys and regions', () => {
    const file = normalizeSeedLexicon({
      categories: [
        {
          categoryKey: 'A',
          seeds: [
            { keyword: 'a1', regionId: 'US' },
            { keyword: 'a2', regionId: 'VI' },
          ],
        },
        { categoryKey: 'B', seeds: [{ keyword: 'b1', regionId: 'US' }] },
      ],
    })
    expect(listSeedsForCategories(file, ['B']).map((row) => row.keyword)).toEqual(['b1'])
    expect(listSeedsForCategories(file, null, ['VI']).map((row) => row.keyword)).toEqual(['a2'])
    expect(listSeedRegions(file)).toEqual(['US', 'VI'])
  })

  it('normalizes offer tags', () => {
    const file = normalizeOfferTags({
      offers: {
        o1: { categoryKey: '皮肤', note: 'x' },
        '  ': { categoryKey: '皮肤' },
        o2: { categoryKey: '' },
      },
    })
    expect(file.offers).toEqual({ o1: { categoryKey: '皮肤', note: 'x' } })
  })
})
