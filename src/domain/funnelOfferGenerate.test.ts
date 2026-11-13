import { describe, expect, it } from 'vitest'
import {
  buildOfferLandingUrl,
  defaultSeedKeyword,
  hostFromLandingUrl,
  matchCategoryIdByName,
  pickOfferJobResult,
  regionFromCountry,
  resolveOfferSiteTarget,
  rewriteOfferUrlArticleAndRef,
} from './funnelOfferGenerate'

describe('funnelOfferGenerate', () => {
  it('maps VN to VI and rejects unknown country', () => {
    expect(regionFromCountry('vn')).toBe('VI')
    expect(regionFromCountry('US')).toBe('US')
    expect(regionFromCountry('XX')).toBe('')
  })

  it('matches category by name or alias', () => {
    const categories = [
      { id: 1, name: 'Finance', alias: '金融' },
      { id: 2, name: 'Health', alias: '' },
    ]
    expect(matchCategoryIdByName(categories, '金融')).toBe(1)
    expect(matchCategoryIdByName(categories, 'health')).toBe(2)
    expect(matchCategoryIdByName(categories, '')).toBeNull()
  })

  it('resolves site target from landing url host', () => {
    const sites = [
      { id: 9, siteName: 'demo.example.com', siteUrl: 'https://demo.example.com', accountId: 3 },
    ]
    const target = resolveOfferSiteTarget(sites, 'https://www.demo.example.com/detail/12345?x=1')
    expect(target).toEqual({
      domain: 'demo.example.com',
      siteId: 9,
      accountId: 3,
      articleId: '12345',
    })
    expect(hostFromLandingUrl('https://www.demo.example.com/a')).toBe('demo.example.com')
  })

  it('picks success result for domain', () => {
    expect(
      pickOfferJobResult(
        [
          { status: 'failed', id: 1, domain: 'a.com' },
          { status: 'success', id: 2, domain: 'demo.example.com', article_id: 88 },
        ],
        'demo.example.com',
      ),
    ).toEqual({ id: 2, articleId: '88' })
  })

  it('defaults seed from category then offer name', () => {
    expect(defaultSeedKeyword({ categoryName: 'Health', offerName: 'Offer A' })).toBe('Health')
    expect(defaultSeedKeyword({ categoryName: '', offerName: 'Offer A' })).toBe('Offer A')
  })

  it('rewrites offer landing url with new article id, subids and seed ref', () => {
    const next = buildOfferLandingUrl(
      'https://demo.example.com/detail/111?ref=old&channel=99&hit={hit}',
      '99',
      '222',
      'Opdivo Cost Without Insurance',
    )
    expect(next).toContain('/detail/222?')
    expect(next).toContain('subid1=99')
    expect(next).toContain('subid2=222')
    expect(next).toContain('channel=99')
    expect(next).toContain('ref=Opdivo+Cost+Without+Insurance')
    expect(next).toContain('hit={hit}')
    expect(next).not.toContain('hit=%7Bhit%7D')
    expect(next).not.toContain('ref=old')
  })

  it('only rewrites article id and ref on offer.url, keeps other params intact', () => {
    const next = rewriteOfferUrlArticleAndRef(
      'https://demo.example.com/detail/111?ref=old%20kw&channel=99&hit={hit}&rType=2&partner=Blinkdrama',
      '222',
      'Opdivo Cost Without Insurance',
    )
    expect(next).toBe(
      'https://demo.example.com/detail/222?ref=Opdivo+Cost+Without+Insurance&channel=99&hit={hit}&rType=2&partner=Blinkdrama',
    )
    expect(next).not.toContain('subid1=')
    expect(next).not.toContain('subid2=')
  })
})
