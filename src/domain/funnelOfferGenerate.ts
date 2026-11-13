import type { CategoryOption, LanguageOption, SiteOption } from '../api/article'
import { ARTICLE_REGIONS } from './articleRegions'
import { articleDomain } from './batch'
import { bareDomain } from './articleJobStore'
import { articleIdFromUrl } from './report'

export function regionFromCountry(code: string | null | undefined): string {
  const upper = String(code || '')
    .trim()
    .toUpperCase()
  if (!upper) {
    return ''
  }
  if (upper === 'VN') {
    return 'VI'
  }
  if (ARTICLE_REGIONS.some((item) => item.code === upper)) {
    return upper
  }
  return ''
}

export function hostFromLandingUrl(url: string | null | undefined): string {
  const text = String(url || '').trim()
  if (!text) {
    return ''
  }
  return bareDomain(text)
}

export function matchCategoryIdByName(
  categories: CategoryOption[],
  name: string | null | undefined,
): number | null {
  const want = String(name || '')
    .trim()
    .toLowerCase()
  if (!want) {
    return null
  }
  const exact = categories.find((item) => {
    const label = String(item.name || '')
      .trim()
      .toLowerCase()
    const alias = String(item.alias || '')
      .trim()
      .toLowerCase()
    return label === want || alias === want
  })
  if (exact != null && Number(exact.id) > 0) {
    return Number(exact.id)
  }
  const partial = categories.find((item) => {
    const label = String(item.name || '')
      .trim()
      .toLowerCase()
    const alias = String(item.alias || '')
      .trim()
      .toLowerCase()
    return (
      (label && (label.includes(want) || want.includes(label))) ||
      (alias && (alias.includes(want) || want.includes(alias)))
    )
  })
  if (partial != null && Number(partial.id) > 0) {
    return Number(partial.id)
  }
  return null
}

export interface ResolvedOfferSiteTarget {
  domain: string
  siteId: number | string
  accountId: number | string
  articleId: string
}

export function resolveOfferSiteTarget(
  sites: SiteOption[],
  landingUrl: string | null | undefined,
): ResolvedOfferSiteTarget | null {
  const url = String(landingUrl || '').trim()
  if (!url) {
    return null
  }
  const host = hostFromLandingUrl(url)
  if (!host) {
    return null
  }
  const matched = sites.find((site) => {
    const domain = bareDomain(articleDomain(site) || site.siteName || '')
    if (!domain) {
      return false
    }
    return domain === host || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`)
  })
  if (!matched || matched.accountId == null || matched.accountId === '') {
    return null
  }
  const domain = bareDomain(articleDomain(matched) || matched.siteName || host) || host
  return {
    domain,
    siteId: matched.id,
    accountId: matched.accountId,
    articleId: articleIdFromUrl(url),
  }
}

export function defaultSeedKeyword(input: {
  categoryName?: string | null
  offerName?: string | null
}): string {
  const category = String(input.categoryName || '').trim()
  if (category) {
    return category
  }
  return String(input.offerName || '').trim()
}

export function resolveLanguageId(
  languages: LanguageOption[],
  detailLangId: unknown,
): number | null {
  const fromDetail = Number(detailLangId)
  if (Number.isFinite(fromDetail) && fromDetail > 0) {
    return fromDetail
  }
  const english = languages.find((item) => String(item.langCode || '').toLowerCase() === 'en')
  if (english != null && Number(english.id) > 0) {
    return Number(english.id)
  }
  const first = languages[0]
  if (first != null && Number(first.id) > 0) {
    return Number(first.id)
  }
  return null
}

export function pickOfferJobResult(
  results: Array<{ status?: string; id?: string | number; domain?: string; article_id?: string | number }> | undefined,
  domain: string,
): { id: string | number; articleId?: string } | null {
  const want = bareDomain(domain)
  for (const item of results || []) {
    if (String(item.status || '').toLowerCase() !== 'success') {
      continue
    }
    if (item.id == null || String(item.id).trim() === '') {
      continue
    }
    if (want && item.domain && bareDomain(item.domain) && bareDomain(item.domain) !== want) {
      continue
    }
    const articleId =
      item.article_id == null || String(item.article_id).trim() === ''
        ? undefined
        : String(item.article_id).trim()
    return { id: item.id, articleId }
  }
  return null
}

/** URLSearchParams / URL#toString 会把 {hit} 编成 %7Bhit%7D；落地宏需保持字面量 */
export function preserveHitPlaceholder(url: string): string {
  return String(url || '').replace(/([?&])hit=%7Bhit%7D/gi, '$1hit={hit}')
}

/** 在旧 offer 落地链上替换文章 ID，写入 subid1/subid2，并把 ref 改成种子词（用于 resultUrl） */
export function buildOfferLandingUrl(
  oldLandingUrl: string | null | undefined,
  channelId: string | null | undefined,
  newArticleId: string | null | undefined,
  seedKeyword?: string | null,
): string | null {
  const oldUrl = String(oldLandingUrl || '').trim()
  const articleId = String(newArticleId || '').trim()
  const channel = String(channelId || '').trim()
  const ref = String(seedKeyword || '').trim()
  if (!oldUrl || !articleId || !channel) {
    return null
  }
  try {
    const u = new URL(oldUrl)
    if (/\/detail\/\d+/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/detail\/\d+/, `/detail/${articleId}`)
    } else {
      u.pathname = `/detail/${articleId}`
    }
    u.searchParams.set('subid1', channel)
    u.searchParams.set('subid2', articleId)
    if (ref) {
      u.searchParams.set('ref', ref)
    }
    return preserveHitPlaceholder(u.toString())
  } catch {
    return null
  }
}

/**
 * 只改原 url 里的文章 id 与 ref，其它参数原样保留（不写 subid，不重编码 hit={hit}）。
 * 用于 landpulse offer.url 字段。
 */
export function rewriteOfferUrlArticleAndRef(
  oldUrl: string | null | undefined,
  newArticleId: string | null | undefined,
  seedKeyword?: string | null,
): string | null {
  const source = String(oldUrl || '').trim()
  const articleId = String(newArticleId || '').trim()
  const ref = String(seedKeyword || '').trim()
  if (!source || !articleId) {
    return null
  }

  let next = source
  if (/\/detail\/\d+/.test(next)) {
    next = next.replace(/\/detail\/\d+/, `/detail/${articleId}`)
  } else {
    try {
      const u = new URL(next)
      u.pathname = `/detail/${articleId}`
      next = u.toString()
    } catch {
      return null
    }
  }

  if (!ref) {
    return next
  }

  const encodedRef = encodeURIComponent(ref).replace(/%20/g, '+')
  if (/([?&])ref=/.test(next)) {
    return next.replace(/([?&])ref=[^&]*/, `$1ref=${encodedRef}`)
  }
  return `${next}${next.includes('?') ? '&' : '?'}ref=${encodedRef}`
}
