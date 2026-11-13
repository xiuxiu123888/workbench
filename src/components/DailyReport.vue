<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { lookupConfigArticles, lookupReportCache, saveConfigArticles, saveReportCache } from '../api/reportCache'
import { listChannelRevenue, listSubid2DailyStat } from '../api/report'
import { errorMessage } from '../api/http'
import {
  articleDayStatMap,
  articleLinks,
  linksForReportDay,
  eachDay,
  compareDailyRevenue,
  compareMetric,
  formatClickRate,
  formatMoney,
  AFS_REVENUE_CACHE_INVESTOR,
  revenueByDay,
  revenueCountriesOnDay,
  type ArticleLink,
  type KeywordRow,
} from '../domain/report'
import {
  articleClickContributions,
  countryContributions,
  growingArticles,
  replaceCandidates,
  type InsightArticleDay,
} from '../domain/reportInsights'
import ReportInsightCharts from './ReportInsightCharts.vue'
import {
  articleCacheKey,
  channelCacheKey,
  contiguousSpans,
  planReportFetch,
  type ArticleDaySnapshot,
  type ChannelDaySnapshot,
  type ConfigArticleRecord,
  type FetchSpan,
} from '../domain/reportCache'
const props = defineProps<{
  configId: number | string | null
  siteLabel: string
  urls: string[]
  countryCodes: Record<string, string>
  accountSource: string
  accountName: string
}>()

const range = ref<[Date, Date] | null>(defaultRange())
const loading = ref(false)
const refreshingDay = ref('')
const progress = ref('')
const cacheNote = ref('')
const days = ref<DayReport[]>([])
const queryConfigKey = ref('')
const savedReports = new Map<string, SavedReport>()

function revenueCacheInvestor(): string {
  return AFS_REVENUE_CACHE_INVESTOR
}

interface ArticleReport {
  articleId: string
  channelId: string
  pageViews: number
  termClicks: number
  adClicks: number
  keywordCount: number
  keywords: KeywordRow[]
  countryCode: string
  kept: boolean
}

interface ChannelCountryRevenue {
  countryCode: string
  revenue: number
}

interface ChannelReport {
  channelId: string
  revenue: number | null
  countries: ChannelCountryRevenue[]
}

interface DayReport {
  day: string
  channels: ChannelReport[]
  articles: ArticleReport[]
}

interface SavedReport {
  days: DayReport[]
  cacheNote: string
  investor: string
  start: string
  end: string
}

function configKey(id: number | string | null | undefined): string {
  return id == null || id === '' ? '' : String(id)
}

function viewing(key: string): boolean {
  return configKey(props.configId) === key
}

function showSavedReport(key: string) {
  const found = key ? savedReports.get(key) : undefined
  progress.value = ''
  if (!found) {
    days.value = []
    cacheNote.value = ''
    return
  }
  days.value = found.days
  cacheNote.value = found.cacheNote
  range.value = [new Date(`${found.start}T00:00:00`), new Date(`${found.end}T00:00:00`)]
}

const currentConfigKey = computed(() => configKey(props.configId))
const loadingCurrent = computed(() => loading.value && queryConfigKey.value === currentConfigKey.value)
function sumCount(values: number[]): number {
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
}

const daySummaries = computed(() =>
  days.value.map((day, index) => {
    const older = days.value[index + 1]
    const views = sumCount(day.articles.map((item) => item.pageViews))
    const terms = sumCount(day.articles.map((item) => item.termClicks))
    const ads = sumCount(day.articles.map((item) => item.adClicks))
    const olderViews = older ? sumCount(older.articles.map((item) => item.pageViews)) : null
    const olderTerms = older ? sumCount(older.articles.map((item) => item.termClicks)) : null
    const olderAds = older ? sumCount(older.articles.map((item) => item.adClicks)) : null
    return {
      revenue: compareDailyRevenue(
        day.channels.map((item) => item.revenue),
        older ? older.channels.map((item) => item.revenue) : null,
      ),
      pageViews: compareMetric(views, olderViews),
      termClicks: compareMetric(terms, olderTerms),
      adClicks: compareMetric(ads, olderAds),
      termRate: formatClickRate(terms, views),
      adRate: formatClickRate(ads, views),
    }
  }),
)

