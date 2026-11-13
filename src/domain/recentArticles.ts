export interface RecentArticleRow {
  url: string
  channel: string
}

export interface RecentArticleItem {
  url: string
  countryCode: string
}

export function recentArticleItems(raw: unknown): RecentArticleItem[] {
  const list = recentArticleList(raw)
  const items: RecentArticleItem[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      const url = item.trim()
      if (url) {
        items.push({ url, countryCode: '' })
      }
      continue
    }
    if (!item || typeof item !== 'object' || !('url' in item)) {
      continue
    }
    const url = (item as { url?: unknown }).url
    if (typeof url !== 'string' || !url.trim()) {
      continue
    }
    const code = (item as { countryCode?: unknown }).countryCode
    items.push({
      url: url.trim(),
      countryCode: typeof code === 'string' ? code.trim() : '',
    })
  }
  return items
}

function recentArticleList(raw: unknown): unknown[] {
  if (raw == null) {
    return []
  }
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) {
      return []
    }
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      /* 单条链接 */
    }
    return [text]
  }
  return Array.isArray(raw) ? raw : []
}

export function normalizeRecentArticles(raw: unknown): string[] {
  return recentArticleItems(raw).map((item) => item.url)
}

export function countRecentArticles(row: { recentArticles?: unknown }): number | null {
  if (!Object.prototype.hasOwnProperty.call(row, 'recentArticles')) {
    return null
  }
  return normalizeRecentArticles(row.recentArticles).length
}

export type ApplyUrlResult =
  | { ok: true; urls: string[]; highlightIndex: number }
  | { ok: false; reason: string }

export function replaceRecentArticle(current: string[], index: number, previous: string, next: string) {
  if (index < 0 || index >= current.length || current[index] !== previous) {
    return { ok: false as const, reason: '列表已变化，请重新选择' }
  }
  const urls = current.slice()
  urls[index] = next
  return { ok: true as const, urls, highlightIndexes: [index] }
}

export function removeRecentArticle(current: string[], index: number, previous: string) {
  if (index < 0 || index >= current.length || current[index] !== previous) {
    return { ok: false as const, reason: '列表已变化，请重新选择' }
  }
  return {
    ok: true as const,
    urls: current.filter((_, itemIndex) => itemIndex !== index),
    highlightIndexes: [] as number[],
  }
}

export function appendGeneratedUrls(current: string[], next: string[]) {
  if (next.length === 0) {
    return { ok: false as const, reason: '没有可写入的链接' }
  }
  const start = current.length
  return {
    ok: true as const,
    urls: [...current, ...next],
    highlightIndexes: next.map((_, index) => start + index),
  }
}

export function applyGeneratedUrl(
  urls: string[],
  mode: 'append' | 'replace',
  index: number | null,
  nextUrl: string,
): ApplyUrlResult {
  if (mode === 'append') {
    return { ok: true, urls: [...urls, nextUrl], highlightIndex: urls.length }
  }

  if (index == null || index < 0 || index >= urls.length) {
    return { ok: false, reason: '列表已变化，请重新选择' }
  }

  const next = urls.slice()
  next[index] = nextUrl
  return { ok: true, urls: next, highlightIndex: index }
}

function toCategoryId(value: unknown): number | null {
  if (Array.isArray(value)) {
    return value.length ? toCategoryId(value[value.length - 1]) : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

export function normalizeRefList(raw: unknown): Array<{ tagId: unknown; categoryIds: number[] }> {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.map((item) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const infoList = record.categoryInfoList
    let categoryIds: number[] = []

    if (Array.isArray(infoList) && infoList.length > 0) {
      categoryIds = infoList
        .map((info) => toCategoryId(info && typeof info === 'object' ? (info as { categoryId?: unknown }).categoryId : null))
        .filter((id): id is number => id != null)
    } else if (Array.isArray(record.categoryIds)) {
      categoryIds = record.categoryIds
        .map((id) => toCategoryId(id))
        .filter((id): id is number => id != null)
    }

    return {
      tagId: record.tagId ?? null,
      categoryIds,
    }
  })
}

export function normalizeAdsType(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value)
  }
  return value
}

export function buildUpdatePayload(
  detail: Record<string, unknown>,
  recentArticles: string[],
): Record<string, unknown> {
  return {
    ...detail,
    recentArticles,
    refList: normalizeRefList(detail.refList),
    adsType: normalizeAdsType(detail.adsType),
  }
}
