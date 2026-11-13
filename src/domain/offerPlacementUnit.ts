/** 从 offer 名 / 落地链拆出：域名、账户位、渠道、链接、类目、ref */

export type OfferPlacementUnit = {
  offerId: string
  offerName: string
  /** 账户位，如 A12 */
  accountSlot: string
  /** 展示用账户：A12@intodeepdive.com */
  accountLabel: string
  /** 渠道号 channel */
  channelId: string
  countryCode: string
  domain: string
  /** 落地链接（优先 after，否则 before） */
  link: string
  articleId: string
  categoryName: string
  beforeRef: string
  plannedSeedRef: string
  afterRef: string
  currentRef: string
}

function clean(v: unknown): string {
  return String(v ?? '').trim()
}

export function hostFromUrl(url: string | null | undefined): string {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

export function channelFromUrl(url: string | null | undefined): string {
  try {
    return clean(new URL(String(url || '')).searchParams.get('channel'))
  } catch {
    return ''
  }
}

export function articleIdFromUrl(url: string | null | undefined): string {
  try {
    const path = new URL(String(url || '')).pathname
    const m = path.match(/\/detail\/([^/?#]+)/i)
    return m?.[1] || ''
  } catch {
    return ''
  }
}

/**
 * 解析 `moboreels-v02-A12-US-3731730900-intodeepdive.com`
 * 或 `JZ11-A7-us-8883994701-algo-cash.com`
 * 约定：…-A位-国家-渠道号-域名
 */
export function parseOfferNameParts(offerName: string): {
  accountSlot: string
  countryCode: string
  channelId: string
  domain: string
} {
  const name = clean(offerName)
  const structured = name.match(/-?(A\d+)-([A-Za-z]{2})-(\d{4,})-(.+)$/i)
  if (structured) {
    return {
      accountSlot: structured[1],
      countryCode: structured[2].toUpperCase(),
      channelId: structured[3],
      domain: structured[4],
    }
  }

  const accountMatch = name.match(/(?:^|-)(A\d+)(?:-|$)/i)
  const accountSlot = accountMatch?.[1] || ''
  const channelMatch = name.match(/(?:^|-)(\d{4,})(?:-|$)/)
  const channelId = channelMatch?.[1] || ''
  let domain = ''
  if (channelId) {
    const idx = name.lastIndexOf(`-${channelId}-`)
    if (idx >= 0) domain = name.slice(idx + channelId.length + 2)
  }
  if (!domain) {
    const parts = name.split('-')
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const candidate = parts.slice(i).join('-')
      if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(candidate)) {
        domain = candidate
        break
      }
    }
  }
  return {
    accountSlot,
    countryCode: '',
    channelId,
    domain,
  }
}

export function buildOfferPlacementUnit(input: {
  offerId: string
  offerName: string
  beforeUrl?: string | null
  afterUrl?: string | null
  beforeRef?: string | null
  plannedSeedRef?: string | null
  afterRef?: string | null
  categoryName?: string | null
  channelId?: string | null
}): OfferPlacementUnit {
  const offerName = clean(input.offerName)
  const link = clean(input.afterUrl) || clean(input.beforeUrl)
  const parsed = parseOfferNameParts(offerName)
  const domain = hostFromUrl(link) || parsed.domain
  const channelId =
    clean(input.channelId) || channelFromUrl(link) || channelFromUrl(input.beforeUrl) || parsed.channelId
  const accountSlot = parsed.accountSlot
  const accountLabel = accountSlot && domain ? `${accountSlot}@${domain}` : accountSlot || domain || offerName
  const beforeRef = clean(input.beforeRef)
  const plannedSeedRef = clean(input.plannedSeedRef)
  const afterRef = clean(input.afterRef)
  return {
    offerId: clean(input.offerId),
    offerName,
    accountSlot,
    accountLabel,
    channelId,
    countryCode: parsed.countryCode,
    domain,
    link,
    articleId: articleIdFromUrl(link) || articleIdFromUrl(input.beforeUrl),
    categoryName: clean(input.categoryName) || '—',
    beforeRef,
    plannedSeedRef,
    afterRef,
    currentRef: afterRef || beforeRef,
  }
}