function changeLabel(delta: number | null, rate: number | null, digits = 2): string {
  if (delta == null) {
    return '—'
  }
  const amount = `${delta > 0 ? '+' : ''}${delta.toFixed(digits)}`
  if (rate == null) {
    return amount
  }
  return `${amount}（${rate > 0 ? '+' : ''}${(rate * 100).toFixed(2)}%）`
}

function changeClass(delta: number | null): string {
  if (delta == null || delta === 0) {
    return 'dash'
  }
  return delta > 0 ? 'change-up' : 'change-down'
}

const linkCount = computed(() => articleLinks(props.urls).length)
const channelCount = computed(() => new Set(articleLinks(props.urls).map((link) => link.channelId).filter(Boolean)).size)

/** 洞察只用完整自然日：去掉日历「今天」，避免未跑完日扭曲对比 */
const insightCompleteDays = computed(() => {
  const today = formatDay(new Date())
  return days.value.filter((day) => day.day < today)
})

const insightDays = computed(() =>
  insightCompleteDays.value.map((day) =>
    day.articles.map(
      (item): InsightArticleDay => ({
        day: day.day,
        articleId: item.articleId,
        channelId: item.channelId,
        pageViews: item.pageViews,
        termClicks: item.termClicks,
        adClicks: item.adClicks,
        countryCode: item.countryCode,
        kept: item.kept,
      }),
    ),
  ),
)

const insightScopeLabel = computed(() => {
  const complete = insightCompleteDays.value
  if (complete.length >= 2) {
    return `基于完整日 ${complete[0].day} vs ${complete[1].day}`
  }
  if (complete.length === 1) {
    return `基于完整日 ${complete[0].day}（仅一天，涨跌对比暂缺）`
  }
  return '暂无完整日数据（今天不参与洞察）'
})

const insightGrowing = computed(() => growingArticles(insightDays.value, 5))
const insightReplace = computed(() => replaceCandidates(insightDays.value))
const insightCountries = computed(() => countryContributions(insightDays.value[0] || []))
const insightContributions = computed(() => articleClickContributions(insightDays.value[0] || [], 8))
const hasInsights = computed(
  () =>
    insightCompleteDays.value.length > 0 &&
    (insightGrowing.value.length > 0 ||
      insightReplace.value.length > 0 ||
      insightCountries.value.length > 0 ||
      insightContributions.value.length > 0),
)

function defaultRange(): [Date, Date] {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - 6)
  return [start, end]
}

function formatDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function keywordLabel(keyword: string): string {
  return keyword || '（空关键词）'
}

/** 批量曝光失败时逐篇重试；配错/拉不到的文章不阻断，按 0 落库 */
async function loadArticleStatsMap(
  articleIds: string[],
  startDate: string,
  endDate: string,
): Promise<ReturnType<typeof articleDayStatMap>> {
  const ids = [...new Set(articleIds.map((id) => id.trim()).filter(Boolean))]
  const stats = articleDayStatMap([])
  if (ids.length === 0 || !startDate || !endDate) {
    return stats
  }
  try {
    return articleDayStatMap(
      await listSubid2DailyStat({
        subid2List: ids,
        startDate,
        endDate,
        keywordLimit: 20,
      }),
    )
  } catch {
    // 一批里常有配错文章拖垮整请求，改逐篇；单篇失败视为 0
  }
  for (const articleId of ids) {
    try {
      const part = articleDayStatMap(
        await listSubid2DailyStat({
          subid2List: [articleId],
          startDate,
          endDate,
          keywordLimit: 20,
        }),
      )
      for (const [key, value] of part.entries()) {
        stats.set(key, value)
      }
    } catch {
      // 拉不到 → 不写 map，后续 wholeCount 按 0
    }
  }
  return stats
}

function wholeCount(value: number | null | undefined): number {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number) || number < 0) {
    return 0
  }
  return Math.round(number)
}

