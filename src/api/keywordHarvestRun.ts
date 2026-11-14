import { getArticleDetail, getCategoryList } from './article'
import { listSubid2DailyStat } from './report'
import {
  listKeywordHarvestSourceArticles,
  writeOpsCenterFile,
  type KeywordHarvestReport,
} from './opsCenterLocal'
import {
  enrichHarvestWithCategories,
  harvestKeywordsFromDaily,
  type HarvestKeywordRow,
} from '../domain/keywordHarvest'
import { shanghaiDay } from '../domain/opsCenterTime'
import type { Subid2DailyStatDay } from '../domain/report'

export type HarvestProgress = (message: string) => void

async function fetchStatsInChunks(
  articleIds: string[],
  day: string,
  onProgress?: HarvestProgress,
): Promise<{ days: Subid2DailyStatDay[]; failedChunks: number }> {
  const days: Subid2DailyStatDay[] = []
  let failedChunks = 0
  const chunks: string[][] = []
  for (let i = 0; i < articleIds.length; i += 40) {
    chunks.push(articleIds.slice(i, i + 40))
  }
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]
    onProgress?.(`拉取关键词 ${i + 1}/${chunks.length}（${chunk.length} 篇）`)
    try {
      days.push(
        ...(await listSubid2DailyStat({
          subid2List: chunk,
          startDate: day,
          endDate: day,
          keywordLimit: 30,
        })),
      )
    } catch {
      failedChunks += 1
      for (const id of chunk) {
        try {
          days.push(
            ...(await listSubid2DailyStat({
              subid2List: [id],
              startDate: day,
              endDate: day,
              keywordLimit: 30,
            })),
          )
        } catch {
          // skip
        }
      }
    }
  }
  return { days, failedChunks }
}

async function resolveCategories(
  articleIds: string[],
  onProgress?: HarvestProgress,
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {}
  for (let i = 0; i < articleIds.length; i += 1) {
    const id = articleIds[i]
    if (i % 20 === 0) {
      onProgress?.(`解析文章品类 ${i + 1}/${articleIds.length}`)
    }
    try {
      const detail = await getArticleDetail(id)
      const cat = Number(detail.articleCategoryId)
      out[id] = Number.isFinite(cat) && cat > 0 ? cat : null
    } catch {
      out[id] = null
    }
  }
  return out
}

/** 页面按钮调用：拉指定日（默认今天）关键词并落盘，供种子词日报展示 */
export async function runKeywordHarvestFromUi(input?: {
  day?: string
  onProgress?: HarvestProgress
}): Promise<KeywordHarvestReport> {
  const day = String(input?.day || shanghaiDay()).trim()
  const onProgress = input?.onProgress
  const today = shanghaiDay()
  const isLiveToday = day === today

  onProgress?.('收集白名单文章…')
  const source = await listKeywordHarvestSourceArticles(day)
  if (!source.articleIds.length) {
    throw new Error('白名单下没有可用文章 id，请先同步漏斗指标')
  }

  const goodOpts = isLiveToday
    ? { minTermClicks: 10, minAdClicks: 1, minAdRate: 0.05, limit: 100 }
    : { minTermClicks: 30, minAdClicks: 3, minAdRate: 0.08, limit: 80 }
  const watchOpts = isLiveToday
    ? { minTermClicks: 20, minAdClicks: 1, minAdRate: 0.02, limit: 150 }
    : { minTermClicks: 50, minAdClicks: 1, minAdRate: 0.03, limit: 120 }

  const { days, failedChunks } = await fetchStatsInChunks(source.articleIds, day, onProgress)
  let good = harvestKeywordsFromDaily(days, goodOpts)
  let watch = harvestKeywordsFromDaily(days, watchOpts)

  const needIds = new Set<string>()
  for (const row of [...good, ...watch]) {
    for (const id of row.articleIds) needIds.add(id)
  }
  const articleCategoryById = await resolveCategories([...needIds], onProgress)
  onProgress?.('加载类目树…')
  const categories = await getCategoryList()
  good = enrichHarvestWithCategories(good, articleCategoryById, categories)
  watch = enrichHarvestWithCategories(watch, articleCategoryById, categories)

  const categorized = (rows: HarvestKeywordRow[]) =>
    rows.filter((r) => r.categoryId != null && r.categoryId > 0).length

  const report: KeywordHarvestReport = {
    day,
    articleCount: source.articleIds.length,
    failedChunks,
    goodCount: good.length,
    watchCount: watch.length,
    goodWithCategory: categorized(good),
    watchWithCategory: categorized(watch),
    good,
    watch,
  }

  onProgress?.('写入日报…')
  await writeOpsCenterFile(`keyword-harvest/${day}.json`, {
    ...report,
    pulledAt: new Date().toISOString(),
    isLiveToday,
    metricsDayUsedForArticleIds: source.metricsDay,
    thresholds: { good: goodOpts, watch: watchOpts },
  })

  const indexDays = new Set([...(source.existingDays || []), day])
  await writeOpsCenterFile('keyword-harvest/index.json', {
    updatedAt: new Date().toISOString(),
    days: [...indexDays].sort((a, b) => b.localeCompare(a)),
  })

  return report
}
