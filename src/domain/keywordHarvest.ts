import {
  articleDayStatsFromDaily,
  type ArticleDayStat,
  type KeywordRow,
  type Subid2DailyStatDay,
} from './report'
import { categoryPathLabel } from './articleCategories'
import type { CategoryOption } from '../api/article'
import type { SeedLexiconFile } from './offerSeedLexicon'
import { mergeSeedsIntoLexicon } from './offerSeedLexicon'

export type HarvestKeywordRow = {
  keyword: string
  termClicks: number
  adClicks: number
  /** 广告点击 / 词点击 */
  adRate: number
  articleCount: number
  articleIds: string[]
  /** 按贡献量加权投出的文章品类 */
  categoryId: number | null
  categoryKey: string | null
  days: string[]
  score: number
}

export type HarvestKeywordOptions = {
  /** 词点击下限，默认 20 */
  minTermClicks?: number
  /** 广告点击下限，默认 1（好词至少要有广告） */
  minAdClicks?: number
  /** 二跳率下限（ad/term），默认 0.05 */
  minAdRate?: number
  limit?: number
}

function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 综合分：广告量为主，兼顾词点与二跳率 */
export function scoreHarvestKeyword(input: {
  termClicks: number
  adClicks: number
  adRate: number
}): number {
  const term = Math.max(0, Number(input.termClicks) || 0)
  const ad = Math.max(0, Number(input.adClicks) || 0)
  const rate = Math.max(0, Number(input.adRate) || 0)
  return ad * 10 + term * 0.2 + rate * 100
}

/**
 * 把日报文章行里的 keywords[] 聚合成跨文章/跨日的词榜。
 * 保留 articleIds，便于再查 article/detail.articleCategoryId。
 */
export function aggregateHarvestKeywords(
  stats: ArticleDayStat[],
  options?: HarvestKeywordOptions,
): HarvestKeywordRow[] {
  const minTerm = options?.minTermClicks ?? 20
  const minAd = options?.minAdClicks ?? 1
  const minRate = options?.minAdRate ?? 0.05
  const limit = options?.limit ?? 100

  const map = new Map<
    string,
    {
      keyword: string
      termClicks: number
      adClicks: number
      articles: Set<string>
      /** articleId → 该词在该文的 term+ad 贡献 */
      articleWeight: Map<string, number>
      days: Set<string>
    }
  >()

  for (const row of stats) {
    for (const kw of row.keywords || []) {
      const keyword = String(kw.keyword || '').trim()
      if (!keyword) continue
      const key = keyword.toLowerCase()
      const cur = map.get(key) || {
        keyword,
        termClicks: 0,
        adClicks: 0,
        articles: new Set<string>(),
        articleWeight: new Map<string, number>(),
        days: new Set<string>(),
      }
      const term = num(kw.termClicks)
      const ad = num(kw.adClicks)
      cur.termClicks += term
      cur.adClicks += ad
      if (row.articleId) {
        cur.articles.add(row.articleId)
        cur.articleWeight.set(
          row.articleId,
          (cur.articleWeight.get(row.articleId) || 0) + term + ad * 3,
        )
      }
      if (row.day) cur.days.add(row.day)
      map.set(key, cur)
    }
  }

  const rows: HarvestKeywordRow[] = []
  for (const cur of map.values()) {
    const adRate = cur.termClicks > 0 ? cur.adClicks / cur.termClicks : 0
    if (cur.termClicks < minTerm) continue
    if (cur.adClicks < minAd) continue
    if (adRate < minRate) continue
    const articleIds = [...cur.articles].sort(
      (a, b) => (cur.articleWeight.get(b) || 0) - (cur.articleWeight.get(a) || 0),
    )
    rows.push({
      keyword: cur.keyword,
      termClicks: cur.termClicks,
      adClicks: cur.adClicks,
      adRate,
      articleCount: cur.articles.size,
      articleIds,
      categoryId: null,
      categoryKey: null,
      days: [...cur.days].sort(),
      score: scoreHarvestKeyword({
        termClicks: cur.termClicks,
        adClicks: cur.adClicks,
        adRate,
      }),
    })
  }

  return rows
    .sort((a, b) => b.score - a.score || b.adClicks - a.adClicks || a.keyword.localeCompare(b.keyword))
    .slice(0, limit)
}

