<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getAccountList,
  getOperationConfigDetail,
  getOperationConfigPage,
  getSiteList,
  type AccountOption,
  type OperationConfigRow,
  type SiteOption,
} from '../api/article'
import { listChannelRevenue, listSubid2DailyStat } from '../api/report'
import { saveReportCache } from '../api/reportCache'
import { errorMessage } from '../api/http'
import { articleDomain } from '../domain/batch'
import { bareDomain } from '../domain/articleJobStore'
import {
  adClickRate,
  dayBeforeAndYesterday,
  loadDashboardSnapshot,
  makeRequestFailure,
  saveDashboardSnapshot,
  sumDayMetrics,
  type DashboardDayMetrics,
  type DashboardDomainRow,
  type DashboardRequestFailure,
  type DashboardSnapshot,
} from '../domain/dashboardStore'
import {
  articleDayStatMap,
  articleLinks,
  compareMetric,
  formatMoney,
  AFS_REVENUE_CACHE_INVESTOR,
  revenueByDay,
  sourceFromAccountName,
} from '../domain/report'
import { recentArticleItems } from '../domain/recentArticles'
import type { ArticleDaySnapshot, ChannelDaySnapshot } from '../domain/reportCache'

const snapshot = ref<DashboardSnapshot | null>(null)
const loading = ref(false)
const retryingId = ref('')
const progress = ref('')
const accounts = ref<AccountOption[]>([])
const sites = ref<SiteOption[]>([])
const totals = computed(() => snapshot.value?.totals)
const domains = computed(() => snapshot.value?.domains ?? [])
const requestFailures = computed(() => snapshot.value?.requestFailures ?? [])
const busy = computed(() => loading.value || Boolean(retryingId.value))

function commitSnapshot(next: DashboardSnapshot) {
  const domainsNext = sortDomainRows(next.domains)
  const committed: DashboardSnapshot = {
    ...next,
    domains: domainsNext,
    totals: {
      yesterday: sumDayMetrics(domainsNext.map((row) => row.yesterday)),
      today: sumDayMetrics(domainsNext.map((row) => row.today)),
    },
    failedConfigIds: (next.requestFailures ?? [])
      .filter((item) => item.kind === 'config' && item.configId)
      .map((item) => String(item.configId)),
    warnings: (next.requestFailures ?? []).map((item) => `${item.target} ${item.message}`),
  }
  snapshot.value = committed
  saveDashboardSnapshot(committed)
}

/** snapshot.yesterday = 前天，snapshot.today = 昨天（两个完整日） */
const kpiCards = computed(() => {
  const prev = totals.value?.yesterday
  const curr = totals.value?.today
  if (!prev || !curr) {
    return []
  }
  return [
    {
      key: 'revenue',
      label: '收入',
      curr: curr.revenue,
      prev: prev.revenue,
      compare: compareMetric(curr.revenue, prev.revenue),
      money: true,
    },
    {
      key: 'views',
      label: '曝光',
      curr: curr.pageViews,
      prev: prev.pageViews,
      compare: compareMetric(curr.pageViews, prev.pageViews),
      money: false,
    },
    {
      key: 'ads',
      label: '广点',
      curr: curr.adClicks,
      prev: prev.adClicks,
      compare: compareMetric(curr.adClicks, prev.adClicks),
      money: false,
    },
    {
      key: 'ctr',
      label: '广点率',
      curr: adClickRate(curr.adClicks, curr.pageViews),
      prev: adClickRate(prev.adClicks, prev.pageViews),
      compare: compareMetric(
        adClickRate(curr.adClicks, curr.pageViews),
        adClickRate(prev.adClicks, prev.pageViews),
      ),
      money: false,
      rate: true,
    },
  ]
})

const revenueGap = computed(() => compareMetric(totals.value?.today.revenue ?? null, totals.value?.yesterday.revenue ?? null))

const domainCompareRows = computed(() =>
  domains.value
    .map((row) => {
      const revenue = compareMetric(row.today.revenue, row.yesterday.revenue)
      const views = compareMetric(row.today.pageViews, row.yesterday.pageViews)
      const ads = compareMetric(row.today.adClicks, row.yesterday.adClicks)
      const prevCtr = adClickRate(row.yesterday.adClicks, row.yesterday.pageViews)
      const currCtr = adClickRate(row.today.adClicks, row.today.pageViews)
      const ctr = compareMetric(currCtr, prevCtr)
      return {
        ...row,
        revenue,
        views,
        ads,
        prevCtr,
        currCtr,
        ctr,
      }
    })
    .sort((a, b) => {
      const ad = a.revenue.delta
      const bd = b.revenue.delta
      if (ad == null && bd == null) {
        return a.domain.localeCompare(b.domain)
      }
      if (ad == null) {
        return 1
      }
      if (bd == null) {
        return -1
      }
      return ad - bd || a.domain.localeCompare(b.domain)
    }),
)

