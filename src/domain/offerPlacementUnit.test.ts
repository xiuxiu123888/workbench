import { describe, expect, it } from 'vitest'
import { buildOfferPlacementUnit, parseOfferNameParts } from './offerPlacementUnit'

describe('offerPlacementUnit', () => {
  it('parses offer name parts', () => {
    expect(parseOfferNameParts('moboreels-v02-A12-US-3731730900-intodeepdive.com')).toEqual({
      accountSlot: 'A12',
      countryCode: 'US',
      channelId: '3731730900',
      domain: 'intodeepdive.com',
    })
  })

  it('builds placement unit from url + category', () => {
    const unit = buildOfferPlacementUnit({
      offerId: 'o1',
      offerName: 'moboreels-v02-A12-US-3731730900-intodeepdive.com',
      beforeUrl:
        'https://intodeepdive.com/detail/126116617267?ref=gm+hybrid+suv&channel=3731730900',
      beforeRef: 'gm hybrid suv',
      plannedSeedRef: 'clorox everclean',
      categoryName: '新能源汽车',
    })
    expect(unit.domain).toBe('intodeepdive.com')
    expect(unit.accountLabel).toBe('A12@intodeepdive.com')
    expect(unit.channelId).toBe('3731730900')
    expect(unit.categoryName).toBe('新能源汽车')
    expect(unit.articleId).toBe('126116617267')
    expect(unit.beforeRef).toBe('gm hybrid suv')
    expect(unit.plannedSeedRef).toBe('clorox everclean')
  })
})