export function harvestKeywordsFromDaily(
  data: Subid2DailyStatDay[],
  options?: HarvestKeywordOptions,
): HarvestKeywordRow[] {
  return aggregateHarvestKeywords(articleDayStatsFromDaily(data), options)
}

/** 按文章贡献加权，投出主品类 id */
export function voteCategoryId(
  articleIds: string[],
  articleCategoryById: Record<string, number | null | undefined>,
  articleWeight?: Map<string, number> | Record<string, number>,
): number | null {
  const weightOf = (id: string) => {
    if (!articleWeight) return 1
    if (articleWeight instanceof Map) return articleWeight.get(id) || 1
    return Number(articleWeight[id] || 1)
  }
  const votes = new Map<number, number>()
  for (const id of articleIds) {
    const cat = Number(articleCategoryById[id])
    if (!Number.isFinite(cat) || cat <= 0) continue
    votes.set(cat, (votes.get(cat) || 0) + weightOf(id))
  }
  let best: number | null = null
  let bestW = -1
  for (const [cat, w] of votes) {
    if (w > bestW) {
      best = cat
      bestW = w
    }
  }
  return best
}

export function enrichHarvestWithCategories(
  rows: HarvestKeywordRow[],
  articleCategoryById: Record<string, number | null | undefined>,
  categories: CategoryOption[],
): HarvestKeywordRow[] {
  return rows.map((row) => {
    const weights = new Map(row.articleIds.map((id, index) => [id, row.articleIds.length - index]))
    const categoryId = voteCategoryId(row.articleIds, articleCategoryById, weights)
    const categoryKey = categoryId
      ? categoryPathLabel(categories, categoryId)
      : null
    return {
      ...row,
      categoryId,
      categoryKey: categoryKey && categoryKey !== '—' ? categoryKey : null,
    }
  })
}

/** 供词库写入：默认 US */
export function harvestRowsToSeeds(
  rows: HarvestKeywordRow[],
  regionId = 'US',
): Array<{ keyword: string; intentKeyword: string; ref: string; regionId: string }> {
  return rows.map((row) => ({
    keyword: row.keyword,
    intentKeyword: row.keyword,
    ref: row.keyword,
    regionId,
  }))
}

/** 按 categoryId 分组写入词库（同 id 合并；无类目的跳过） */
export function mergeHarvestIntoLexiconByCategory(
  lexicon: SeedLexiconFile,
  rows: HarvestKeywordRow[],
  regionId = 'US',
): SeedLexiconFile {
  const byCat = new Map<number, { categoryKey: string; seeds: HarvestKeywordRow[] }>()
  for (const row of rows) {
    if (row.categoryId == null || row.categoryId <= 0) continue
    const key = row.categoryKey || `类目 ${row.categoryId}`
    const cur = byCat.get(row.categoryId) || { categoryKey: key, seeds: [] }
    if (!cur.categoryKey || cur.categoryKey.startsWith('类目 ')) {
      cur.categoryKey = key
    }
    cur.seeds.push(row)
    byCat.set(row.categoryId, cur)
  }
  let next = lexicon
  for (const [categoryId, group] of byCat) {
    next = mergeSeedsIntoLexicon(
      next,
      group.categoryKey,
      harvestRowsToSeeds(group.seeds, regionId),
      categoryId,
    )
  }
  return next
}

export function topKeywordsPreview(rows: KeywordRow[], limit = 20): KeywordRow[] {
  return [...rows]
    .filter((r) => String(r.keyword || '').trim())
    .sort((a, b) => b.adClicks - a.adClicks || b.termClicks - a.termClicks)
    .slice(0, limit)
}