const topRevenueDomains = computed(() => {
  const rows = domains.value
    .map((row) => ({
      domain: row.domain,
      accountName: row.accountName,
      channelIds: row.channelIds ?? [],
      yesterday: row.yesterday.revenue ?? 0,
      today: row.today.revenue ?? 0,
      hasRevenue: row.yesterday.revenue != null || row.today.revenue != null,
    }))
    .filter((row) => row.hasRevenue)
    .sort((a, b) => Math.max(b.yesterday, b.today) - Math.max(a.yesterday, a.today))
    .slice(0, 8)
  const max = Math.max(1, ...rows.flatMap((row) => [row.yesterday, row.today]))
  return rows.map((row) => ({
    ...row,
    yesterdayWidth: (row.yesterday / max) * 100,
    todayWidth: (row.today / max) * 100,
  }))
})

function channelIdsText(ids: string[] | undefined): string {
  return (ids ?? []).filter(Boolean).join(' · ')
}

const revenueMovers = computed(() => {
  const ranked = domainCompareRows.value.filter((row) => row.revenue.delta != null)
  const down = ranked.filter((row) => (row.revenue.delta ?? 0) < 0).slice(0, 8)
  const up = ranked
    .filter((row) => (row.revenue.delta ?? 0) > 0)
    .slice()
    .sort((a, b) => (b.revenue.delta ?? 0) - (a.revenue.delta ?? 0))
    .slice(0, 8)
  return { up, down }
})

onMounted(() => {
  snapshot.value = loadDashboardSnapshot()
  void loadMeta()
})

async function loadMeta() {
  try {
    const [accountList, siteList] = await Promise.all([getAccountList(), getSiteList()])
    accounts.value = accountList
    sites.value = siteList
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
}

function accountNameById(id: unknown): string {
  if (id == null || id === '') {
    return ''
  }
  return accounts.value.find((item) => String(item.id) === String(id))?.name?.trim() || ''
}

function domainOfConfig(row: OperationConfigRow, detail: Record<string, unknown>): string {
  const site = sites.value.find((item) => item.id == row.siteId || item.id == detail.siteId)
  return bareDomain(articleDomain(site) || String(row.siteName || detail.siteName || ''))
}

function wholeCount(value: number | null | undefined): number {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number) || number < 0) {
    return 0
  }
  return Math.round(number)
}

async function loadAllConfigs(): Promise<OperationConfigRow[]> {
  const pageSize = 50
  const all: OperationConfigRow[] = []
  let pageNum = 1
  let total = Number.POSITIVE_INFINITY
  while (all.length < total) {
    const result = await getOperationConfigPage({ pageNum, pageSize })
    total = result.total
    all.push(...result.records)
    if (result.records.length === 0) {
      break
    }
    pageNum += 1
  }
  return all
}

type DomainBucket = {
  domain: string
  accountName: string
  accountSource: string
  articleIds: Set<string>
  channelIds: Set<string>
  articleChannel: Map<string, string>
}

function emptyBucket(domain: string, accountName: string, accountSource: string): DomainBucket {
  return {
    domain,
    accountName,
    accountSource,
    articleIds: new Set<string>(),
    channelIds: new Set<string>(),
    articleChannel: new Map<string, string>(),
  }
}

function absorbLinks(bucket: DomainBucket, links: ReturnType<typeof articleLinks>) {
  for (const link of links) {
    bucket.articleIds.add(link.articleId)
    bucket.articleChannel.set(link.articleId, link.channelId)
    if (link.channelId) {
      bucket.channelIds.add(link.channelId)
    }
  }
}

function metricsForBucket(
  bucket: DomainBucket,
  day: string,
  articleStats: Map<string, { pageViews: number; termClicks: number; adClicks: number }>,
  revenues: Map<string, number | null>,
): DashboardDayMetrics {
  let pageViews = 0
  let termClicks = 0
  let adClicks = 0
  for (const articleId of bucket.articleIds) {
    const stat = articleStats.get(`${articleId}\n${day}`)
    pageViews += wholeCount(stat?.pageViews)
    termClicks += wholeCount(stat?.termClicks)
    adClicks += wholeCount(stat?.adClicks)
  }
  const channelRevenues = [...bucket.channelIds].map(
    (channelId) => revenues.get(`${bucket.accountSource}\n${channelId}\n${day}`) ?? null,
  )
  let revenue: number | null = null
  if (channelRevenues.length === 0) {
    revenue = null
  } else if (channelRevenues.every((value) => value == null)) {
    // 全部渠道失败/未知 → 域名收入未知
    revenue = null
  } else {
    // 个别渠道缺数时仍加总已知收入，避免一个空渠道把整站收入打成 —
    revenue = channelRevenues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  }
  return {
    revenue,
    pageViews,
    termClicks,
    adClicks,
    articleCount: bucket.articleIds.size,
    channelCount: bucket.channelIds.size,
  }
}