async function load() {
  if (loading.value || refreshingDay.value) {
    return
  }
  const links = articleLinks(props.urls)
  if (!range.value || range.value.length !== 2) {
    ElMessage.error('请选择日期')
    return
  }
  const start = formatDay(range.value[0])
  const end = formatDay(range.value[1])
  const dayList = eachDay(start, end)
  if (dayList.length === 0) {
    ElMessage.error('结束日期要晚于开始日期')
    return
  }
  if (dayList.length > 31) {
    ElMessage.error('一次最多查 31 天')
    return
  }

  const today = formatDay(new Date())
  const source = props.accountSource.trim()
  const investorName = revenueCacheInvestor()
  if (!source) {
    ElMessage.error(props.siteLabel ? '当前配置没有可识别的文章账户（如 A3）' : '先在左侧选中一条运营配置')
    return
  }
  const queryKey = currentConfigKey.value
  let kept: ConfigArticleRecord[] = []
  if (queryKey) {
    try {
      kept = await lookupConfigArticles({ configId: queryKey, start, end })
    } catch (error) {
      ElMessage.error(errorMessage(error))
      return
    }
  }
  const linksByDay = new Map(dayList.map((day) => [day, linksForReportDay(day, today, links, kept)]))
  if (![...linksByDay.values()].some((dayLinks) => dayLinks.length > 0)) {
    ElMessage.error(props.siteLabel ? '当前配置没有带文章 ID 的推荐链接' : '先在左侧选中一条运营配置')
    return
  }
  const articleIds = [...new Set([...linksByDay.values()].flatMap((dayLinks) => dayLinks.map((link) => link.articleId)))]
  const channelIds = [...new Set([...linksByDay.values()].flatMap((dayLinks) => dayLinks.map((link) => link.channelId).filter(Boolean)))]
  queryConfigKey.value = queryKey
  loading.value = true
  days.value = []
  cacheNote.value = ''
  progress.value = ''
  try {
    const cached = await lookupReportCache({
      articleIds,
      channelIds,
      investor: investorName,
      start,
      end,
    })
    const articleSpans: FetchSpan[] = []
    const channelSpans: FetchSpan[] = []
    let cachedDayCount = 0
    for (const day of dayList) {
      const dayLinks = linksByDay.get(day) ?? []
      const plan = planReportFetch({
        days: [day],
        today,
        articleIds: dayLinks.map((link) => link.articleId),
        channelIds: [...new Set(dayLinks.map((link) => link.channelId).filter(Boolean))],
        investor: investorName,
        articles: cached.articles,
        channels: cached.channels,
      })
      if (plan.pendingDayCount === 0) {
        cachedDayCount += 1
      }
      articleSpans.push(...plan.articles)
      channelSpans.push(...plan.channels)
    }
    const plan = {
      cachedDayCount,
      pendingDayCount: dayList.length - cachedDayCount,
      articles: mergeSpans(articleSpans),
      channels: mergeSpans(channelSpans),
    }
    const note =
      plan.pendingDayCount === 0
        ? `这 ${plan.cachedDayCount} 天都在本地，没有重新请求。`
        : `本地已有 ${plan.cachedDayCount} 天，这次补查 ${plan.pendingDayCount} 天。`
    if (viewing(queryKey)) {
      cacheNote.value = note
    }

    const articles = new Map<string, ArticleDaySnapshot>()
    for (const row of cached.articles) {
      articles.set(articleCacheKey(row.articleId, row.day), row)
    }
    const revenues = new Map<string, number | null>()
    const countryRevenues = new Map<string, ChannelCountryRevenue[]>()
    for (const row of cached.channels) {
      if (row.investor === investorName) {
        revenues.set(channelCacheKey(row.channelId, investorName, row.day), row.revenue)
      }
    }

    const warnings: string[] = []
    for (const [index, span] of plan.channels.entries()) {
      const first = span.days[0]
      const last = span.days[span.days.length - 1]
      if (!first || !last) {
        continue
      }
      if (viewing(queryKey)) {
        progress.value = `渠道收入 ${index + 1}/${plan.channels.length} · ${span.id}`
      }
      try {
        const rows = await listChannelRevenue({
          customChannelId: span.id,
          source,
          start: first,
          end: last,
        })
        const byDay = revenueByDay(rows)
        const saving: ChannelDaySnapshot[] = []
        for (const day of span.days) {
          // 请求成功但该日无行：完整日按 0，避免 null 把「每日汇总」打成 —
          const revenue = byDay.has(day) ? (byDay.get(day) ?? 0) : day < today ? 0 : null
          const key = channelCacheKey(span.id, investorName, day)
          revenues.set(key, revenue)
          countryRevenues.set(key, revenueCountriesOnDay(rows, day))
          if (day < today) {
            saving.push({ channelId: span.id, investor: investorName, day, revenue })
          }
        }
        await saveReportCache({ articles: [], channels: saving })
      } catch (error) {
        warnings.push(`渠道 ${span.id} ${errorMessage(error)}`)
        for (const day of span.days) {
          // 失败不写缓存命中（null），下次还会重拉；当天展示先按未知
          const key = channelCacheKey(span.id, investorName, day)
          revenues.set(key, null)
          countryRevenues.set(key, [])
        }
      }
    }

    const pendingArticleIds = [...new Set(plan.articles.map((span) => span.id))]
    const pendingDays = [...new Set(plan.articles.flatMap((span) => span.days))].sort()
    if (pendingArticleIds.length > 0 && pendingDays[0] && pendingDays[pendingDays.length - 1]) {
      if (viewing(queryKey)) {
        progress.value = `文章曝光点击 ${pendingArticleIds.length} 篇`
      }
      const stats = await loadArticleStatsMap(pendingArticleIds, pendingDays[0], pendingDays[pendingDays.length - 1])
      const saving: ArticleDaySnapshot[] = []
      for (const span of plan.articles) {
        for (const day of span.days) {
          const stat = stats.get(articleCacheKey(span.id, day))
          const snapshot: ArticleDaySnapshot = {
            articleId: span.id,
            day,
            pageViews: wholeCount(stat?.pageViews),
            termClicks: wholeCount(stat?.termClicks),
            adClicks: wholeCount(stat?.adClicks),
            keywordCount: wholeCount(stat?.keywordCount),
            keywords: stat?.keywords ?? [],
          }
          articles.set(articleCacheKey(span.id, day), snapshot)
          if (day < today) {
            saving.push(snapshot)
          }
        }
      }
      if (saving.length > 0) {
        await saveReportCache({ articles: saving, channels: [] })
      }
    }

    const currentIds = new Set(links.map((link) => link.articleId))
    const reportDays = [...dayList].reverse().map((day) => {
      const dayLinks = linksByDay.get(day) ?? []
      const dayChannels = [...new Set(dayLinks.map((link) => link.channelId).filter(Boolean))]
      return {
        day,
        channels: dayChannels.map((channelId) => {
          const key = channelCacheKey(channelId, investorName, day)
          return {
            channelId,
            revenue: revenues.get(key) ?? null,
            countries: countryRevenues.get(key) ?? [],
          }
        }),
        articles: dayLinks.map((link) =>
          articleFromSnapshot(
            link,
            articles.get(articleCacheKey(link.articleId, day)),
            countryFor(link.articleId, kept),
            !currentIds.has(link.articleId),
          ),
        ),
      }
    })
    if (queryKey && linksByDay.has(today)) {
      await saveConfigArticles(
        (linksByDay.get(today) ?? []).map((link) => ({
          configId: queryKey,
          day: today,
          articleId: link.articleId,
          channelId: link.channelId,
          countryCode: countryFor(link.articleId, kept),
        })),
      )
    }
    savedReports.set(queryKey, {
      days: reportDays,
      cacheNote: note,
      investor: investorName,
      start,
      end,
    })
    if (viewing(queryKey)) {
      days.value = reportDays
      cacheNote.value = note
      progress.value = ''
    }
    if (warnings.length > 0) {
      const preview = warnings.slice(0, 3).join('；')
      const more = warnings.length > 3 ? `等 ${warnings.length} 处` : ''
      ElMessage.warning(`${preview}${more ? `；${more}` : ''}，其余已查出`)
    }
  } catch (error) {
    if (viewing(queryKey)) {
      days.value = []
      progress.value = ''
      cacheNote.value = ''
      savedReports.delete(queryKey)
    }
    ElMessage.error(errorMessage(error))
  } finally {
    loading.value = false
    queryConfigKey.value = ''
  }
}

