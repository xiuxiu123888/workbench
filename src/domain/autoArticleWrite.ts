import { buildCreatePayload, buildDirectLandingUrl, channelFromUrl, landingUrlFromCreated } from './campaignForm'

/** 已有推荐链接对应文章的国家（国家在文章上，不在 recentArticles 对象里） */
export interface ExistingArticleLink {
  url: string
  countryCode: string
  channelId: string
}

export function reusableChannelForCountry(items: ExistingArticleLink[], countryCode: string): string {
  const code = String(countryCode ?? '')
    .trim()
    .toUpperCase()
  if (!code) {
    return ''
  }
  for (const item of items) {
    if (item.countryCode.trim().toUpperCase() !== code) {
      continue
    }
    const channel = item.channelId.trim() || channelFromUrl(item.url).trim()
    if (channel) {
      return channel
    }
  }
  return ''
}

export function resolveLandingUrl(input: {
  domain: string
  articleId: string
  countryCode: string
  /** 落地链接 ref 参数（可与种子词不同） */
  intentKeyword: string
  existing: ExistingArticleLink[]
  afsSource: string
  /** 选填：指定渠道时直接拼链接，不走复用/MIS */
  preferredChannelId?: string
  createCampaign: (payload: Record<string, unknown>) => Promise<string>
}): Promise<{ url: string; reusedChannel: boolean; channelId: string; mode: 'preferred' | 'reused' | 'created' }> {
  const linkRef = input.intentKeyword.trim() || input.countryCode
  const preferred = String(input.preferredChannelId ?? '').trim()
  if (preferred) {
    return Promise.resolve({
      url: buildDirectLandingUrl(input.domain, input.articleId, preferred, linkRef),
      reusedChannel: true,
      channelId: preferred,
      mode: 'preferred',
    })
  }

  const reused = reusableChannelForCountry(input.existing, input.countryCode)
  if (reused) {
    return Promise.resolve({
      url: buildDirectLandingUrl(input.domain, input.articleId, reused, linkRef),
      reusedChannel: true,
      channelId: reused,
      mode: 'reused',
    })
  }

  const form = {
    source: input.afsSource,
    articleId: String(input.articleId).trim(),
    siteName: input.domain,
    investTitle: linkRef,
  }
  const payload = buildCreatePayload(form)
  return input.createCampaign({ ...payload }).then((created) => {
    const url = landingUrlFromCreated(form, created)
    return {
      url,
      reusedChannel: false,
      channelId: channelFromUrl(url),
      mode: 'created',
    }
  })
}