async function fetchArticleStatsChunk(
  chunk: string[],
  startDay: string,
  endDay: string,
  calendarToday: string,
): Promise<Map<string, { pageViews: number; termClicks: number; adClicks: number }>> {
  const articleStats = new Map<string, { pageViews: number; termClicks: number; adClicks: number }>()
  const stats = articleDayStatMap(
    await listSubid2DailyStat({
      subid2List: chunk,
      startDate: startDay,
      endDate: endDay,
      keywordLimit: 1,
    }),
  )
  const saving: ArticleDaySnapshot[] = []
  for (const [key, stat] of stats.entries()) {
    articleStats.set(key, {
      pageViews: wholeCount(stat.pageViews),
      termClicks: wholeCount(stat.termClicks),
      adClicks: wholeCount(stat.adClicks),
    })
    const [articleId, day] = key.split('\n')
    if (articleId && day && day < calendarToday) {
      saving.push({
        articleId,
        day,
        pageViews: wholeCount(stat.pageViews),
        termClicks: wholeCount(stat.termClicks),
        adClicks: wholeCount(stat.adClicks),
        keywordCount: wholeCount(stat.keywordCount),
        keywords: [],
      })
    }
  }
  if (saving.length) {
    await saveReportCache({ articles: saving, channels: [] })
  }
  return articleStats
}

async function loadArticleStats(
  articleIds: string[],
  startDay: string,
  endDay: string,
  calendarToday: string,
  failures: DashboardRequestFailure[],
  label = '文章曝光',
) {
  const articleStats = new Map<string, { pageViews: number; termClicks: number; adClicks: number }>()
  const articleChunks: string[][] = []
  for (let i = 0; i < articleIds.length; i += 80) {
    articleChunks.push(articleIds.slice(i, i + 80))
  }
  for (const [index, chunk] of articleChunks.entries()) {
    progress.value = `${label} ${index + 1}/${articleChunks.length || 1}`
    try {
      const part = await fetchArticleStatsChunk(chunk, startDay, endDay, calendarToday)
      for (const [key, value] of part.entries()) {
        articleStats.set(key, value)
      }
    } catch (error) {
      failures.push(
        makeRequestFailure({
          kind: 'exposure',
          target: `曝光批次 ${index + 1}/${articleChunks.length}（${chunk.length} 篇）`,
          message: errorMessage(error),
          articleIds: [...chunk],
        }),
      )
    }
  }
  return articleStats
}

async function fetchChannelRevenueDays(
  job: { channelId: string; source: string },
  startDay: string,
  endDay: string,
  calendarToday: string,
): Promise<{ start: number | null; end: number | null }> {
  const investor = AFS_REVENUE_CACHE_INVESTOR
  const rows = await listChannelRevenue({
    customChannelId: job.channelId,
    source: job.source,
    start: startDay,
    end: endDay,
  })
  const byDay = revenueByDay(rows)
  const saving: ChannelDaySnapshot[] = []
  const start = byDay.has(startDay) ? (byDay.get(startDay) ?? 0) : startDay < calendarToday ? 0 : null
  const end = byDay.has(endDay) ? (byDay.get(endDay) ?? 0) : endDay < calendarToday ? 0 : null
  for (const day of [startDay, endDay]) {
    const revenue = day === startDay ? start : end
    if (day < calendarToday) {
      saving.push({
        channelId: job.channelId,
        investor,
        day,
        revenue,
      })
    }
  }
  if (saving.length) {
    await saveReportCache({ articles: [], channels: saving })
  }
  return { start, end }
}

async function loadChannelRevenues(
  jobs: Array<{ channelId: string; source: string }>,
  startDay: string,
  endDay: string,
  calendarToday: string,
  failures: DashboardRequestFailure[],
) {
  const revenues = new Map<string, number | null>()
  for (const [index, job] of jobs.entries()) {
    progress.value = `渠道收入 ${index + 1}/${jobs.length || 1}`
    try {
      const { start, end } = await fetchChannelRevenueDays(job, startDay, endDay, calendarToday)
      revenues.set(`${job.source}\n${job.channelId}\n${startDay}`, start)
      revenues.set(`${job.source}\n${job.channelId}\n${endDay}`, end)
    } catch (error) {
      failures.push(
        makeRequestFailure({
          kind: 'revenue',
          target: `渠道 ${job.channelId} · source ${job.source}`,
          message: errorMessage(error),
          channelId: job.channelId,
          source: job.source,
        }),
      )
      revenues.set(`${job.source}\n${job.channelId}\n${startDay}`, null)
      revenues.set(`${job.source}\n${job.channelId}\n${endDay}`, null)
    }
  }
  return revenues
}

