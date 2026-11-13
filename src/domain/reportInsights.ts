export interface InsightArticleDay {
  day: string
  articleId: string
  channelId: string
  pageViews: number
  termClicks: number
  adClicks: number
  countryCode: string
  /** 已从当前推荐列表换下 */
  kept: boolean
}

export interface GrowingArticleRow {
  articleId: string
  channelId: string
  countryCode: string
  pageViews: number
  adClicks: number
  pageViewsDelta: number
  adClicksDelta: number
}

export interface ReplaceCandidateRow {
  articleId: string
  channelId: string
  countryCode: string
  pageViews: number
  adClicks: number
  reason: string
}

export interface CountryContributionRow {
  countryCode: string
  pageViews: number
  termClicks: number
  adClicks: number
  articleCount: number
}

export interface ArticleContributionRow {
  articleId: string
  channelId: string
  countryCode: string
  pageViews: number
  termClicks: number
  adClicks: number
  adShare: number | null
  viewShare: number | null
}

function asCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

/** days 按日期倒序（新→旧），与日报一致 */
export function growingArticles(days: InsightArticleDay[][], limit = 5): GrowingArticleRow[] {
  if (days.length < 2) {
    return []
  }
  const newest = days[0]
  const older = days[1]
  const olderMap = new Map(older.map((item) => [item.articleId, item]))
  const rows: GrowingArticleRow[] = []
  for (const item of newest) {
    if (!item.articleId || item.kept) {
      continue
    }
    const prev = olderMap.get(item.articleId)
    const prevViews = prev ? asCount(prev.pageViews) : 0
    const prevAds = prev ? asCount(prev.adClicks) : 0
    const pageViews = asCount(item.pageViews)
    const adClicks = asCount(item.adClicks)
    const pageViewsDelta = pageViews - prevViews
    const adClicksDelta = adClicks - prevAds
    if (pageViewsDelta <= 0 && adClicksDelta <= 0) {
      continue
    }
    rows.push({
      articleId: item.articleId,
      channelId: item.channelId,
      countryCode: item.countryCode,
      pageViews,
      adClicks,
      pageViewsDelta,
      adClicksDelta,
    })
  }
  return rows
    .sort((a, b) => b.adClicksDelta - a.adClicksDelta || b.pageViewsDelta - a.pageViewsDelta || b.adClicks - a.adClicks)
    .slice(0, limit)
}

/**
 * 仍在推荐列表（kept=false）且满足：
 * - 最近两个自然日曝光都为 0；或
 * - 最近一天广告点击为 0，且曝光低于同站当天中位数
 */
export function replaceCandidates(days: InsightArticleDay[][]): ReplaceCandidateRow[] {
  if (days.length === 0) {
    return []
  }
  const newest = days[0]
  const active = newest.filter((item) => item.articleId && !item.kept)
  if (active.length === 0) {
    return []
  }
  const medianViews = median(active.map((item) => asCount(item.pageViews)))
  const older = days[1]
  const olderMap = older ? new Map(older.map((item) => [item.articleId, item])) : null
  const rows: ReplaceCandidateRow[] = []

  for (const item of active) {
    const pageViews = asCount(item.pageViews)
    const adClicks = asCount(item.adClicks)
    const reasons: string[] = []

    if (olderMap) {
      const prev = olderMap.get(item.articleId)
      const prevViews = prev ? asCount(prev.pageViews) : 0
      if (pageViews === 0 && prevViews === 0) {
        reasons.push('近两日曝光均为 0')
      }
    } else if (pageViews === 0) {
      reasons.push('当日曝光为 0')
    }

    if (adClicks === 0 && pageViews <= medianViews) {
      reasons.push('广点为 0 且曝光不高于同日中位数')
    }

    if (reasons.length === 0) {
      continue
    }
    rows.push({
      articleId: item.articleId,
      channelId: item.channelId,
      countryCode: item.countryCode,
      pageViews,
      adClicks,
      reason: reasons.join('；'),
    })
  }

  return rows.sort((a, b) => a.pageViews - b.pageViews || a.adClicks - b.adClicks || a.articleId.localeCompare(b.articleId))
}

export function countryContributions(articles: InsightArticleDay[]): CountryContributionRow[] {
  const map = new Map<string, CountryContributionRow>()
  for (const item of articles) {
    if (!item.articleId || item.kept) {
      continue
    }
    const key = item.countryCode.trim() || '未标注'
    const current = map.get(key) || {
      countryCode: key,
      pageViews: 0,
      termClicks: 0,
      adClicks: 0,
      articleCount: 0,
    }
    current.pageViews += asCount(item.pageViews)
    current.termClicks += asCount(item.termClicks)
    current.adClicks += asCount(item.adClicks)
    current.articleCount += 1
    map.set(key, current)
  }
  return [...map.values()].sort((a, b) => b.adClicks - a.adClicks || b.pageViews - a.pageViews || a.countryCode.localeCompare(b.countryCode))
}

export function articleClickContributions(articles: InsightArticleDay[], limit = 8): ArticleContributionRow[] {
  const active = articles.filter((item) => item.articleId && !item.kept)
  const totalAds = active.reduce((sum, item) => sum + asCount(item.adClicks), 0)
  const totalViews = active.reduce((sum, item) => sum + asCount(item.pageViews), 0)
  return active
    .map((item) => {
      const pageViews = asCount(item.pageViews)
      const termClicks = asCount(item.termClicks)
      const adClicks = asCount(item.adClicks)
      return {
        articleId: item.articleId,
        channelId: item.channelId,
        countryCode: item.countryCode,
        pageViews,
        termClicks,
        adClicks,
        adShare: totalAds > 0 ? adClicks / totalAds : null,
        viewShare: totalViews > 0 ? pageViews / totalViews : null,
      }
    })
    .sort((a, b) => b.adClicks - a.adClicks || b.pageViews - a.pageViews || a.articleId.localeCompare(b.articleId))
    .slice(0, limit)
}
