import { describe, expect, it } from 'vitest'
import { FUNNEL_BROWSE_ALLOWLIST } from './funnelBrowseAllowlist'
import {
  buildOfferCreateName,
  buildOfferCreateUrls,
  buildRowsFromAllowlistFunnels,
  matchAccountByLabel,
  matchSiteByDomain,
  parseOfferCreateLines,
  rotateCosmeticSeed,
} from './offerCreate'

describe('offerCreate', () => {
  it('builds offer name with A17 pattern', () => {
    expect(
      buildOfferCreateName({
        partner: 'blinkdrama',
        version: 'v0x',
        accountCode: 'A17',
        countryCode: 'US',
        channelId: '123456',
        domain: 'seekmoon.ai',
      }),
    ).toBe('blinkdrama-v0x-A17-us-123456-seekmoon.ai')
  })

  it('prefers funnelName for offer name', () => {
    expect(
      buildOfferCreateName({
        partner: 'x',
        version: 'v0x',
        accountCode: 'A17',
        countryCode: 'US',
        channelId: '99',
        domain: 'seekmoon.ai',
        funnelName: 'Blinkdrama-sign-v01',
      }),
    ).toBe('Blinkdrama-sign-v01-A17-us-99-seekmoon.ai')
  })

  it('rotates cosmetic seeds across allowlist funnels', () => {
    expect(rotateCosmeticSeed(0)).toBe('Cosmetic Products')
    expect(rotateCosmeticSeed(3)).toBe('Best Beauty Products for Mature Skin')
    expect(rotateCosmeticSeed(4)).toBe('Cosmetic Products')

    const funnels = FUNNEL_BROWSE_ALLOWLIST.map((name, i) => ({
      funnelId: `id-${i}`,
      funnelName: name,
    }))
    const rows = buildRowsFromAllowlistFunnels(funnels, { allowNames: FUNNEL_BROWSE_ALLOWLIST })
    expect(rows).toHaveLength(FUNNEL_BROWSE_ALLOWLIST.length)
    expect(rows[0].funnelName).toBe('Blinkdrama-sign-v01')
    expect(rows[0].ref).toBe('Cosmetic Products')
    expect(rows[1].ref).toBe('Cosmetics and Beauty Products')
    expect(rows[4].ref).toBe('Cosmetic Products')
  })

  it('builds landing urls with hit macro', () => {
    const { url, resultUrl } = buildOfferCreateUrls({
      domain: 'seekmoon.ai',
      articleId: '880978554898',
      channelId: '5949606886',
      ref: 'Cosmetic Products',
    })
    expect(url).toContain('https://seekmoon.ai/detail/880978554898')
    expect(url).toContain('channel=5949606886')
    expect(url).toContain('ref=Cosmetic+Products')
    expect(resultUrl).toContain('hit={hit}')
    expect(resultUrl).not.toContain('%7Bhit%7D')
  })

  it('parses paste lines', () => {
    const rows = parseOfferCreateLines(
      ['Cosmetic Products', 'moboreels\tBest Beauty Products for Mature Skin'].join('\n'),
      'blinkdrama',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].partner).toBe('blinkdrama')
    expect(rows[0].ref).toBe('Cosmetic Products')
    expect(rows[1].partner).toBe('moboreels')
    expect(rows[1].ref).toBe('Best Beauty Products for Mature Skin')
  })

  it('matches account and site', () => {
    const account = matchAccountByLabel(
      [
        { id: 1, name: 'A4' },
        { id: 17, name: 'A17' },
      ],
      'A17',
    )
    expect(account?.id).toBe(17)
    const site = matchSiteByDomain(
      [
        { id: 9, siteName: 'seekmoon.ai', accountId: 17 },
        { id: 8, siteName: 'other.com', accountId: 17 },
      ],
      'seekmoon.ai',
      17,
    )
    expect(site?.id).toBe(9)
  })
})