async function refresh() {
  if (busy.value) {
    return
  }
  loading.value = true
  progress.value = '读取运营配置…'
  const failures: DashboardRequestFailure[] = []
  try {
    if (accounts.value.length === 0 || sites.value.length === 0) {
      await loadMeta()
    }
    const { dayBefore, yesterday, calendarToday } = dayBeforeAndYesterday()
    const configs = await loadAllConfigs()
    const buckets = new Map<string, DomainBucket>()

    for (const [index, row] of configs.entries()) {
      progress.value = `读取配置 ${index + 1}/${configs.length}`
      let detail: Record<string, unknown>
      try {
        detail = await getOperationConfigDetail(row.id)
      } catch (error) {
        failures.push(
          makeRequestFailure({
            kind: 'config',
            target: `配置 ${row.id}`,
            message: errorMessage(error),
            configId: String(row.id),
          }),
        )
        continue
      }
      const urls = recentArticleItems(detail.recentArticles ?? row.recentArticles).map((item) => item.url)
      const links = articleLinks(urls)
      if (links.length === 0) {
        continue
      }
      const domain = domainOfConfig(row, detail)
      if (!domain) {
        failures.push(
          makeRequestFailure({
            kind: 'meta',
            target: `配置 ${row.id}`,
            message: '没有域名',
            configId: String(row.id),
          }),
        )
        continue
      }
      const accountId = detail.accountId ?? row.accountId
      const accountName = accountNameById(accountId)
      const accountSource = sourceFromAccountName(accountName)
      if (!accountSource) {
        failures.push(
          makeRequestFailure({
            kind: 'meta',
            target: `${domain} · 配置 ${row.id}`,
            message: '账户无法识别 source（需要 A数字）',
            configId: String(row.id),
          }),
        )
        continue
      }
      const key = domain
      const bucket = buckets.get(key) || emptyBucket(domain, accountName, accountSource)
      if (!buckets.has(key)) {
        buckets.set(key, bucket)
      }
      absorbLinks(bucket, links)
    }

    const allArticleIds = [...new Set([...buckets.values()].flatMap((item) => [...item.articleIds]))]
    const articleStats = await loadArticleStats(allArticleIds, dayBefore, yesterday, calendarToday, failures)
    const channelJobs = new Map<string, { channelId: string; source: string }>()
    for (const bucket of buckets.values()) {
      for (const channelId of bucket.channelIds) {
        channelJobs.set(`${bucket.accountSource}\n${channelId}`, { channelId, source: bucket.accountSource })
      }
    }
    const revenues = await loadChannelRevenues([...channelJobs.values()], dayBefore, yesterday, calendarToday, failures)

    const domainRows: DashboardDomainRow[] = []
    for (const bucket of buckets.values()) {
      domainRows.push({
        domain: bucket.domain,
        accountName: bucket.accountName,
        accountSource: bucket.accountSource,
        channelIds: [...bucket.channelIds],
        articleIds: [...bucket.articleIds],
        yesterday: metricsForBucket(bucket, dayBefore, articleStats, revenues),
        today: metricsForBucket(bucket, yesterday, articleStats, revenues),
      })
    }

    commitSnapshot({
      refreshedAt: new Date().toISOString(),
      yesterday: dayBefore,
      today: yesterday,
      totals: {
        yesterday: sumDayMetrics(domainRows.map((row) => row.yesterday)),
        today: sumDayMetrics(domainRows.map((row) => row.today)),
      },
      domains: domainRows,
      warnings: [],
      requestFailures: failures,
    })
    progress.value = ''
    ElMessage.success(`已刷新 ${domainRows.length} 个域名`)
    if (failures.length) {
      ElMessage.warning(`有 ${failures.length} 条失败请求，可在下方重试并并入汇总`)
    }
  } catch (error) {
    progress.value = ''
    ElMessage.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}

function sortDomainRows(rows: DashboardDomainRow[]): DashboardDomainRow[] {
  return [...rows].sort((a, b) => {
    const ar = a.yesterday.revenue
    const br = b.yesterday.revenue
    if (ar == null && br == null) {
      return b.yesterday.pageViews - a.yesterday.pageViews || a.domain.localeCompare(b.domain)
    }
    if (ar == null) {
      return 1
    }
    if (br == null) {
      return -1
    }
    return br - ar || a.domain.localeCompare(b.domain)
  })
}

function removeFailure(failureId: string, extra: DashboardRequestFailure[] = []) {
  if (!snapshot.value) {
    return
  }
  commitSnapshot({
    ...snapshot.value,
    refreshedAt: new Date().toISOString(),
    requestFailures: [...(snapshot.value.requestFailures ?? []).filter((item) => item.id !== failureId), ...extra],
  })
}

function addRevenueToMetrics(metrics: DashboardDayMetrics, amount: number | null): DashboardDayMetrics {
  if (amount == null || !Number.isFinite(amount)) {
    return metrics
  }
  return {
    ...metrics,
    // 失败渠道原先按 0 参与部分汇总；成功后把实数加回去
    revenue: (metrics.revenue ?? 0) + amount,
  }
}

function addStatsToMetrics(
  metrics: DashboardDayMetrics,
  delta: { pageViews: number; termClicks: number; adClicks: number },
): DashboardDayMetrics {
  return {
    ...metrics,
    pageViews: metrics.pageViews + delta.pageViews,
    termClicks: metrics.termClicks + delta.termClicks,
    adClicks: metrics.adClicks + delta.adClicks,
  }
}

async function retryConfigFailure(failure: DashboardRequestFailure) {
  const configId = String(failure.configId || '')
  if (!configId || !snapshot.value) {
    return
  }
  if (accounts.value.length === 0 || sites.value.length === 0) {
    await loadMeta()
  }
  const { dayBefore, yesterday, calendarToday } = dayBeforeAndYesterday()
  const nestedFailures: DashboardRequestFailure[] = []
  const detail = await getOperationConfigDetail(configId)
  const urls = recentArticleItems(detail.recentArticles).map((item) => item.url)
  const links = articleLinks(urls)
  if (links.length === 0) {
    removeFailure(failure.id)
    ElMessage.success(`配置 ${configId} 没有推荐文章，已从失败列表移除`)
    return
  }
  const domain = bareDomain(
    articleDomain(sites.value.find((item) => item.id == detail.siteId)) || String(detail.siteName || detail.siteUrl || ''),
  )
  if (!domain) {
    throw new Error('没有域名')
  }
  const accountName = accountNameById(detail.accountId)
  const accountSource = sourceFromAccountName(accountName)
  if (!accountSource) {
    throw new Error(`账户 ${accountName || '未知'} 无法识别 source（需要 A数字）`)
  }
  const bucket = emptyBucket(domain, accountName, accountSource)
  absorbLinks(bucket, links)
  const articleStats = await loadArticleStats(
    [...bucket.articleIds],
    dayBefore,
    yesterday,
    calendarToday,
    nestedFailures,
    `重试曝光`,
  )
  const revenues = await loadChannelRevenues(
    [...bucket.channelIds].map((channelId) => ({ channelId, source: accountSource })),
    dayBefore,
    yesterday,
    calendarToday,
    nestedFailures,
  )
  const row: DashboardDomainRow = {
    domain,
    accountName,
    accountSource,
    channelIds: [...bucket.channelIds],
    articleIds: [...bucket.articleIds],
    yesterday: metricsForBucket(bucket, dayBefore, articleStats, revenues),
    today: metricsForBucket(bucket, yesterday, articleStats, revenues),
  }
  commitSnapshot({
    ...snapshot.value,
    refreshedAt: new Date().toISOString(),
    yesterday: dayBefore,
    today: yesterday,
    domains: [...snapshot.value.domains.filter((item) => item.domain !== domain), row],
    requestFailures: [...(snapshot.value.requestFailures ?? []).filter((item) => item.id !== failure.id), ...nestedFailures],
  })
  ElMessage.success(`已重试配置 ${configId}（${domain}），结果已并入汇总`)
}

async function retryRevenueFailure(failure: DashboardRequestFailure) {
  if (!snapshot.value || !failure.channelId || !failure.source) {
    return
  }
  const { dayBefore, yesterday, calendarToday } = dayBeforeAndYesterday()
  const { start, end } = await fetchChannelRevenueDays(
    { channelId: failure.channelId, source: failure.source },
    dayBefore,
    yesterday,
    calendarToday,
  )
  const domainsNext = snapshot.value.domains.map((row) => {
    if (row.accountSource !== failure.source) {
      return row
    }
    if (!(row.channelIds ?? []).includes(failure.channelId!)) {
      return row
    }
    return {
      ...row,
      yesterday: addRevenueToMetrics(row.yesterday, start),
      today: addRevenueToMetrics(row.today, end),
    }
  })
  commitSnapshot({
    ...snapshot.value,
    refreshedAt: new Date().toISOString(),
    domains: domainsNext,
    requestFailures: (snapshot.value.requestFailures ?? []).filter((item) => item.id !== failure.id),
  })
  ElMessage.success(`渠道 ${failure.channelId} 收入已并入汇总`)
}

async function retryExposureFailure(failure: DashboardRequestFailure) {
  if (!snapshot.value || !failure.articleIds?.length) {
    return
  }
  const { dayBefore, yesterday, calendarToday } = dayBeforeAndYesterday()
  const stats = await fetchArticleStatsChunk(failure.articleIds, dayBefore, yesterday, calendarToday)
  const articleSet = new Set(failure.articleIds)
  const domainsNext = snapshot.value.domains.map((row) => {
    const owned = (row.articleIds ?? []).filter((id) => articleSet.has(id))
    if (owned.length === 0) {
      return row
    }
    let yesterdayDelta = { pageViews: 0, termClicks: 0, adClicks: 0 }
    let todayDelta = { pageViews: 0, termClicks: 0, adClicks: 0 }
    for (const articleId of owned) {
      const prev = stats.get(`${articleId}\n${dayBefore}`)
      const curr = stats.get(`${articleId}\n${yesterday}`)
      yesterdayDelta = {
        pageViews: yesterdayDelta.pageViews + wholeCount(prev?.pageViews),
        termClicks: yesterdayDelta.termClicks + wholeCount(prev?.termClicks),
        adClicks: yesterdayDelta.adClicks + wholeCount(prev?.adClicks),
      }
      todayDelta = {
        pageViews: todayDelta.pageViews + wholeCount(curr?.pageViews),
        termClicks: todayDelta.termClicks + wholeCount(curr?.termClicks),
        adClicks: todayDelta.adClicks + wholeCount(curr?.adClicks),
      }
    }
    return {
      ...row,
      yesterday: addStatsToMetrics(row.yesterday, yesterdayDelta),
      today: addStatsToMetrics(row.today, todayDelta),
    }
  })
  commitSnapshot({
    ...snapshot.value,
    refreshedAt: new Date().toISOString(),
    domains: domainsNext,
    requestFailures: (snapshot.value.requestFailures ?? []).filter((item) => item.id !== failure.id),
  })
  ElMessage.success(`曝光批次已并入汇总（${failure.articleIds.length} 篇）`)
}

async function retryFailure(failure: DashboardRequestFailure) {
  if (busy.value || !snapshot.value) {
    return
  }
  if (failure.kind === 'meta') {
    ElMessage.warning('这条是配置数据问题，请改配置后「刷新全部」')
    return
  }
  retryingId.value = failure.id
  progress.value = `重试 ${failure.target}`
  try {
    if (failure.kind === 'config') {
      await retryConfigFailure(failure)
    } else if (failure.kind === 'revenue') {
      await retryRevenueFailure(failure)
    } else if (failure.kind === 'exposure') {
      await retryExposureFailure(failure)
    }
  } catch (error) {
    const message = errorMessage(error)
    commitSnapshot({
      ...snapshot.value,
      refreshedAt: new Date().toISOString(),
      requestFailures: (snapshot.value.requestFailures ?? []).map((item) =>
        item.id === failure.id ? { ...item, message, at: new Date().toISOString() } : item,
      ),
    })
    ElMessage.error(`${failure.target} ${message}`)
  } finally {
    retryingId.value = ''
    progress.value = ''
  }
}

async function retryAllFailures() {
  const items = [...requestFailures.value].filter((item) => item.kind !== 'meta')
  for (const item of items) {
    await retryFailure(item)
  }
}

function failureKindLabel(kind: DashboardRequestFailure['kind']): string {
  if (kind === 'config') {
    return '配置'
  }
  if (kind === 'revenue') {
    return '收入'
  }
  if (kind === 'exposure') {
    return '曝光'
  }
  return '数据'
}

function failureTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString()
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }
  return formatMoney(value)
}