async function refreshDay(day: string) {
  if (loading.value || refreshingDay.value) {
    return
  }
  const links = articleLinks(props.urls)
  const today = formatDay(new Date())
  const refreshKey = currentConfigKey.value
  let kept: ConfigArticleRecord[] = []
  if (refreshKey) {
    try {
      kept = await lookupConfigArticles({ configId: refreshKey, start: day, end: day })
    } catch (error) {
      ElMessage.error(errorMessage(error))
      return
    }
  }
  const dayLinks = linksForReportDay(day, today, links, kept)
  if (dayLinks.length === 0) {
    ElMessage.error(props.siteLabel ? '当前配置没有带文章 ID 的推荐链接' : '先在左侧选中一条运营配置')
    return
  }
  const source = props.accountSource.trim()
  const investorName = revenueCacheInvestor()
  if (!source) {
    ElMessage.error(props.siteLabel ? '当前配置没有可识别的文章账户（如 A3）' : '先在左侧选中一条运营配置')
    return
  }
  const channelIds = [...new Set(dayLinks.map((link) => link.channelId).filter(Boolean))]
  refreshingDay.value = day
  try {
    const channels: ChannelReport[] = []
    const channelSnapshots: ChannelDaySnapshot[] = []
    const warnings: string[] = []
    for (const channelId of channelIds) {
      try {
        const rows = await listChannelRevenue({
          customChannelId: channelId,
          source,
          start: day,
          end: day,
        })
        const byDay = revenueByDay(rows)
        const revenue = byDay.has(day) ? (byDay.get(day) ?? 0) : day < today ? 0 : null
        channels.push({
          channelId,
          revenue,
          countries: revenueCountriesOnDay(rows, day),
        })
        if (revenue != null) {
          channelSnapshots.push({ channelId, investor: investorName, day, revenue })
        }
      } catch (error) {
        warnings.push(`渠道 ${channelId} ${errorMessage(error)}`)
        channels.push({ channelId, revenue: null, countries: [] })
      }
    }

    const articles: ArticleReport[] = []
    const articleSnapshots: ArticleDaySnapshot[] = []
    const currentIds = new Set(links.map((link) => link.articleId))
    const stats = await loadArticleStatsMap(
      dayLinks.map((link) => link.articleId),
      day,
      day,
    )
    for (const link of dayLinks) {
      const stat = stats.get(articleCacheKey(link.articleId, day))
      const snapshot: ArticleDaySnapshot = {
        articleId: link.articleId,
        day,
        pageViews: wholeCount(stat?.pageViews),
        termClicks: wholeCount(stat?.termClicks),
        adClicks: wholeCount(stat?.adClicks),
        keywordCount: wholeCount(stat?.keywordCount),
        keywords: stat?.keywords ?? [],
      }
      articleSnapshots.push(snapshot)
      articles.push(articleFromSnapshot(link, snapshot, countryFor(link.articleId, kept), !currentIds.has(link.articleId)))
    }

    if (day < today) {
      await saveReportCache({ articles: articleSnapshots, channels: channelSnapshots })
    }
    if (refreshKey && day === today) {
      await saveConfigArticles(
        dayLinks.map((link) => ({
          configId: refreshKey,
          day,
          articleId: link.articleId,
          channelId: link.channelId,
          countryCode: countryFor(link.articleId, kept),
        })),
      )
    }
    const nextDay = { day, channels, articles }
    if (viewing(refreshKey)) {
      const index = days.value.findIndex((item) => item.day === day)
      if (index >= 0) {
        days.value.splice(index, 1, nextDay)
      }
    }
    const saved = savedReports.get(refreshKey)
    if (saved) {
      const index = saved.days.findIndex((item) => item.day === day)
      if (index >= 0) {
        const nextDays = saved.days.slice()
        nextDays.splice(index, 1, nextDay)
        savedReports.set(refreshKey, { ...saved, days: nextDays })
      }
    }
    if (warnings.length > 0) {
      const preview = warnings.slice(0, 3).join('；')
      const more = warnings.length > 3 ? `等 ${warnings.length} 处` : ''
      ElMessage.warning(`${preview}${more ? `；${more}` : ''}，已知收入已更新`)
    } else {
      ElMessage.success(`已重新拉取 ${day}`)
    }
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    refreshingDay.value = ''
  }
}

