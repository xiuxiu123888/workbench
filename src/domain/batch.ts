import { isPureArticleId } from './campaignForm'

export interface ArticleRefGroup {
  articleId: string
  channelId: string
  linkRef: string
}

export function collectArticleGroups(
  groups: ArticleRefGroup[],
): { ok: true; groups: ArticleRefGroup[] } | { ok: false; message: string } {
  const filled = groups
    .map((group) => ({
      articleId: group.articleId.trim(),
      channelId: group.channelId.trim(),
      linkRef: group.linkRef,
    }))
    .filter((group) => group.articleId || group.channelId || group.linkRef.trim())

  if (filled.length === 0) {
    return { ok: false, message: '请至少添加一组文章 ID' }
  }

  const seen = new Set<string>()
  for (const group of filled) {
    if (!group.articleId) {
      return { ok: false, message: '每一组都要填写文章 ID' }
    }
    if (!group.linkRef.trim()) {
      return { ok: false, message: '每一组都要填写 ref' }
    }
    if (!isPureArticleId(group.articleId)) {
      return { ok: false, message: `文章 ID ${group.articleId} 不是纯数字` }
    }
    if (group.channelId && !isPureArticleId(group.channelId)) {
      return { ok: false, message: `渠道 ID ${group.channelId} 不是纯数字` }
    }
    if (seen.has(group.articleId)) {
      return { ok: false, message: `文章 ID ${group.articleId} 重复了` }
    }
    seen.add(group.articleId)
  }

  return { ok: true, groups: filled }
}

export function collectDirectGroups(
  groups: ArticleRefGroup[],
): { ok: true; groups: ArticleRefGroup[] } | { ok: false; message: string } {
  const result = collectArticleGroups(groups)
  if (!result.ok) {
    return result
  }
  for (const group of result.groups) {
    if (!group.channelId) {
      return { ok: false, message: '每一组都要填写渠道 ID' }
    }
  }
  return result
}

export function parseArticleIds(raw: string): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const part of raw.split(/[\s,，]+/)) {
    const id = part.trim()
    if (!isPureArticleId(id) || seen.has(id)) {
      continue
    }
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function articleDomain(site: { siteUrl?: string; siteName?: string } | null | undefined): string {
  return String(site?.siteUrl || site?.siteName || '').trim()
}

export function buildArticleUpdate(
  detail: Record<string, unknown>,
  accountId: number | string,
  siteId: number | string,
): Record<string, unknown> {
  const category = detail.articleCategoryId
  const articleCategoryId = Array.isArray(category) ? category[category.length - 1] : category
  let image = detail.image
  if (typeof detail.text === 'string') {
    const match = detail.text.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (match?.[1]) {
      image = match[1]
    }
  }

  return {
    id: detail.id,
    articleCategoryId,
    outShow: detail.outShow,
    langId: detail.langId,
    siteId,
    accountId,
    countryCode: detail.countryCode ?? null,
    title: detail.title ?? '',
    metaTitle: detail.metaTitle ?? '',
    metaDescription: detail.metaDescription ?? '',
    terms: detail.terms ?? '',
    text: detail.text ?? '',
    firstP: detail.firstP ?? '',
    image,
  }
}
