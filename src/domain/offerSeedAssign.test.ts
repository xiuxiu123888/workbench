import { describe, expect, it } from 'vitest'
import { assignSeedsToOffers } from './offerSeedAssign'

function seqRandom(values: number[]) {
  let i = 0
  return () => {
    const value = values[i] ?? 0
    i += 1
    return value
  }
}

describe('assignSeedsToOffers', () => {
  it('assigns the same word to every offer when only one seed', () => {
    const rows = assignSeedsToOffers(
      [{ offerId: 'a' }, { offerId: 'b' }, { offerId: 'c' }],
      ['only'],
      () => 0,
    )
    expect(rows.map((row) => row.seed)).toEqual(['only', 'only', 'only'])
    expect(rows.every((row) => Boolean(row.seed))).toBe(true)
  })

  it('cycles when seeds are fewer than offers', () => {
    // random=0 的 Fisher–Yates 会把 [x,y] 打成 [y,x]
    const rows = assignSeedsToOffers(
      [{ offerId: '1' }, { offerId: '2' }, { offerId: '3' }, { offerId: '4' }, { offerId: '5' }],
      ['x', 'y'],
      () => 0,
    )
    expect(rows).toHaveLength(5)
    expect(new Set(rows.map((row) => row.seed))).toEqual(new Set(['x', 'y']))
    expect(rows.map((row) => row.seed)).toEqual(['y', 'x', 'y', 'x', 'y'])
  })

  it('uses shuffled order and one seed per offer when seeds are more', () => {
    // Fisher–Yates with this sequence swaps toward [c,b,a,d,...] style; assert length + uniqueness of first n
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const rows = assignSeedsToOffers(
      [{ offerId: '1' }, { offerId: '2' }, { offerId: '3' }, { offerId: '4' }, { offerId: '5' }],
      seeds,
      seqRandom([0.9, 0.1, 0.5, 0.2, 0.8, 0.3, 0.7]),
    )
    expect(rows).toHaveLength(5)
    expect(new Set(rows.map((row) => row.offerId)).size).toBe(5)
    expect(rows.every((row) => seeds.includes(row.seed as string))).toBe(true)
    // 每人一词；多于 offer 的词不会强制用完，但分配结果应来自打乱池
    expect(rows.map((row) => row.seed).length).toBe(5)
  })

  it('throws when offers or seeds are empty', () => {
    expect(() => assignSeedsToOffers([], ['a'])).toThrow('offer')
    expect(() => assignSeedsToOffers([{ offerId: '1' }], [])).toThrow('种子词')
  })
})