function countText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }
  return String(Math.round(value))
}

function changeText(delta: number | null, rate: number | null, moneyMode = false): string {
  if (delta == null) {
    return '较前天 —'
  }
  const amount = moneyMode ? `${delta > 0 ? '+' : ''}${formatMoney(delta)}` : `${delta > 0 ? '+' : ''}${Math.round(delta)}`
  if (rate == null) {
    return `较前天 ${amount}`
  }
  return `较前天 ${amount}（${rate > 0 ? '+' : ''}${(rate * 100).toFixed(1)}%）`
}

function rateText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }
  return `${(value * 100).toFixed(2)}%`
}

function kpiValue(card: {
  money?: boolean
  rate?: boolean
  curr: number | null
}): string {
  if (card.money) {
    return money(card.curr)
  }
  if (card.rate) {
    return rateText(card.curr)
  }
  return countText(card.curr)
}

function kpiPrev(card: {
  money?: boolean
  rate?: boolean
  prev: number | null
}): string {
  if (card.money) {
    return money(card.prev)
  }
  if (card.rate) {
    return rateText(card.prev)
  }
  return countText(card.prev)
}

function changeClass(delta: number | null): string {
  if (delta == null || delta === 0) {
    return 'flat'
  }
  return delta > 0 ? 'up' : 'down'
}

