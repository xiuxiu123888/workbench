import { describe, expect, it, vi } from 'vitest'
import { reusableChannelForCountry, resolveLandingUrl } from './autoArticleWrite'

describe('autoArticleWrite', () => {
  it('reuses channel from same country article', () => {
    expect(
      reusableChannelForCountry(
        [
          { url: 'https://a.com/detail/1?channel=111', countryCode: 'US', channelId: '111' },
          { url: 'https://a.com/detail/2?channel=222', countryCode: 'GB', channelId: '222' },
        ],
        'us',
      ),
    ).toBe('111')
    expect(
      reusableChannelForCountry([{ url: 'https://a.com/detail/1', countryCode: 'US', channelId: '' }], 'US'),
    ).toBe('')
    expect(
      reusableChannelForCountry(
        [{ url: 'https://a.com/detail/1?channel=111', countryCode: 'GB', channelId: '111' }],
        'US',
      ),
    ).toBe('')
  })

  it('reuses channel without calling MIS', async () => {
    const createCampaign = vi.fn()
    const result = await resolveLandingUrl({
      domain: 'example.com',
      articleId: '99',
      countryCode: 'US',
      intentKeyword: 'dental',
      existing: [
        {
          url: 'https://example.com/detail/1?channel=555&subid1=555',
          countryCode: 'US',
          channelId: '555',
        },
      ],
      afsSource: '3',
      createCampaign,
    })
    expect(createCampaign).not.toHaveBeenCalled()
    expect(result.reusedChannel).toBe(true)
    expect(result.channelId).toBe('555')
    expect(result.url).toContain('/detail/99')
    expect(result.url).toContain('channel=555')
  })

  it('creates MIS campaign when country has no channel', async () => {
    const createCampaign = vi.fn().mockResolvedValue('https://mis.example/x?channel=777&subid1=777')
    const result = await resolveLandingUrl({
      domain: 'example.com',
      articleId: '99',
      countryCode: 'US',
      intentKeyword: 'dental',
      existing: [{ url: 'https://example.com/detail/1', countryCode: 'US', channelId: '' }],
      afsSource: '3',
      createCampaign,
    })
    expect(createCampaign).toHaveBeenCalledOnce()
    expect(result.reusedChannel).toBe(false)
    expect(result.channelId).toBe('777')
    expect(result.mode).toBe('created')
    expect(result.url).toContain('channel=777')
  })

  it('uses preferred channel and ref without MIS', async () => {
    const createCampaign = vi.fn()
    const result = await resolveLandingUrl({
      domain: 'example.com',
      articleId: '99',
      countryCode: 'US',
      intentKeyword: 'my-ref',
      preferredChannelId: '888',
      existing: [],
      afsSource: '3',
      createCampaign,
    })
    expect(createCampaign).not.toHaveBeenCalled()
    expect(result.mode).toBe('preferred')
    expect(result.channelId).toBe('888')
    expect(result.url).toContain('channel=888')
    expect(result.url).toContain('ref=my-ref')
    expect(result.url).toContain('/detail/99')
  })
})
