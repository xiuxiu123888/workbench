import { describe, expect, it } from 'vitest'
import {
  buildCreatePayload,
  buildDirectLandingUrl,
  buildLandingUrl,
  channelFromUrl,
  createEmptyCampaignForm,
  isHttpUrl,
  landingUrlFromCreated,
  pickSiteName,
  validateCampaign,
} from './campaignForm'

describe('创建请求', () => {
  it('只要求四项，跟踪参数默认 rType=2 且 subid2 等于文章 ID', () => {
    const form = {
      ...createEmptyCampaignForm(),
      source: '1',
      articleId: ' 773317117881 ',
      siteName: ' vitafluxly.com ',
      investTitle: 'Drain Cleaning Costs in 2026 ',
    }
    expect(validateCampaign(createEmptyCampaignForm())).toMatchObject({
      source: '请选择 AFS 账户',
      articleId: '请输入文章 ID',
      siteName: '请输入域名',
      investTitle: '请输入投放标题',
    })
    expect(buildCreatePayload(form)).toMatchObject({
      source: '1',
      articleId: '773317117881',
      siteName: 'vitafluxly.com',
      investTitle: 'Drain Cleaning Costs in 2026 ',
      investChannel: 'TikTok',
      rType: 2,
      subid2: '773317117881',
    })
  })
})

describe('落地页链接', () => {
  it('用返回链接里的渠道号拼成固定格式', () => {
    const form = {
      source: '1',
      articleId: '773317117881',
      siteName: 'https://vitafluxly.com/',
      investTitle: 'Drain Cleaning Costs in 2026 ',
    }
    const created =
      'https://vitafluxly.com/detail/773317117881?subid1=5949606886&subid3=%7Bdata-campaign%7D&channel=5949606886&tt_pixel_id=abc'

    expect(channelFromUrl(created)).toBe('5949606886')
    expect(landingUrlFromCreated(form, created)).toBe(
      'https://vitafluxly.com/detail/773317117881?subid1=5949606886&subid2=773317117881&partner=TikTok&rType=2&ref=Drain+Cleaning+Costs+in+2026+&channel=5949606886',
    )
    expect(buildLandingUrl({ ...form, channel: '5949606886' })).toBe(
      'https://vitafluxly.com/detail/773317117881?subid1=5949606886&subid2=773317117881&partner=TikTok&rType=2&ref=Drain+Cleaning+Costs+in+2026+&channel=5949606886',
    )
  })

  it('已有渠道 ID 时按固定顺序直接拼链接', () => {
    expect(buildDirectLandingUrl('vitafluxly.com', ' 773317117881 ', ' 5949606886 ', 'Drain Cleaning Costs in 2026 ')).toBe(
      'https://vitafluxly.com/detail/773317117881?subid1=5949606886&subid2=773317117881&channel=5949606886&rType=2&ref=Drain+Cleaning+Costs+in+2026+',
    )
  })

  it('没有渠道号时不生成链接', () => {
    expect(() =>
      landingUrlFromCreated(
        { source: '1', articleId: '1', siteName: 'a.com', investTitle: 't' },
        'https://a.com/detail/1',
      ),
    ).toThrow('没有渠道号')
  })

  it('只接受 http 与 https，并识别域名返回值', () => {
    expect(isHttpUrl('https://vitafluxly.com/detail/1')).toBe(true)
    expect(isHttpUrl('vitafluxly.com')).toBe(false)
    expect(pickSiteName('vitafluxly.com')).toBe('vitafluxly.com')
    expect(pickSiteName({ siteUrl: 'vitafluxly.com' })).toBe('vitafluxly.com')
  })
})