function refreshedLabel(value: string | undefined): string {
  if (!value) {
    return '尚未刷新'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}
</script>

<template>
  <div class="dashboard">
    <header class="hero">
      <div>
        <p class="eyebrow">完整日环比</p>
        <h3>前天 vs 昨天</h3>
        <p class="hint">
          <template v-if="snapshot">对比 {{ snapshot.yesterday }} → {{ snapshot.today }} · </template>
          两个完整自然日，用来定位总收入掉了多少、哪些域名拖后腿。
        </p>
      </div>
      <div class="hero-actions">
        <span class="meta">上次刷新 {{ refreshedLabel(snapshot?.refreshedAt) }}</span>
        <el-button type="primary" :loading="loading" :disabled="busy && !loading" @click="refresh">刷新全部</el-button>
        <el-button
          v-if="requestFailures.length"
          :loading="Boolean(retryingId)"
          :disabled="busy && !retryingId"
          @click="retryAllFailures"
        >
          重试失败（{{ requestFailures.length }}）
        </el-button>
      </div>
    </header>
    <p v-if="progress" class="progress">{{ progress }}</p>

    <div v-if="!snapshot" class="empty">
      <strong>还没有大盘数据</strong>
      <p>点击「刷新全部」拉取前天和昨天完整日数据。</p>
    </div>

    <template v-else>
      <section v-if="revenueGap.delta != null" class="gap-banner" :class="changeClass(revenueGap.delta)">
        <strong>总收入差 {{ revenueGap.delta > 0 ? '+' : '' }}{{ formatMoney(revenueGap.delta) }}</strong>
        <span>
          前天 {{ money(totals?.yesterday.revenue) }} → 昨天 {{ money(totals?.today.revenue) }}
          <template v-if="revenueGap.rate != null">
            （{{ revenueGap.rate > 0 ? '+' : '' }}{{ (revenueGap.rate * 100).toFixed(1) }}%）
          </template>
        </span>
      </section>

      <section class="kpi-grid">
        <article v-for="card in kpiCards" :key="card.key" class="kpi-card">
          <span class="kpi-label">{{ card.label }}</span>
          <strong class="kpi-value">{{ kpiValue(card) }}</strong>
          <div class="kpi-sub">
            <span>前天 {{ kpiPrev(card) }}</span>
            <em :class="changeClass(card.compare.delta)">{{ changeText(card.compare.delta, card.compare.rate, card.money) }}</em>
          </div>
        </article>
      </section>

      <section class="split">
        <div class="panel">
          <div class="panel-head">
            <h4>收入拖累 Top</h4>
            <span>昨天相对前天掉最多</span>
          </div>
          <p v-if="revenueMovers.down.length === 0" class="empty-inline">暂无下降域名</p>
          <ul v-else class="movers-list">
            <li v-for="row in revenueMovers.down" :key="`down-${row.domain}`">
              <strong>
                {{ row.domain }}
                <em v-if="row.accountName" class="acct">{{ row.accountName }}</em>
                <em v-if="channelIdsText(row.channelIds)" class="channels">{{ channelIdsText(row.channelIds) }}</em>
              </strong>
              <em class="down">{{ changeText(row.revenue.delta, row.revenue.rate, true).replace('较前天 ', '') }}</em>
            </li>
          </ul>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h4>收入上涨 Top</h4>
            <span>昨天相对前天涨最多</span>
          </div>
          <p v-if="revenueMovers.up.length === 0" class="empty-inline">暂无上涨域名</p>
          <ul v-else class="movers-list">
            <li v-for="row in revenueMovers.up" :key="`up-${row.domain}`">
              <strong>
                {{ row.domain }}
                <em v-if="row.accountName" class="acct">{{ row.accountName }}</em>
                <em v-if="channelIdsText(row.channelIds)" class="channels">{{ channelIdsText(row.channelIds) }}</em>
              </strong>
              <em class="up">{{ changeText(row.revenue.delta, row.revenue.rate, true).replace('较前天 ', '') }}</em>
            </li>
          </ul>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h4>收入对比 Top 域名</h4>
          <span>黄=前天 · 蓝=昨天</span>
        </div>
        <p v-if="topRevenueDomains.length === 0" class="empty-inline">暂无收入数据</p>
        <ul v-else class="dual-bars">
          <li v-for="row in topRevenueDomains" :key="row.domain">
            <div class="dual-head">
              <strong>
                {{ row.domain }}
                <em v-if="row.accountName" class="acct">{{ row.accountName }}</em>
                <em v-if="channelIdsText(row.channelIds)" class="channels">{{ channelIdsText(row.channelIds) }}</em>
              </strong>
              <span>前 {{ money(row.yesterday) }} · 昨 {{ money(row.today) }}</span>
            </div>
            <div class="dual-tracks">
              <div class="track"><i class="y" :style="{ width: `${row.yesterdayWidth}%` }" /></div>
              <div class="track"><i class="t" :style="{ width: `${row.todayWidth}%` }" /></div>
            </div>
          </li>
        </ul>
      </section>

      <section class="panel table-panel">
        <div class="panel-head">
          <h4>域名明细（{{ domains.length }}）</h4>
          <span>默认按收入差升序，掉最多的在最上面</span>
        </div>
        <el-table :data="domainCompareRows" size="small" height="480" empty-text="没有可汇总的域名">
          <el-table-column label="域名" min-width="200" fixed>
            <template #default="{ row }">
              <span class="domain-cell">
                {{ row.domain }}
                <em v-if="row.accountName" class="acct">{{ row.accountName }}</em>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="渠道" min-width="140">
            <template #default="{ row }">
              <span class="channels-cell">{{ channelIdsText(row.channelIds) || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="前天收入" width="92" align="right">
            <template #default="{ row }">{{ money(row.yesterday.revenue) }}</template>
          </el-table-column>
          <el-table-column label="昨天收入" width="92" align="right">
            <template #default="{ row }">{{ money(row.today.revenue) }}</template>
          </el-table-column>
          <el-table-column label="收入差" width="110" align="right">
            <template #default="{ row }">
              <span :class="changeClass(row.revenue.delta)">{{ changeText(row.revenue.delta, row.revenue.rate, true).replace('较前天 ', '') }}</span>
            </template>
          </el-table-column>
          <el-table-column label="前天曝光" width="84" align="right">
            <template #default="{ row }">{{ row.yesterday.pageViews }}</template>
          </el-table-column>
          <el-table-column label="昨天曝光" width="84" align="right">
            <template #default="{ row }">{{ row.today.pageViews }}</template>
          </el-table-column>
          <el-table-column label="曝光差" width="100" align="right">
            <template #default="{ row }">
              <span :class="changeClass(row.views.delta)">{{ changeText(row.views.delta, row.views.rate).replace('较前天 ', '') }}</span>
            </template>
          </el-table-column>
          <el-table-column label="前天广点" width="84" align="right">
            <template #default="{ row }">{{ row.yesterday.adClicks }}</template>
          </el-table-column>
          <el-table-column label="昨天广点" width="84" align="right">
            <template #default="{ row }">{{ row.today.adClicks }}</template>
          </el-table-column>
          <el-table-column label="广点差" width="100" align="right">
            <template #default="{ row }">
              <span :class="changeClass(row.ads.delta)">{{ changeText(row.ads.delta, row.ads.rate).replace('较前天 ', '') }}</span>
            </template>
          </el-table-column>
          <el-table-column label="前天广点率" width="96" align="right">
            <template #default="{ row }">{{ rateText(row.prevCtr) }}</template>
          </el-table-column>
          <el-table-column label="昨天广点率" width="96" align="right">
            <template #default="{ row }">{{ rateText(row.currCtr) }}</template>
          </el-table-column>
          <el-table-column label="广点率差" width="100" align="right">
            <template #default="{ row }">
              <span :class="changeClass(row.ctr.delta)">
                <template v-if="row.ctr.delta == null">—</template>
                <template v-else>{{ row.ctr.delta > 0 ? '+' : '' }}{{ (row.ctr.delta * 100).toFixed(2) }}pp</template>
              </span>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section v-if="requestFailures.length" class="request-log">
        <div class="panel-head">
          <h4>请求日志 · 失败 {{ requestFailures.length }}</h4>
          <span>只列失败；重试成功后会并入上方汇总并移出本列表</span>
        </div>
        <ul>
          <li v-for="item in requestFailures" :key="item.id">
            <div class="log-main">
              <em class="log-kind">{{ failureKindLabel(item.kind) }}</em>
              <strong>{{ item.target }}</strong>
              <span class="log-msg">{{ item.message }}</span>
              <span class="log-time">{{ failureTime(item.at) }}</span>
            </div>
            <el-button
              v-if="item.kind !== 'meta'"
              size="small"
              text
              type="primary"
              :loading="retryingId === item.id"
              :disabled="busy && retryingId !== item.id"
              @click="retryFailure(item)"
            >
              重试并入
            </el-button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  display: grid;
  gap: 16px;
  max-width: 1440px;
  margin: 0 auto;
}

.hero {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-end;
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background:
    linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);
}

.eyebrow {
  margin: 0 0 4px;
  color: var(--blue);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

h3,
h4 {
  margin: 0;
}

h3 {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

h4 {
  font-size: 14px;
  font-weight: 650;
}

.hint,
.meta,
.progress,
.empty p,
.empty-inline {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.hero-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.progress {
  margin: 0;
}

.empty {
  padding: 48px 16px;
  border: 1px dashed var(--line);
  border-radius: 16px;
  background: #fff;
  text-align: center;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.gap-banner {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  padding: 14px 18px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #fff;
}

.gap-banner.down {
  border-color: #f3c1bc;
  background: #fff7f6;
}

.gap-banner.up {
  border-color: #b7e0c2;
  background: #f5fbf7;
}

.gap-banner.flat {
  color: inherit;
}

.gap-banner strong {
  font-size: 18px;
  letter-spacing: -0.02em;
}

.gap-banner span {
  color: var(--muted);
  font-size: 13px;
}

.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.movers-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.movers-list li {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: baseline;
}

.movers-list strong {
  font-size: 13px;
}

.movers-list em {
  font-style: normal;
  font-size: 12px;
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .kpi-grid,
  .split {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 720px) {
  .hero,
  .hero-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .kpi-grid,
  .split {
    grid-template-columns: 1fr;
  }
}

.kpi-card,
.panel,
.request-log {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #fff;
}

.kpi-card {
  display: grid;
  gap: 8px;
  padding: 16px;
}

.kpi-label {
  color: var(--muted);
  font-size: 12px;
}

.kpi-value {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.kpi-sub {
  display: grid;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
}

.kpi-sub em,
.dual-head span,
.movers em,
.el-table .up,
.el-table .down,
.el-table .flat {
  font-style: normal;
}

.up {
  color: #17803d;
}

.down {
  color: #b42318;
}

.flat {
  color: var(--muted);
}

.panel {
  padding: 16px;
}

.panel-head {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12px;
}

.panel-head span {
  color: var(--muted);
  font-size: 12px;
}

.dual-bars,
.movers ul {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dual-head,
.movers li {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: baseline;
}

.dual-head strong,
.movers strong,
.domain-cell {
  font-size: 13px;
}

.acct,
.channels {
  margin-left: 6px;
  color: var(--muted);
  font-style: normal;
  font-weight: 500;
  font-size: 12px;
}

.channels,
.channels-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.channels-cell {
  color: var(--muted);
  font-size: 12px;
}

.dual-tracks {
  display: grid;
  gap: 4px;
  margin-top: 6px;
}

.track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: #eef2f7;
}

.track i {
  display: block;
  height: 100%;
  border-radius: 999px;
}

.track .y {
  background: #f0b429;
}

.track .t {
  background: var(--blue);
}

.movers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.mover-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 650;
}

.table-panel {
  overflow: hidden;
}

.request-log {
  padding: 16px;
}

.request-log ul {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.request-log li {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #f3c1bc;
  border-radius: 12px;
  background: #fff7f6;
}

.log-main {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: baseline;
  min-width: 0;
}

.log-kind {
  flex: none;
  padding: 1px 6px;
  border-radius: 6px;
  background: #f8e2df;
  color: #b42318;
  font-style: normal;
  font-size: 11px;
  font-weight: 650;
}

.log-main strong {
  font-size: 13px;
}

.log-msg {
  color: #b42318;
  font-size: 12px;
  line-height: 1.5;
}

.log-time {
  color: var(--muted);
  font-size: 12px;
}
</style>
