export interface CampaignFormState {
  source: string
  articleId: string
  siteName: string
  investTitle: string
}

export interface CreatePayload {
  source: string
  articleId: string
  siteName: string
  investTitle: string
  investChannel: 'TikTok'
  rType: 2
  singleChannelMode: false
  subid2: string
  subid3: '{data-campaign}'
  subid4: '{data-campaign_name}'
  subid5: '{data-adgroup_id}'
  subid6: '{data-creative_id}'
  subid7: '{data-account_id}'
}

export function createEmptyCampaignForm(): CampaignFormState {
  return {
    source: '',
    articleId: '',
    siteName: '',
    investTitle: '',
  }
}

export function isPureArticleId(value: string): boolean {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    return false
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && String(parsed) === trimmed
}

export function isHttpUrl(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!text) {
    return false
  }
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function queryParam(url: string, key: string): string {
  const text = url.trim()
  if (!text) {
    return ''
  }
  try {
    return new URL(text).searchParams.get(key) ?? ''
  } catch {
    const match = text.match(new RegExp(`[?&]${key}=([^&#]*)`))
    return match?.[1] ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : ''
  }
}

export function channelFromUrl(url: string): string {
  return queryParam(url, 'channel') || queryParam(url, 'subid1')
}

export function pickSiteName(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim()
  }
  if (data && typeof data === 'object' && 'siteUrl' in data) {
    const siteUrl = (data as { siteUrl?: unknown }).siteUrl
    return typeof siteUrl === 'string' ? siteUrl.trim() : ''
  }
  return ''
}

export type CampaignField = keyof CampaignFormState

const FIELD_MESSAGE: Record<CampaignField, string> = {
  source: '请选择 AFS 账户',
  articleId: '请输入文章 ID',
  siteName: '请输入域名',
  investTitle: '请输入投放标题',
}

export function validateCampaign(form: CampaignFormState): Partial<Record<CampaignField, string>> {
  const errors: Partial<Record<CampaignField, string>> = {}
  ;(Object.keys(FIELD_MESSAGE) as CampaignField[]).forEach((field) => {
    if (!form[field].trim()) {
      errors[field] = FIELD_MESSAGE[field]
    }
  })
  return errors
}

export function buildCreatePayload(form: CampaignFormState): CreatePayload {
  const articleId = form.articleId.trim()
  return {
    source: form.source,
    articleId,
    siteName: form.siteName.trim(),
    investTitle: form.investTitle,
    investChannel: 'TikTok',
    rType: 2,
    singleChannelMode: false,
    subid2: articleId,
    subid3: '{data-campaign}',
    subid4: '{data-campaign_name}',
    subid5: '{data-adgroup_id}',
    subid6: '{data-creative_id}',
    subid7: '{data-account_id}',
  }
}

export function siteOrigin(siteName: string): string {
  const trimmed = siteName.trim().replace(/\/+$/, '')
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return new URL(withProtocol).origin
}

export function buildLandingUrl(input: {
  siteName: string
  articleId: string
  investTitle: string
  channel: string
}): string {
  const params = new URLSearchParams()
  params.set('subid1', input.channel)
  params.set('subid2', input.articleId.trim())
  params.set('partner', 'TikTok')
  params.set('rType', '2')
  params.set('ref', input.investTitle)
  params.set('channel', input.channel)
  return `${siteOrigin(input.siteName)}/detail/${input.articleId.trim()}?${params.toString()}`
}

export function buildDirectLandingUrl(siteName: string, articleId: string, channelId: string, linkRef: string): string {
  const id = articleId.trim()
  const channel = channelId.trim()
  const ref = new URLSearchParams()
  ref.set('ref', linkRef)
  return `${siteOrigin(siteName)}/detail/${id}?subid1=${encodeURIComponent(channel)}&subid2=${encodeURIComponent(id)}&channel=${encodeURIComponent(channel)}&rType=2&${ref.toString()}`
}

export function landingUrlFromCreated(form: CampaignFormState, createdUrl: string): string {
  const channel = channelFromUrl(createdUrl)
  if (!channel) {
    throw new Error('创建成功，但返回链接里没有渠道号')
  }
  return buildLandingUrl({
    siteName: form.siteName,
    articleId: form.articleId,
    investTitle: form.investTitle,
    channel,
  })
}