watch(
  () => props.configId,
  (next, previous) => {
    if (configKey(next) === configKey(previous)) {
      return
    }
    showSavedReport(configKey(next))
  },
)

function countryFor(articleId: string, kept: ConfigArticleRecord[]): string {
  return props.countryCodes[articleId] || kept.find((item) => item.articleId === articleId)?.countryCode || ''
}

function formatCountryRevenues(countries: ChannelCountryRevenue[]): string {
  return countries.map((item) => `${item.countryCode} ${formatMoney(item.revenue)}`).join(' · ')
}

function mergeSpans(spans: FetchSpan[]): FetchSpan[] {
  const byId = new Map<string, string[]>()
  for (const span of spans) {
    const days = byId.get(span.id) ?? []
    days.push(...span.days)
    byId.set(span.id, days)
  }
  return [...byId.entries()].flatMap(([id, days]) => contiguousSpans(days).map((slice) => ({ id, days: slice })))
}

function articleFromSnapshot(
  link: ArticleLink,
  snapshot: ArticleDaySnapshot | undefined,
  countryCode: string,
  kept: boolean,
): ArticleReport {
  const keywords = snapshot?.keywords ?? []
  return {
    articleId: link.articleId,
    channelId: link.channelId,
    pageViews: snapshot?.pageViews ?? 0,
    termClicks: snapshot?.termClicks ?? keywords.reduce((sum, row) => sum + row.termClicks, 0),
    adClicks: snapshot?.adClicks ?? keywords.reduce((sum, row) => sum + row.adClicks, 0),
    keywordCount: snapshot?.keywordCount ?? keywords.filter((row) => row.keyword && row.termClicks > 0).length,
    keywords,
    countryCode,
    kept,
  }
}
</script>

<template>
  <div class="report-panel">
    <div class="report-toolbar">
      <el-date-picker
        v-model="range"
        class="range"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        :disabled="loading || refreshingDay !== ''"
      />
      <el-button type="primary" :loading="loadingCurrent" :disabled="loading || refreshingDay !== ''" @click="load">查询</el-button>
    </div>
    <p v-if="progress" class="progress">{{ progress }}</p>

    <div v-if="siteLabel" class="report-meta">
      <strong>{{ siteLabel }}</strong>
      <span v-if="accountName">账户 {{ accountName }}</span>
      <span v-if="accountSource">source {{ accountSource }}</span>
      <span>{{ linkCount }} 篇文章</span>
      <span>{{ channelCount }} 个渠道</span>
    </div>
    <p v-else class="report-note">先在左侧选中一条运营配置。</p>
    <p class="report-note">曝光来自埋点统计；收入走 `/report/afsData/list`（`VITE_MIS_ADMIN_TOKEN`，source + customChannelId，返回渠道/国家/收入）。今天以前查完整的结果会记在本地；今天每次重新查。</p>
    <p v-if="cacheNote" class="cache-note">{{ cacheNote }}</p>

    <div v-if="!loadingCurrent && days.length === 0" class="report-empty">
      <strong>还没有日报</strong>
      <p>选择日期后查询。不会自动请求。</p>
    </div>

    <section v-if="hasInsights" class="insights">
      <div class="insight-head">
        <p class="block-label">洞察结论</p>
        <span class="insight-scope">{{ insightScopeLabel }}</span>
      </div>
      <ReportInsightCharts
        :growing="insightGrowing"
        :replace="insightReplace"
        :countries="insightCountries"
        :contributions="insightContributions"
      />
    </section>

    <section v-if="days.length" class="revenue-trend">
      <p class="block-label">每日汇总</p>
      <el-table :data="days" size="small">
        <el-table-column prop="day" label="日期" width="112" fixed />
        <el-table-column label="总收入" min-width="220" align="right">
          <template #default="{ row, $index }">
            <div class="metric">
              <span v-if="daySummaries[$index].revenue.total == null" class="dash">—</span>
              <span v-else class="money">{{ formatMoney(daySummaries[$index].revenue.total) }}</span>
              <span :class="changeClass(daySummaries[$index].revenue.delta)">
                {{ changeLabel(daySummaries[$index].revenue.delta, daySummaries[$index].revenue.rate) }}
              </span>
              <div v-if="row.channels.length" class="channel-rev">
                <span v-for="channel in row.channels" :key="channel.channelId">
                  {{ channel.channelId }}
                  {{ channel.revenue == null ? '—' : formatMoney(channel.revenue) }}
                  <template v-if="channel.countries.length">
                    （{{ formatCountryRevenues(channel.countries) }}）
                  </template>
                </span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="总曝光" min-width="130" align="right">
          <template #default="{ $index }">
            <div class="metric">
              <span>{{ daySummaries[$index].pageViews.total }}</span>
              <span :class="changeClass(daySummaries[$index].pageViews.delta)">
                {{ changeLabel(daySummaries[$index].pageViews.delta, daySummaries[$index].pageViews.rate, 0) }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="总关键词点击" min-width="160" align="right">
          <template #default="{ $index }">
            <div class="metric">
              <span class="count-rate">
                <span>{{ daySummaries[$index].termClicks.total }}</span>
                <span class="rate">{{ daySummaries[$index].termRate }}</span>
              </span>
              <span :class="changeClass(daySummaries[$index].termClicks.delta)">
                {{ changeLabel(daySummaries[$index].termClicks.delta, daySummaries[$index].termClicks.rate, 0) }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="总广告点击" min-width="160" align="right">
          <template #default="{ $index }">
            <div class="metric">
              <span class="count-rate">
                <span>{{ daySummaries[$index].adClicks.total }}</span>
                <span class="rate">{{ daySummaries[$index].adRate }}</span>
              </span>
              <span :class="changeClass(daySummaries[$index].adClicks.delta)">
                {{ changeLabel(daySummaries[$index].adClicks.delta, daySummaries[$index].adClicks.rate, 0) }}
              </span>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section v-for="day in days" :key="day.day" class="report-day">
      <div class="day-head">
        <h3>{{ day.day }}</h3>
        <el-button
          size="small"
          :loading="refreshingDay === day.day"
          :disabled="loading || (refreshingDay !== '' && refreshingDay !== day.day)"
          @click="refreshDay(day.day)"
        >
          重新拉取
        </el-button>
      </div>
      <p class="block-label">渠道收入</p>
      <el-table :data="day.channels" size="small" empty-text="这些链接没有渠道 ID">
        <el-table-column label="渠道 ID" min-width="160">
          <template #default="{ row }"><span class="id">{{ row.channelId }}</span></template>
        </el-table-column>
        <el-table-column label="国家收入" min-width="280">
          <template #default="{ row }">
            <span v-if="!row.countries.length" class="dash">—</span>
            <span v-else class="country-rev">
              <span v-for="item in row.countries" :key="item.countryCode" class="country-chip">
                {{ item.countryCode }} {{ formatMoney(item.revenue) }}
              </span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="合计" min-width="120" align="right">
          <template #default="{ row }">
            <span v-if="row.revenue == null" class="dash">—</span>
            <span v-else class="money">{{ formatMoney(row.revenue) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <p class="block-label">文章</p>
      <el-table :data="day.articles" size="small" class="article-table">
        <el-table-column type="expand">
          <template #default="{ row: article }">
            <el-table v-if="article.keywords.length" :data="article.keywords" size="small" class="keyword-table">
              <el-table-column label="关键词" min-width="220">
                <template #default="{ row: keyword }">{{ keywordLabel(keyword.keyword) }}</template>
              </el-table-column>
              <el-table-column label="关键词点击" width="150" align="right">
                <template #default="{ row: keyword }">
                  <span class="count-rate">
                    <span>{{ keyword.termClicks }}</span>
                    <span class="rate">{{ formatClickRate(keyword.termClicks, article.pageViews) }}</span>
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="广告点击" width="140" align="right">
                <template #default="{ row: keyword }">
                  <span class="count-rate">
                    <span>{{ keyword.adClicks }}</span>
                    <span class="rate">{{ formatClickRate(keyword.adClicks, article.pageViews) }}</span>
                  </span>
                </template>
              </el-table-column>
            </el-table>
            <p v-else class="keyword-empty">这一天没有关键词点击或广告点击</p>
          </template>
        </el-table-column>
        <el-table-column label="文章 ID" min-width="160">
          <template #default="{ row }">
            <span class="id">{{ row.articleId }}</span>
            <span v-if="row.kept" class="kept">已换下</span>
          </template>
        </el-table-column>
        <el-table-column label="国家" width="72" align="center">
          <template #default="{ row }">{{ row.countryCode || '—' }}</template>
        </el-table-column>
        <el-table-column label="渠道 ID" min-width="140">
          <template #default="{ row }"><span class="id">{{ row.channelId || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="pageViews" label="曝光" width="88" align="right" />
        <el-table-column prop="keywordCount" label="关键词数" width="96" align="right" />
        <el-table-column label="关键词点击" width="150" align="right">
          <template #default="{ row }">
            <span class="count-rate">
              <span>{{ row.termClicks }}</span>
              <span class="rate">{{ formatClickRate(row.termClicks, row.pageViews) }}</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="广告点击" width="140" align="right">
          <template #default="{ row }">
            <span class="count-rate">
              <span>{{ row.adClicks }}</span>
              <span class="rate">{{ formatClickRate(row.adClicks, row.pageViews) }}</span>
            </span>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.report-panel {
  height: 100%;
  overflow: auto;
}

.report-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding-top: 12px;
}

.report-toolbar :deep(.range) {
  width: 280px;
  flex: 0 0 280px;
}

.progress,
.report-note,
.keyword-empty {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.progress {
  margin-top: 0;
}

.report-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}

.report-meta strong {
  font-size: 14px;
  font-weight: 650;
}

.report-meta span {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--paper);
  color: var(--muted);
  font-size: 12px;
}

.cache-note {
  margin: 10px 0 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: #eef4ff;
  color: var(--blue);
  font-size: 13px;
}

.insights {
  margin-top: 16px;
}

.insight-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: baseline;
  justify-content: space-between;
}

.insight-head .block-label {
  margin: 0;
}

.insight-scope {
  color: var(--muted);
  font-size: 12px;
}

.report-empty {
  margin-top: 20px;
  padding: 36px 16px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  text-align: center;
}

.report-empty strong {
  display: block;
  font-size: 14px;
  font-weight: 650;
}

.report-empty p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.report-day {
  margin-top: 16px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
}

.revenue-trend {
  margin-top: 16px;
}

.metric {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  line-height: 1.4;
}

.day-head {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.change-up,
.change-down {
  font-weight: 650;
}

.change-up {
  color: var(--ok);
}

.change-down {
  color: #c2410c;
}

.report-day h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}

.block-label {
  margin: 14px 0 8px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
}

.report-day :deep(.el-table) {
  --el-table-header-bg-color: #f7f8fa;
  --el-table-header-text-color: var(--muted);
  --el-table-border-color: var(--line);
  --el-table-text-color: var(--ink);
}

.id {
  font-family: var(--mono);
  font-size: 12px;
}

.channel-rev {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  justify-content: flex-end;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.4;
}

.country-rev {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.country-chip {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
  padding: 1px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #f8fafc;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink);
}

.kept {
  margin-left: 6px;
  color: var(--muted);
  font-size: 12px;
}

.money {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 650;
  color: var(--ok);
}

.count-rate {
  display: inline-flex;
  gap: 6px;
  align-items: baseline;
  justify-content: flex-end;
}

.rate {
  color: var(--muted);
  font-size: 12px;
}

.dash,
.keyword-empty {
  color: var(--muted);
}

.article-table :deep(.el-table__expanded-cell) {
  padding: 8px 12px 12px 48px;
  background: #fafbfc;
}

.keyword-table {
  border-radius: 8px;
}
</style>
