<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getArticleDetail,
  getCategoryList,
  getLanguageList,
  getSiteList,
  type CategoryOption,
  type LanguageOption,
  type SiteOption,
} from '../api/article'
import { createArticleJob, getArticleJob, platformUserFromToken } from '../api/articleJobs'
import { errorMessage } from '../api/http'
import { replaceLandpulseOfferResultUrl } from '../api/landpulseOffer'
import {
  compareOpsCenterHourlyLocal,
  listOpsCenterHourlyLocal,
  loadOpsCenterFunnelCatalog,
  loadOpsCenterFunnelDetailLocal,
  loadOpsCenterFunnelOfferDrafts,
  writeOpsCenterFile,
} from '../api/opsCenterLocal'
import { captureOpsCenterHourlySnapshot, syncOpsCenterReport } from '../api/opsCenterSync'
import { articleReady, misReady, ruoyiReady, serviceConfig } from '../config/env'
import { isTerminalJobStatus } from '../domain/articleJobStore'
import { isAllowedBrowseFunnel } from '../domain/funnelBrowseAllowlist'
import {
  draftKey,
  loadFunnelOfferDrafts,
  mergeFunnelOfferDrafts,
  sanitizeDraftJobsRefZeros,
  saveFunnelOfferDrafts,
  upsertFunnelOfferDraft,
  type FunnelOfferDraftJob,
} from '../domain/funnelOfferDraftStore'
import {
  createFunnelOfferReplaceLogItem,
  filterFunnelOfferReplaceLog,
  loadFunnelOfferReplaceLog,
  prependFunnelOfferReplaceLog,
  saveFunnelOfferReplaceLog,
  type FunnelOfferReplaceLogItem,
} from '../domain/funnelOfferReplaceLog'
import {
  buildOfferLandingUrl,
  defaultSeedKeyword,
  matchCategoryIdByName,
  pickOfferJobResult,
  preserveHitPlaceholder,
  regionFromCountry,
  resolveLanguageId,
  resolveOfferSiteTarget,
} from '../domain/funnelOfferGenerate'
import type { FunnelBrowseCatalog, FunnelBrowseDetail } from '../domain/opsCenterBrowse'
import type { HourlyCompareResult, HourlySnapshotMeta } from '../domain/opsCenterHourly'
import type { FunnelSummaryRow, JoinedOffer } from '../domain/opsCenter'
import { shanghaiDay } from '../domain/opsCenterTime'
import { formatMoney } from '../domain/report'

type BrowseMode = 'list' | 'hourly'

const catalog = ref<FunnelBrowseCatalog | null>(null)
const detail = ref<FunnelBrowseDetail | null>(null)
const selectedId = ref('')
const keyword = ref('')
const mode = ref<BrowseMode>('list')
const loading = ref(false)
const syncing = ref(false)
const capturing = ref(false)
const detailLoading = ref(false)
const hourlyLoading = ref(false)
const progress = ref('')

const hourlyDay = ref(shanghaiDay())
const hourlyHours = ref<HourlySnapshotMeta[]>([])
const currentHour = ref('')
const baselineHour = ref('')
const hourlyCompare = ref<HourlyCompareResult | null>(null)

const sites = ref<SiteOption[]>([])
const categories = ref<CategoryOption[]>([])
const languages = ref<LanguageOption[]>([])
const articleMetaReady = ref(false)
const selectedOfferIds = ref<string[]>([])
const selectionByGroup = ref<Record<string, string[]>>({})
const seedByOffer = ref<Record<string, string>>({})
const draftJobs = ref<FunnelOfferDraftJob[]>(loadFunnelOfferDrafts())
const replaceLogs = ref<FunnelOfferReplaceLogItem[]>(loadFunnelOfferReplaceLog())
const replaceLogOpen = ref(false)
const replaceLogQuery = ref('')
const generating = ref(false)
const polling = ref(false)
const replacingOfferId = ref('')
const batchReplacing = ref(false)
const batchPreviewing = ref(false)
let pollTimer = 0
let draftPersistTimer = 0
/** 首次从磁盘 hydrate 完成前禁止回写，避免 localStorage 子集把脚本草稿盖掉 */
let draftPersistReady = false

const visibleReplaceLogs = computed(() =>
  filterFunnelOfferReplaceLog(replaceLogs.value, replaceLogQuery.value),
)

const ready = computed(() => ruoyiReady && misReady)
const generateReady = computed(() => ready.value && articleReady)
const busy = computed(
  () =>
    loading.value ||
    syncing.value ||
    detailLoading.value ||
    capturing.value ||
    hourlyLoading.value ||
    generating.value ||
    batchReplacing.value ||
    batchPreviewing.value ||
    Boolean(replacingOfferId.value),
)

const funnelDrafts = computed(() => {
  const funnelId = detail.value?.funnel.funnelId
  if (!funnelId) {
    return [] as FunnelOfferDraftJob[]
  }
  return draftJobs.value.filter((job) => job.funnelId === funnelId)
})

const draftMap = computed(() => {
  const map = new Map<string, FunnelOfferDraftJob>()
  for (const job of funnelDrafts.value) {
    map.set(job.offerId, job)
  }
  return map
})

const selectedOfferCount = computed(() => selectedOfferIds.value.length)
const runningDraftCount = computed(() => funnelDrafts.value.filter((job) => job.status === 'running').length)
const replaceableDraftCount = computed(() => listReplaceableDrafts(true).length)
const previewableDraftCount = computed(() => listReplaceableDrafts(true).length)

const hourOptions = computed(() =>
  hourlyHours.value.map((item) => ({
    value: item.hour,
    label: `${item.hour}:00 · $${formatMoney(Number(item.totals.revenue) || 0)}`,
  })),
)

const pulledLabel = computed(() => {
  const at = catalog.value?.meta?.pulledAt
  if (!at) {
    return '尚未拉取'
  }
  return new Date(at).toLocaleString('zh-CN', { hour12: false })
})

const filteredFunnels = computed(() => {
  const rows = (catalog.value?.funnels || []).filter((row) => isAllowedBrowseFunnel(row.funnelName))
  const q = keyword.value.trim().toLowerCase()
  if (!q) {
    return rows
  }
  return rows.filter((row) => {
    const hay = [row.funnelName, row.partnerName, row.urlName, row.platform, ...(row.geos || []), ...(row.topCategories || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

onMounted(() => {
  void (async () => {
    await syncDraftJobsFromDisk()
    draftPersistReady = true
    schedulePersistDraftJobs(draftJobs.value)
    await refreshCatalog()
    if (draftJobs.value.some((job) => job.status === 'running')) {
      ensureDraftPoll()
      void pollDraftJobs()
    }
  })()
})

function normalizeIncomingDraft(job: FunnelOfferDraftJob): FunnelOfferDraftJob {
  const newLandingUrl =
    String(job.newLandingUrl || '').trim() ||
    buildOfferLandingUrl(job.oldLandingUrl, job.channelId, job.articleId, job.seedKeyword)
  const status =
    job.status === 'running' || job.status === 'failed' || job.status === 'ready' ? job.status : 'ready'
  return {
    ...job,
    newLandingUrl,
    status,
    note:
      job.note ||
      (newLandingUrl ? '新链已拼好，可预览' : '尚未拼好落地链'),
  }
}

function coerceDraftJobs(remote: unknown[]): FunnelOfferDraftJob[] {
  return remote
    .filter(
      (item): item is FunnelOfferDraftJob =>
        Boolean(
          item &&
            typeof item === 'object' &&
            (item as FunnelOfferDraftJob).key &&
            (item as FunnelOfferDraftJob).taskId,
        ),
    )
    .map(normalizeIncomingDraft)
}

async function persistDraftJobsToDisk(jobs: FunnelOfferDraftJob[]) {
  let merged = jobs
  try {
    const remote = coerceDraftJobs(await loadOpsCenterFunnelOfferDrafts())
    if (remote.length > 0) {
      merged = mergeFunnelOfferDrafts(jobs, remote)
    }
  } catch {
    /* 读盘失败时仍按浏览器状态落盘 */
  }
  await writeOpsCenterFile('funnel-offer-drafts.json', {
    updatedAt: new Date().toISOString(),
    source: 'funnel-browse-panel',
    count: merged.length,
    jobs: merged,
  })
  if (merged.length !== jobs.length || merged.some((job, i) => job.key !== jobs[i]?.key)) {
    draftJobs.value = merged
    saveFunnelOfferDrafts(merged)
  }
}

function schedulePersistDraftJobs(jobs: FunnelOfferDraftJob[]) {
  if (!draftPersistReady) {
    return
  }
  saveFunnelOfferDrafts(jobs)
  if (draftPersistTimer) {
    window.clearTimeout(draftPersistTimer)
  }
  draftPersistTimer = window.setTimeout(() => {
    draftPersistTimer = 0
    void persistDraftJobsToDisk(draftJobs.value).catch(() => {
      /* 磁盘写入失败时仍保留 localStorage */
    })
  }, 400)
}

async function syncDraftJobsFromDisk() {
  try {
    const incoming = coerceDraftJobs(await loadOpsCenterFunnelOfferDrafts())
    if (incoming.length === 0) {
      draftJobs.value = sanitizeDraftJobsRefZeros(draftJobs.value)
      saveFunnelOfferDrafts(draftJobs.value)
      return
    }
    draftJobs.value = sanitizeDraftJobsRefZeros(
      mergeFunnelOfferDrafts(draftJobs.value, incoming),
    )
    // 立刻回写 localStorage，避免页面里仍显示旧 ref，随后又把旧数据持久化回磁盘
    saveFunnelOfferDrafts(draftJobs.value)
  } catch {
    /* ignore disk sync failures */
  }
}

onBeforeUnmount(() => {
  stopDraftPoll()
  if (draftPersistTimer) {
    window.clearTimeout(draftPersistTimer)
    draftPersistTimer = 0
  }
})

watch(hourlyDay, () => {
  if (mode.value === 'hourly') {
    void refreshHourly()
  }
})

watch([currentHour, baselineHour], () => {
  if (mode.value === 'hourly' && currentHour.value) {
    void loadHourlyCompare()
  }
})

watch(
  draftJobs,
  (jobs) => {
    if (!draftPersistReady) {
      return
    }
    schedulePersistDraftJobs(jobs)
  },
  { deep: true },
)

async function refreshCatalog() {
  loading.value = true
  progress.value = '读取本地漏斗总览…'
  try {
    catalog.value = await loadOpsCenterFunnelCatalog()
    if (!hourlyDay.value) {
      hourlyDay.value = catalog.value.primaryDay || shanghaiDay()
    } else if (!catalog.value.primaryDay) {
      hourlyDay.value = shanghaiDay()
    }
    progress.value = `已加载 ${catalog.value.funnelCount} 个漏斗 · 指标日 ${catalog.value.primaryDay}`
  } catch (error) {
    catalog.value = null
    progress.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

async function switchMode(next: BrowseMode) {
  mode.value = next
  detail.value = null
  selectedId.value = ''
  if (next === 'hourly') {
    if (!hourlyDay.value) {
      hourlyDay.value = catalog.value?.primaryDay || shanghaiDay()
    }
    await refreshHourly()
  }
}

async function refreshHourly() {
  if (!hourlyDay.value) {
    return
  }
  hourlyLoading.value = true
  try {
    hourlyHours.value = await listOpsCenterHourlyLocal(hourlyDay.value)
    if (!hourlyHours.value.length) {
      currentHour.value = ''
      baselineHour.value = ''
      hourlyCompare.value = null
      progress.value = `${hourlyDay.value} 还没有小时快照，可点「保存当前小时点」`
      return
    }
    const latest = hourlyHours.value[hourlyHours.value.length - 1]
    currentHour.value = latest.hour
    const prev = hourlyHours.value.length > 1 ? hourlyHours.value[hourlyHours.value.length - 2].hour : ''
    baselineHour.value = prev
    await loadHourlyCompare()
  } catch (error) {
    hourlyHours.value = []
    hourlyCompare.value = null
    ElMessage.error(errorMessage(error))
  } finally {
    hourlyLoading.value = false
  }
}

async function loadHourlyCompare() {
  if (!hourlyDay.value || !currentHour.value) {
    hourlyCompare.value = null
    return
  }
  hourlyLoading.value = true
  try {
    hourlyCompare.value = await compareOpsCenterHourlyLocal({
      day: hourlyDay.value,
      current: currentHour.value,
      baseline: baselineHour.value || null,
    })
    const label = baselineHour.value
      ? `${currentHour.value}:00 vs ${baselineHour.value}:00`
      : `${currentHour.value}:00（无对比基线）`
    progress.value = `小时对比 ${hourlyDay.value} ${label}`
  } catch (error) {
    hourlyCompare.value = null
    ElMessage.error(errorMessage(error))
  } finally {
    hourlyLoading.value = false
  }
}

async function captureHourly() {
  if (!ready.value) {
    ElMessage.error('需要同时配置 VITE_RUOYI_* 与 VITE_MIS_TOKEN，并重启开发服务')
    return
  }
  if (busy.value) {
    return
  }
  capturing.value = true
  progress.value = '开始保存当前小时点…'
  try {
    const snapshot = await captureOpsCenterHourlySnapshot({
      day: hourlyDay.value || shanghaiDay(),
      onProgress: (message) => {
        progress.value = message
      },
    })
    hourlyDay.value = snapshot.day
    await refreshCatalog()
    if (mode.value === 'hourly') {
      await refreshHourly()
    }
    ElMessage.success(`已保存并刷新总览 ${snapshot.day} ${snapshot.hour}:00`)
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    capturing.value = false
  }
}

function deltaText(value: number | null | undefined): string {
  const n = Number(value) || 0
  const abs = money(Math.abs(n))
  if (n > 0) {
    return `+${abs}`
  }
  if (n < 0) {
    return `-${abs}`
  }
  return '0'
}

function deltaClass(value: number | null | undefined): string {
  const n = Number(value) || 0
  if (n > 0) {
    return 'delta-up'
  }
  if (n < 0) {
    return 'delta-down'
  }
  return 'delta-flat'
}

async function syncNow() {
  if (!ready.value) {
    ElMessage.error('需要同时配置 VITE_RUOYI_* 与 VITE_MIS_TOKEN，并重启开发服务')
    return
  }
  if (busy.value) {
    return
  }
  syncing.value = true
  progress.value = '开始拉取漏斗到 data/ops-center …'
  try {
    const report = await syncOpsCenterReport({
      concurrency: 4,
      onProgress: (message) => {
        progress.value = message
      },
    })
    await refreshCatalog()
    progress.value = `已拉取：${report.funnelCount} 漏斗 · ${report.groupCount} 组 · ${report.offerCount} offer`
    ElMessage.success('漏斗数据已写入本地')
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    syncing.value = false
  }
}

async function openFunnel(row: FunnelSummaryRow) {
  if (busy.value) {
    return
  }
  selectedId.value = row.funnelId
  selectedOfferIds.value = []
  selectionByGroup.value = {}
  seedByOffer.value = {}
  detailLoading.value = true
  try {
    detail.value = await loadOpsCenterFunnelDetailLocal(row.funnelId)
    await syncDraftJobsFromDisk()
    initSeedsForDetail()
    if (generateReady.value) {
      void ensureArticleMeta()
    }
  } catch (error) {
    detail.value = null
    ElMessage.error(errorMessage(error))
  } finally {
    detailLoading.value = false
  }
}

function backToList() {
  detail.value = null
  selectedId.value = ''
  selectedOfferIds.value = []
  selectionByGroup.value = {}
  seedByOffer.value = {}
  mode.value = 'list'
}

function onGroupSelectionChange(groupId: string, rows: unknown) {
  const list = Array.isArray(rows) ? (rows as JoinedOffer[]) : []
  selectionByGroup.value = {
    ...selectionByGroup.value,
    [groupId]: list.map((row) => row.offerId),
  }
  selectedOfferIds.value = [...new Set(Object.values(selectionByGroup.value).flat())]
}

function initSeedsForDetail() {
  if (!detail.value) {
    return
  }
  const next = { ...seedByOffer.value }
  for (const group of detail.value.groups) {
    for (const offer of group.offers) {
      if (!next[offer.offerId]) {
        next[offer.offerId] = defaultSeedKeyword({
          categoryName: offer.categoryName,
          offerName: offer.offerName,
        })
      }
    }
  }
  seedByOffer.value = next
}

async function ensureArticleMeta() {
  if (articleMetaReady.value || !articleReady) {
    return
  }
  try {
    const [siteList, categoryList, languageList] = await Promise.all([
      getSiteList(),
      getCategoryList(),
      getLanguageList(),
    ])
    sites.value = siteList
    categories.value = categoryList
    languages.value = languageList
    articleMetaReady.value = true
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
}

function offerDraft(offerId: string): FunnelOfferDraftJob | undefined {
  return draftMap.value.get(offerId)
}

function draftStatusText(status: FunnelOfferDraftJob['status']): string {
  if (status === 'running') {
    return '生成中'
  }
  if (status === 'ready') {
    return '已就绪'
  }
  return '失败'
}

function patchDraft(key: string, patch: Partial<FunnelOfferDraftJob>) {
  draftJobs.value = draftJobs.value.map((job) =>
    job.key === key ? { ...job, ...patch, updatedAt: new Date().toISOString() } : job,
  )
}

function ensureDraftPoll() {
  if (pollTimer) {
    return
  }
  pollTimer = window.setInterval(() => {
    void pollDraftJobs()
  }, 5000)
}

function stopDraftPoll() {
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = 0
  }
}

function stopDraftPollIfIdle() {
  if (!draftJobs.value.some((job) => job.status === 'running')) {
    stopDraftPoll()
  }
}

async function languageIdForLanding(landingUrl: string): Promise<number> {
  const target = resolveOfferSiteTarget(sites.value, landingUrl)
  if (target?.articleId) {
    try {
      const article = await getArticleDetail(target.articleId)
      const fromDetail = resolveLanguageId(languages.value, article.langId)
      if (fromDetail != null) {
        return fromDetail
      }
    } catch {
      /* fall through */
    }
  }
  const fallback = resolveLanguageId(languages.value, null)
  if (fallback == null) {
    throw new Error('无法确定语言')
  }
  return fallback
}

function countryForOffer(offer: JoinedOffer): string {
  return String(offer.countryCode || offer.geo || detail.value?.funnel.geos?.[0] || '').trim()
}

async function pollDraftJobs(options: { manual?: boolean } = {}) {
  const running = draftJobs.value.filter((job) => job.status === 'running')
  if (running.length === 0) {
    stopDraftPollIfIdle()
    return
  }
  if (polling.value) {
    return
  }
  polling.value = true
  try {
    for (const job of running) {
      try {
        const jobDetail = await getArticleJob(job.taskId)
        if (!isTerminalJobStatus(jobDetail.status)) {
          const p = jobDetail.progress
          patchDraft(job.key, {
            note: p ? `生成中 ${p.success}/${p.total}` : `状态 ${jobDetail.status}`,
          })
          continue
        }
        if (String(jobDetail.status) === 'failed') {
          patchDraft(job.key, {
            status: 'failed',
            note: jobDetail.error_message || '生成失败',
          })
          continue
        }
        const host = resolveOfferSiteTarget(sites.value, job.oldLandingUrl)?.domain || ''
        const result = pickOfferJobResult(jobDetail.results, host)
        if (!result) {
          patchDraft(job.key, {
            status: 'failed',
            note: jobDetail.error_message || '生成结束但没有成功草稿',
          })
          continue
        }
        const newLandingUrl = result.articleId
          ? buildOfferLandingUrl(job.oldLandingUrl, job.channelId, result.articleId, job.seedKeyword)
          : null
        patchDraft(job.key, {
          status: 'ready',
          itemId: result.id,
          articleId: result.articleId,
          newLandingUrl,
          note: newLandingUrl
            ? `新链已拼好（article_id ${result.articleId}），可预览`
            : result.articleId
              ? `已有 article_id ${result.articleId}，但无法拼链`
              : '编排结束但没有 article_id，暂不可预览落地链',
        })
      } catch (error) {
        patchDraft(job.key, {
          note: `轮询暂时失败：${errorMessage(error)}`,
        })
        if (options.manual) {
          ElMessage.warning(`${job.offerName}：${errorMessage(error)}`)
        }
      }
    }
  } finally {
    polling.value = false
    stopDraftPollIfIdle()
  }
}

function refreshDrafts() {
  ensureDraftPoll()
  void pollDraftJobs({ manual: true })
}

function previewLandingUrl(job: FunnelOfferDraftJob): string | null {
  const existing = String(job.newLandingUrl || '').trim()
  if (existing) {
    return preserveHitPlaceholder(existing)
  }
  return buildOfferLandingUrl(job.oldLandingUrl, job.channelId, job.articleId, job.seedKeyword)
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/** @returns 是否成功打开标签；弹窗被拦时返回 false */
function openOfferLandingPreview(job: FunnelOfferDraftJob, quiet = false): boolean {
  const url = previewLandingUrl(job)
  if (!url) {
    if (!quiet) {
      ElMessage.warning('还没有拼好的落地链（需要 article_id）')
    }
    return false
  }
  if (!job.newLandingUrl) {
    patchDraft(job.key, { newLandingUrl: url })
  }
  // 不用 noopener 特性串，否则部分浏览器 window.open 恒为 null，无法判断弹窗拦截
  const win = window.open(url, '_blank')
  if (!win) {
    if (!quiet) {
      ElMessage.warning('浏览器拦截了弹窗，请允许本站弹窗后重试')
    }
    return false
  }
  try {
    win.opener = null
  } catch {
    // ignore
  }
  return true
}

async function previewAllOfferLandings() {
  if (batchPreviewing.value || busy.value) {
    return
  }
  const jobs = listReplaceableDrafts(true)
  if (jobs.length === 0) {
    ElMessage.warning(
      selectedOfferIds.value.length
        ? '所选 offer 里没有可预览项（需要新文章 id 和新落地链）'
        : '当前漏斗没有可预览项（需要新文章 id 和新落地链）',
    )
    return
  }
  batchPreviewing.value = true
  let opened = 0
  let blocked = false
  try {
    ElMessage.info(`将打开 ${jobs.length} 个预览标签`)
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index]
      progress.value = `一键预览 ${index + 1}/${jobs.length} · ${job.offerName}`
      const ok = openOfferLandingPreview(job, true)
      if (!ok) {
        blocked = true
        break
      }
      opened += 1
      if (index < jobs.length - 1) {
        await sleep(200)
      }
    }
    if (blocked) {
      progress.value = `一键预览中断：已打开 ${opened}/${jobs.length}（弹窗被拦）`
      ElMessage.warning(
        opened > 0
          ? `已打开 ${opened}/${jobs.length} 个标签，后续被浏览器拦截；请允许本站弹窗后重试`
          : '浏览器拦截了弹窗，请允许本站弹窗后重试',
      )
    } else {
      progress.value = `一键预览完成：已打开 ${opened} 个标签`
      ElMessage.success(`已打开 ${opened} 个预览标签`)
    }
  } finally {
    batchPreviewing.value = false
  }
}

async function persistReplaceLogs(next: FunnelOfferReplaceLogItem[]) {
  replaceLogs.value = next
  saveFunnelOfferReplaceLog(next)
  try {
    await writeOpsCenterFile('offer-replace-log.json', {
      updatedAt: new Date().toISOString(),
      count: next.length,
      records: next,
    })
  } catch {
    // 本地落盘失败不影响主流程，浏览器里仍可看
  }
}

async function appendReplaceLog(
  draft: Omit<FunnelOfferReplaceLogItem, 'id' | 'createdAt'>,
): Promise<void> {
  const record = createFunnelOfferReplaceLogItem(draft)
  await persistReplaceLogs(prependFunnelOfferReplaceLog(replaceLogs.value, record))
}

function formatReplaceLogTime(createdAt: number): string {
  const date = new Date(createdAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

async function copyReplaceLogText(text: string) {
  if (!text) {
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

async function clearReplaceLogs() {
  await persistReplaceLogs([])
  ElMessage.success('已清空替换日志')
}

function listReplaceableDrafts(onlySelected = false): FunnelOfferDraftJob[] {
  const selected = new Set(selectedOfferIds.value)
  return funnelDrafts.value.filter((job) => {
    if (onlySelected && selected.size > 0 && !selected.has(job.offerId)) {
      return false
    }
    if (!String(job.articleId || '').trim()) {
      return false
    }
    return Boolean(previewLandingUrl(job))
  })
}

async function replaceOfferLandingCore(
  job: FunnelOfferDraftJob,
): Promise<{ ok: boolean; message: string }> {
  const nextResultUrl = previewLandingUrl(job)
  if (!nextResultUrl) {
    return { ok: false, message: '还没有新落地链，无法替换' }
  }
  const articleId = String(job.articleId || '').trim()
  if (!articleId) {
    return { ok: false, message: '缺少新文章 id，无法改写 offer.url' }
  }
  try {
    const updated = await replaceLandpulseOfferResultUrl(job.offerId, nextResultUrl, {
      articleId,
      ref: job.seedKeyword,
    })
    await appendReplaceLog({
      funnelId: job.funnelId,
      funnelName: job.funnelName,
      offerId: job.offerId,
      offerName: job.offerName,
      channelId: job.channelId,
      articleId,
      ref: job.seedKeyword || '',
      oldUrl: job.oldLandingUrl,
      newUrl: updated.url || null,
      resultUrl: updated.resultUrl || nextResultUrl,
      ok: true,
      message: '替换成功',
    })
    // 已写入 offer：漏斗详情里清掉新落地链/状态，只留替换日志可查
    draftJobs.value = draftJobs.value.filter((row) => row.offerId !== job.offerId)
    saveFunnelOfferDrafts(draftJobs.value)
    return { ok: true, message: `已更新 ${job.offerName}` }
  } catch (error) {
    const message = errorMessage(error)
    await appendReplaceLog({
      funnelId: job.funnelId,
      funnelName: job.funnelName,
      offerId: job.offerId,
      offerName: job.offerName,
      channelId: job.channelId,
      articleId,
      ref: job.seedKeyword || '',
      oldUrl: job.oldLandingUrl,
      newUrl: null,
      resultUrl: nextResultUrl,
      ok: false,
      message,
    })
    return { ok: false, message }
  }
}

async function replaceOfferLanding(job: FunnelOfferDraftJob) {
  if (replacingOfferId.value || busy.value) {
    return
  }
  if (!misReady) {
    ElMessage.error('需要配置 VITE_MIS_* 后才能更新 offer')
    return
  }
  replacingOfferId.value = job.offerId
  progress.value = `更新 offer ${job.offerName}…`
  try {
    const result = await replaceOfferLandingCore(job)
    if (result.ok) {
      ElMessage.success(`${result.message}：新链已写入；详情列已清除，可在替换日志查看`)
    } else {
      ElMessage.error(result.message)
    }
    progress.value = result.message
  } finally {
    replacingOfferId.value = ''
  }
}

async function replaceAllOfferLandings() {
  if (batchReplacing.value || busy.value) {
    return
  }
  if (!misReady) {
    ElMessage.error('需要配置 VITE_MIS_* 后才能更新 offer')
    return
  }
  const jobs = listReplaceableDrafts(true)
  if (jobs.length === 0) {
    ElMessage.warning(
      selectedOfferIds.value.length
        ? '所选 offer 里没有可替换项（需要新文章 id 和新落地链）'
        : '当前漏斗没有可替换项（需要新文章 id 和新落地链）',
    )
    return
  }
  batchReplacing.value = true
  let success = 0
  let failed = 0
  try {
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index]
      replacingOfferId.value = job.offerId
      progress.value = `一键替换 ${index + 1}/${jobs.length} · ${job.offerName}`
      const result = await replaceOfferLandingCore(job)
      if (result.ok) {
        success += 1
      } else {
        failed += 1
      }
    }
    progress.value = `一键替换完成：成功 ${success} · 失败 ${failed}`
    if (failed === 0) {
      ElMessage.success(`一键替换完成：${success} 个 offer`)
    } else {
      ElMessage.warning(`一键替换结束：成功 ${success} · 失败 ${failed}，可看替换日志`)
    }
  } finally {
    replacingOfferId.value = ''
    batchReplacing.value = false
  }
}

async function generateSelectedOffers() {
  if (generating.value || !detail.value) {
    return
  }
  if (!generateReady.value) {
    ElMessage.error('需要配置文章 API（VITE_ARTICLE_*）以及运营中心依赖后重启')
    return
  }
  const selected = detail.value.groups
    .flatMap((group) => group.offers.map((offer) => ({ group, offer })))
    .filter(({ offer }) => selectedOfferIds.value.includes(offer.offerId))
  if (selected.length === 0) {
    ElMessage.warning('先勾选要生成文章的 offer')
    return
  }

  generating.value = true
  progress.value = '准备批量生成…'
  try {
    await ensureArticleMeta()
    if (!articleMetaReady.value) {
      throw new Error('站点/品类元数据未加载成功')
    }
    const missingSeed = selected.filter(({ offer }) => !String(seedByOffer.value[offer.offerId] || '').trim())
    if (missingSeed.length > 0) {
      ElMessage.warning(`还有 ${missingSeed.length} 个 offer 没填种子词`)
      return
    }

    const user = platformUserFromToken(serviceConfig.articleToken)
    const stamp = Date.now()
    const funnel = detail.value.funnel
    let success = 0
    const failures: string[] = []

    for (const [index, { group, offer }] of selected.entries()) {
      progress.value = `创建任务 ${index + 1}/${selected.length}：${offer.offerName}`
      const key = draftKey(funnel.funnelId, offer.offerId)
      try {
        if (draftJobs.value.some((job) => job.key === key && job.status === 'running')) {
          failures.push(`${offer.offerName}：已有进行中的任务`)
          continue
        }
        if (!offer.landingUrl) {
          throw new Error('缺少落地页 URL')
        }
        const target = resolveOfferSiteTarget(sites.value, offer.landingUrl)
        if (!target) {
          throw new Error('无法根据落地链匹配站点/账号')
        }
        const seed = String(seedByOffer.value[offer.offerId] || '').trim()
        const regionId =
          regionFromCountry(countryForOffer(offer)) ||
          regionFromCountry(group.geo) ||
          regionFromCountry(funnel.geos?.[0])
        if (!regionId) {
          throw new Error('没有可用国家/地区码')
        }
        const languageId = await languageIdForLanding(offer.landingUrl)
        const categoryId = matchCategoryIdByName(categories.value, offer.categoryName) ?? undefined
        const jobDetail = await createArticleJob({
          intentKeyword: seed,
          categoryId,
          languageId,
          regionId,
          userId: user.userId,
          userName: user.userName,
          targets: [
            {
              domain: target.domain,
              site_id: target.siteId,
              account_id: target.accountId,
            },
          ],
          publish: true,
          articlesPerDomain: 1,
          idempotencyKey: `funnel-offer-${stamp}-${key}-${Math.random().toString(36).slice(2, 10)}`,
        })
        const taskId = String(jobDetail.task_id || '').trim()
        if (!taskId) {
          throw new Error('未返回 task_id')
        }
        const nextJob: FunnelOfferDraftJob = {
          key,
          funnelId: funnel.funnelId,
          funnelName: funnel.funnelName,
          offerId: offer.offerId,
          offerName: offer.offerName,
          groupId: group.groupId,
          groupName: group.groupName,
          oldLandingUrl: offer.landingUrl,
          channelId: offer.channelId || null,
          categoryName: offer.categoryName || null,
          seedKeyword: seed,
          taskId,
          status: 'running',
          note: `已创建编排任务 · publish=true · ${regionId}`,
          updatedAt: new Date().toISOString(),
        }
        draftJobs.value = upsertFunnelOfferDraft(draftJobs.value, nextJob)
        success += 1
      } catch (error) {
        failures.push(`${offer.offerName}：${errorMessage(error)}`)
      }
    }

    if (success > 0) {
      ensureDraftPoll()
      void pollDraftJobs()
      ElMessage.success(`已为 ${success} 个 offer 创建草稿任务，完成后可预览 / 替换`)
    }
    if (failures.length > 0) {
      progress.value = failures.slice(0, 3).join('；')
      if (success === 0) {
        ElMessage.error(failures[0] || '批量生成失败')
      } else {
        ElMessage.warning(`${failures.length} 个失败，见进度条`)
      }
    }
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    generating.value = false
  }
}

function money(value: number | null | undefined): string {
  return formatMoney(Number(value) || 0)
}

function int(value: number | null | undefined): string {
  return String(Math.round(Number(value) || 0))
}

const metricTips = {
  ctr: 'CTR：漏斗点击率。漏斗点击 ÷ 漏斗展示，来自 MIS flatStats 的 funnelCtr。',
  rpm: 'RPM：千次展示收入。按漏斗展示折算的收入效率，来自 funnelRpm。',
  rpc: 'RPC：单次点击收入。每次广告点击带来的收入，来自 rpc。',
  cvr1: 'CVR1：一阶转化率。MIS flatStats 返回的 cvr1，通常看访问到转化的效率。',
  cvr2: 'CVR2：二阶转化率。MIS flatStats 返回的 cvr2，通常看点击到转化的效率。',
  ctrAvg: 'CTR均：该漏斗下各 offer 的 funnelCtr 平均值。',
  rpmAvg: 'RPM均：该漏斗下各 offer 的 funnelRpm 平均值。',
} as const
</script>

<template>
  <div class="funnel-browse">
    <section class="toolbar card">
      <div class="toolbar-copy">
        <h2>{{ detail ? detail.funnel.funnelName : mode === 'hourly' ? '小时对比' : '漏斗总览' }}</h2>
        <p>
          上次拉取：{{ pulledLabel }}
          <template v-if="catalog?.primaryDay"> · 指标日 {{ catalog.primaryDay }}</template>
          · 开发服务运行中会整点自动拍小时点（也可手动保存）
        </p>
        <p v-if="progress" class="progress">{{ progress }}</p>
      </div>
      <div class="toolbar-actions">
        <el-button v-if="detail" :disabled="busy" @click="backToList">返回总览</el-button>
        <template v-if="!detail">
          <el-radio-group :model-value="mode" size="small" :disabled="busy" @change="switchMode($event as BrowseMode)">
            <el-radio-button value="list">漏斗列表</el-radio-button>
            <el-radio-button value="hourly">小时对比</el-radio-button>
          </el-radio-group>
        </template>
        <template v-if="detail">
          <el-button
            type="primary"
            :loading="generating"
            :disabled="!generateReady || busy || selectedOfferCount === 0"
            @click="generateSelectedOffers"
          >
            批量生成文章{{ selectedOfferCount ? `（${selectedOfferCount}）` : '' }}
          </el-button>
          <el-button :loading="polling" :disabled="runningDraftCount === 0" @click="refreshDrafts">
            刷新生成状态{{ runningDraftCount ? `（${runningDraftCount}）` : '' }}
          </el-button>
          <el-button
            :loading="batchPreviewing"
            :disabled="busy || previewableDraftCount === 0"
            @click="previewAllOfferLandings"
          >
            一键预览{{ previewableDraftCount ? `（${previewableDraftCount}）` : '' }}
          </el-button>
          <el-button
            type="warning"
            :loading="batchReplacing"
            :disabled="!misReady || busy || replaceableDraftCount === 0"
            @click="replaceAllOfferLandings"
          >
            一键替换{{ replaceableDraftCount ? `（${replaceableDraftCount}）` : '' }}
          </el-button>
        </template>
        <el-button @click="replaceLogOpen = true">
          替换日志{{ replaceLogs.length ? `（${replaceLogs.length}）` : '' }}
        </el-button>
        <el-button :loading="loading" :disabled="busy" @click="refreshCatalog">刷新本地</el-button>
        <el-button :loading="capturing" :disabled="!ready || busy" @click="captureHourly">
          保存当前小时点
        </el-button>
        <el-button type="primary" :loading="syncing" :disabled="!ready || busy" @click="syncNow">
          拉取漏斗数据
        </el-button>
      </div>
    </section>

    <el-alert
      v-if="!ready"
      type="warning"
      :closable="false"
      title="运营中心依赖未齐全"
      description="需要 VITE_RUOYI_API_TARGET / VITE_RUOYI_TOKEN，以及 VITE_MIS_API_TARGET / VITE_MIS_TOKEN / VITE_MIS_CLIENT_ID。改完后重启 npm run dev。"
      class="block"
    />

    <div v-if="detail" class="browse-body browse-body--scroll">
      <section class="kpi-grid">
        <div class="kpi card">
          <span>收入</span>
          <strong>${{ money(detail.funnel.revenue) }}</strong>
        </div>
        <div class="kpi card">
          <span>访问 / 浏览</span>
          <strong>{{ int(detail.funnel.visits) }} / {{ int(detail.funnel.views) }}</strong>
        </div>
        <div class="kpi card">
          <span>展示 / 点击</span>
          <strong>{{ int(detail.funnel.funnelImpressions) }} / {{ int(detail.funnel.funnelClicks) }}</strong>
        </div>
        <div class="kpi card">
          <span>转化 / 广告点</span>
          <strong>{{ int(detail.funnel.conversion) }} / {{ int(detail.funnel.clicks) }}</strong>
        </div>
        <div class="kpi card">
          <span>组 / offer</span>
          <strong>{{ detail.funnel.groupCount }} / {{ detail.funnel.offerCount }}</strong>
        </div>
        <div class="kpi card">
          <span>对齐 flatStats</span>
          <strong>{{ detail.funnel.matchedStats }} / {{ detail.funnel.offerCount }}</strong>
        </div>
      </section>

      <section class="card meta-line">
        <span>合作方 {{ detail.funnel.partnerName || '—' }}</span>
        <span>链接 {{ detail.funnel.urlName || '—' }}</span>
        <span>平台 {{ detail.funnel.platform || '—' }}</span>
        <span>国家 {{ detail.funnel.geos.join('、') || '—' }}</span>
        <span>头部品类 {{ detail.funnel.topCategories.join('、') || '—' }}</span>
        <span>草稿任务 {{ funnelDrafts.length }}（进行中 {{ runningDraftCount }}）</span>
      </section>

      <el-alert
        v-if="!generateReady"
        type="info"
        :closable="false"
        class="block"
        title="批量生成需要文章 API"
        description="配置 VITE_ARTICLE_API_TARGET / VITE_ARTICLE_TOKEN 后重启。生成后可预览新链；替换时 resultUrl 写整链，url 只替换原链接里的文章 id 与 ref。"
      />

      <section v-for="group in detail.groups" :key="group.groupId" class="card group-card">
        <div class="group-head">
          <div>
            <h3>{{ group.groupName }}</h3>
            <p>
              {{ group.geo || '默认' }} · {{ group.routing || '—' }} · offer {{ group.offerCount }} · 对齐
              {{ group.matchedStats }} · 昨收 ${{ money(group.yesterdayRev) }} · 昨 RPM {{ money(group.yesterdayRpm) }}
            </p>
          </div>
          <div class="group-metrics">
            <span>收 ${{ money(group.revenue) }}</span>
            <span>访 {{ int(group.visits) }}</span>
            <span>转 {{ int(group.conversion) }}</span>
            <span>漏点 {{ int(group.funnelClicks) }}</span>
          </div>
        </div>

        <el-table
          :data="group.offers"
          size="small"
          stripe
          row-key="offerId"
          @selection-change="(rows) => onGroupSelectionChange(group.groupId, rows)"
        >
          <el-table-column type="selection" width="42" :selectable="() => Boolean(generateReady && !busy)" />
          <el-table-column prop="offerName" label="offer" min-width="160" show-overflow-tooltip />
          <el-table-column prop="categoryName" label="品类" min-width="100">
            <template #default="{ row }">{{ row.categoryName || '—' }}</template>
          </el-table-column>
          <el-table-column label="种子词" min-width="140">
            <template #default="{ row }">
              <el-input
                v-model="seedByOffer[row.offerId]"
                size="small"
                clearable
                placeholder="生成种子词"
                :disabled="busy || !generateReady"
              />
            </template>
          </el-table-column>
          <el-table-column prop="channelId" label="渠道" width="90">
            <template #default="{ row }">{{ row.channelId || '—' }}</template>
          </el-table-column>
          <el-table-column prop="afsSource" label="source" width="70">
            <template #default="{ row }">{{ row.afsSource || '—' }}</template>
          </el-table-column>
          <el-table-column label="权重" width="70" align="right">
            <template #default="{ row }">{{ row.weight ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="今收" width="80" align="right">
            <template #default="{ row }">${{ money(row.todayRev) }}</template>
          </el-table-column>
          <el-table-column label="收入" width="90" align="right">
            <template #default="{ row }">${{ money(row.revenue) }}</template>
          </el-table-column>
          <el-table-column label="访问" width="80" align="right">
            <template #default="{ row }">{{ int(row.visits) }}</template>
          </el-table-column>
          <el-table-column label="转化" width="70" align="right">
            <template #default="{ row }">{{ int(row.conversion) }}</template>
          </el-table-column>
          <el-table-column label="展示" width="80" align="right">
            <template #default="{ row }">{{ int(row.funnelImpressions) }}</template>
          </el-table-column>
          <el-table-column label="漏点" width="80" align="right">
            <template #default="{ row }">{{ int(row.funnelClicks) }}</template>
          </el-table-column>
          <el-table-column label="广告点" width="80" align="right">
            <template #default="{ row }">{{ int(row.clicks) }}</template>
          </el-table-column>
          <el-table-column width="78" align="right">
            <template #header>
              <el-tooltip :content="metricTips.ctr" placement="top">
                <span class="metric-head">CTR</span>
              </el-tooltip>
            </template>
            <template #default="{ row }">{{ money(row.funnelCtr) }}</template>
          </el-table-column>
          <el-table-column width="78" align="right">
            <template #header>
              <el-tooltip :content="metricTips.rpm" placement="top">
                <span class="metric-head">RPM</span>
              </el-tooltip>
            </template>
            <template #default="{ row }">{{ money(row.funnelRpm) }}</template>
          </el-table-column>
          <el-table-column width="78" align="right">
            <template #header>
              <el-tooltip :content="metricTips.rpc" placement="top">
                <span class="metric-head">RPC</span>
              </el-tooltip>
            </template>
            <template #default="{ row }">{{ money(row.rpc) }}</template>
          </el-table-column>
          <el-table-column width="78" align="right">
            <template #header>
              <el-tooltip :content="metricTips.cvr1" placement="top">
                <span class="metric-head">CVR1</span>
              </el-tooltip>
            </template>
            <template #default="{ row }">{{ money(row.cvr1) }}</template>
          </el-table-column>
          <el-table-column width="78" align="right">
            <template #header>
              <el-tooltip :content="metricTips.cvr2" placement="top">
                <span class="metric-head">CVR2</span>
              </el-tooltip>
            </template>
            <template #default="{ row }">{{ money(row.cvr2) }}</template>
          </el-table-column>
          <el-table-column label="URL" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <a v-if="row.landingUrl" :href="row.landingUrl" target="_blank" rel="noopener noreferrer" @click.stop>
                {{ row.landingUrl }}
              </a>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column label="对齐" width="70" align="center">
            <template #default="{ row }">{{ row.hasFlatStats ? '是' : '否' }}</template>
          </el-table-column>
          <el-table-column label="新落地链" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <template v-if="offerDraft(row.offerId) && previewLandingUrl(offerDraft(row.offerId)!)">
                <a
                  :href="previewLandingUrl(offerDraft(row.offerId)!)!"
                  target="_blank"
                  rel="noopener noreferrer"
                  @click.stop
                >
                  {{ previewLandingUrl(offerDraft(row.offerId)!) }}
                </a>
              </template>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="196" fixed="right" class-name="col-status">
            <template #default="{ row }">
              <template v-if="offerDraft(row.offerId)">
                <div class="draft-cell">
                  <el-tag
                    size="small"
                    effect="light"
                    class="draft-tag"
                    :type="
                      offerDraft(row.offerId)!.status === 'ready'
                        ? 'success'
                        : offerDraft(row.offerId)!.status === 'failed'
                          ? 'danger'
                          : 'warning'
                    "
                  >
                    {{ draftStatusText(offerDraft(row.offerId)!.status) }}
                  </el-tag>
                  <span class="draft-note" :title="offerDraft(row.offerId)!.note || ''">
                    {{ offerDraft(row.offerId)!.note || '—' }}
                  </span>
                </div>
              </template>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="128" fixed="right" class-name="col-actions">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button
                  size="small"
                  link
                  type="primary"
                  :disabled="!offerDraft(row.offerId) || !previewLandingUrl(offerDraft(row.offerId)!)"
                  @click="openOfferLandingPreview(offerDraft(row.offerId)!)"
                >
                  预览
                </el-button>
                <el-button
                  size="small"
                  link
                  type="warning"
                  :loading="replacingOfferId === row.offerId"
                  :disabled="
                    !misReady ||
                    busy ||
                    !offerDraft(row.offerId) ||
                    !previewLandingUrl(offerDraft(row.offerId)!)
                  "
                  @click="replaceOfferLanding(offerDraft(row.offerId)!)"
                >
                  替换
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </div>

    <div v-else-if="mode === 'hourly'" class="browse-body browse-body--fill">
      <section class="card hourly-tools">
        <el-date-picker
          v-model="hourlyDay"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="日期"
          :clearable="false"
          :disabled="busy"
          style="width: 160px"
        />
        <el-select v-model="currentHour" placeholder="当前小时" :disabled="busy || !hourOptions.length" style="width: 180px">
          <el-option v-for="item in hourOptions" :key="`c-${item.value}`" :label="item.label" :value="item.value" />
        </el-select>
        <span class="hourly-vs">对比</span>
        <el-select
          v-model="baselineHour"
          clearable
          placeholder="上一小时（可空）"
          :disabled="busy || !hourOptions.length"
          style="width: 180px"
        >
          <el-option v-for="item in hourOptions" :key="`b-${item.value}`" :label="item.label" :value="item.value" />
        </el-select>
        <el-button :loading="hourlyLoading" :disabled="busy" @click="refreshHourly">刷新对比</el-button>
      </section>

      <template v-if="hourlyCompare">
        <section class="kpi-grid kpi-grid--compact">
          <div class="kpi card">
            <span>收入累计 / 增量</span>
            <strong>${{ money(hourlyCompare.totals.revenue) }}</strong>
            <em :class="deltaClass(hourlyCompare.totals.revenueDelta)">{{ deltaText(hourlyCompare.totals.revenueDelta) }}</em>
          </div>
          <div class="kpi card">
            <span>访问累计 / 增量</span>
            <strong>{{ int(hourlyCompare.totals.visits) }}</strong>
            <em :class="deltaClass(hourlyCompare.totals.visitsDelta)">{{ deltaText(hourlyCompare.totals.visitsDelta) }}</em>
          </div>
          <div class="kpi card">
            <span>转化累计 / 增量</span>
            <strong>{{ int(hourlyCompare.totals.conversion) }}</strong>
            <em :class="deltaClass(hourlyCompare.totals.conversionDelta)">{{ deltaText(hourlyCompare.totals.conversionDelta) }}</em>
          </div>
          <div class="kpi card">
            <span>漏点累计 / 增量</span>
            <strong>{{ int(hourlyCompare.totals.funnelClicks) }}</strong>
            <em :class="deltaClass(hourlyCompare.totals.funnelClicksDelta)">{{ deltaText(hourlyCompare.totals.funnelClicksDelta) }}</em>
          </div>
        </section>

        <section class="card list-card">
          <div class="list-tools">
            <h3>漏斗增量（相对 {{ hourlyCompare.baselineHour ? `${hourlyCompare.baselineHour}:00` : '无基线' }}）</h3>
          </div>
          <div class="table-fill">
            <el-table :data="hourlyCompare.funnels" size="small" stripe height="100%" row-key="funnelId">
              <el-table-column prop="funnelName" label="漏斗" min-width="160" />
              <el-table-column prop="partnerName" label="合作方" width="110">
                <template #default="{ row }">{{ row.partnerName || '—' }}</template>
              </el-table-column>
              <el-table-column label="收入" width="90" align="right">
                <template #default="{ row }">${{ money(row.revenue) }}</template>
              </el-table-column>
              <el-table-column label="收入Δ" width="90" align="right">
                <template #default="{ row }">
                  <span :class="deltaClass(row.revenueDelta)">{{ deltaText(row.revenueDelta) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="访问" width="80" align="right">
                <template #default="{ row }">{{ int(row.visits) }}</template>
              </el-table-column>
              <el-table-column label="访问Δ" width="80" align="right">
                <template #default="{ row }">
                  <span :class="deltaClass(row.visitsDelta)">{{ deltaText(row.visitsDelta) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="转化Δ" width="80" align="right">
                <template #default="{ row }">
                  <span :class="deltaClass(row.conversionDelta)">{{ deltaText(row.conversionDelta) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="展示Δ" width="80" align="right">
                <template #default="{ row }">
                  <span :class="deltaClass(row.funnelImpressionsDelta)">{{ deltaText(row.funnelImpressionsDelta) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="漏点Δ" width="80" align="right">
                <template #default="{ row }">
                  <span :class="deltaClass(row.funnelClicksDelta)">{{ deltaText(row.funnelClicksDelta) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="广告点Δ" width="90" align="right">
                <template #default="{ row }">
                  <span :class="deltaClass(row.clicksDelta)">{{ deltaText(row.clicksDelta) }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>
      </template>

      <el-empty v-else class="browse-empty" description="还没有可对比的小时快照，先点「保存当前小时点」" />
    </div>

    <div v-else-if="catalog" class="browse-body browse-body--fill">
      <section class="kpi-grid kpi-grid--compact">
        <div class="kpi card">
          <span>漏斗</span>
          <strong>{{ filteredFunnels.length }}</strong>
        </div>
        <div class="kpi card">
          <span>页面组</span>
          <strong>{{ catalog.groupCount }}</strong>
        </div>
        <div class="kpi card">
          <span>offer</span>
          <strong>{{ catalog.offerCount }}</strong>
        </div>
        <div class="kpi card">
          <span>对齐 flatStats</span>
          <strong>{{ catalog.matchedOfferCount }} / {{ catalog.offerCount }}</strong>
        </div>
      </section>

      <section class="card list-card">
        <div class="list-tools">
          <h3>全部漏斗</h3>
          <el-input v-model="keyword" clearable placeholder="搜索漏斗 / 合作方 / 链接 / 品类" style="max-width: 280px" />
        </div>
        <div class="table-fill">
          <el-table
            :data="filteredFunnels"
            size="small"
            stripe
            highlight-current-row
            :current-row-key="selectedId"
            row-key="funnelId"
            height="100%"
            class="funnel-table"
            @row-click="openFunnel"
          >
          <el-table-column prop="funnelName" label="漏斗" min-width="160" />
          <el-table-column prop="partnerName" label="合作方" width="120">
            <template #default="{ row }">{{ row.partnerName || '—' }}</template>
          </el-table-column>
          <el-table-column prop="urlName" label="链接" min-width="120">
            <template #default="{ row }">{{ row.urlName || '—' }}</template>
          </el-table-column>
          <el-table-column label="组/offer" width="90" align="right">
            <template #default="{ row }">{{ row.groupCount }}/{{ row.offerCount }}</template>
          </el-table-column>
          <el-table-column label="对齐" width="80" align="right">
            <template #default="{ row }">{{ row.matchedStats }}/{{ row.offerCount }}</template>
          </el-table-column>
          <el-table-column label="收入" width="90" align="right">
            <template #default="{ row }">${{ money(row.revenue) }}</template>
          </el-table-column>
          <el-table-column label="访问" width="80" align="right">
            <template #default="{ row }">{{ int(row.visits) }}</template>
          </el-table-column>
          <el-table-column label="转化" width="70" align="right">
            <template #default="{ row }">{{ int(row.conversion) }}</template>
          </el-table-column>
          <el-table-column label="展示" width="80" align="right">
            <template #default="{ row }">{{ int(row.funnelImpressions) }}</template>
          </el-table-column>
          <el-table-column label="漏点" width="80" align="right">
            <template #default="{ row }">{{ int(row.funnelClicks) }}</template>
          </el-table-column>
          <el-table-column label="广告点" width="80" align="right">
            <template #default="{ row }">{{ int(row.clicks) }}</template>
          </el-table-column>
          <el-table-column width="78" align="right">
            <template #header>
              <el-tooltip :content="metricTips.ctrAvg" placement="top">
                <span class="metric-head">CTR均</span>
              </el-tooltip>
            </template>
            <template #default="{ row }">{{ money(row.funnelCtrAvg) }}</template>
          </el-table-column>
          <el-table-column width="78" align="right">
            <template #header>
              <el-tooltip :content="metricTips.rpmAvg" placement="top">
                <span class="metric-head">RPM均</span>
              </el-tooltip>
            </template>
            <template #default="{ row }">{{ money(row.funnelRpmAvg) }}</template>
          </el-table-column>
          <el-table-column label="国家" min-width="120">
            <template #default="{ row }">{{ row.geos.join('、') || '—' }}</template>
          </el-table-column>
          <el-table-column label="头部品类" min-width="160">
            <template #default="{ row }">{{ row.topCategories.join('、') || '—' }}</template>
          </el-table-column>
          </el-table>
        </div>
      </section>
    </div>

    <el-empty v-else class="browse-empty" description="还没有本地漏斗数据，点击「拉取漏斗数据」" />

    <el-drawer v-model="replaceLogOpen" title="Offer 替换日志" size="92%" append-to-body>
      <div class="replace-log-toolbar">
        <el-input v-model="replaceLogQuery" clearable placeholder="搜漏斗、offer、文章 id、ref、链接或结果" />
        <span>{{ visibleReplaceLogs.length }} / {{ replaceLogs.length }}</span>
        <el-button :disabled="replaceLogs.length === 0" @click="clearReplaceLogs">清空</el-button>
      </div>
      <el-table :data="visibleReplaceLogs" height="calc(100vh - 150px)" stripe empty-text="还没有替换记录">
        <el-table-column label="时间" width="168">
          <template #default="{ row }">{{ formatReplaceLogTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="funnelName" label="漏斗" min-width="120" show-overflow-tooltip />
        <el-table-column prop="offerName" label="offer" min-width="140" show-overflow-tooltip />
        <el-table-column prop="articleId" label="新文章 ID" width="130" show-overflow-tooltip />
        <el-table-column prop="ref" label="ref" min-width="140" show-overflow-tooltip />
        <el-table-column prop="channelId" label="渠道" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.channelId || '—' }}</template>
        </el-table-column>
        <el-table-column label="原 url" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="link-cell">
              <span>{{ row.oldUrl || '—' }}</span>
              <el-button v-if="row.oldUrl" link type="primary" @click="copyReplaceLogText(row.oldUrl)">复制</el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="新 url" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="link-cell">
              <span>{{ row.newUrl || '—' }}</span>
              <el-button v-if="row.newUrl" link type="primary" @click="copyReplaceLogText(row.newUrl)">复制</el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="resultUrl" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="link-cell">
              <span>{{ row.resultUrl || '—' }}</span>
              <el-button v-if="row.resultUrl" link type="primary" @click="copyReplaceLogText(row.resultUrl)">复制</el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="140" fixed="right">
          <template #default="{ row }">
            <span :class="row.ok ? 'log-ok' : 'log-bad'">{{ row.ok ? '成功' : row.message || '失败' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<style scoped>
.funnel-browse {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
}

.toolbar {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.browse-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.browse-body--fill {
  overflow: hidden;
}

.browse-body--scroll {
  overflow: auto;
}

.list-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.table-fill {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.browse-empty {
  flex: 1;
}

.toolbar-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.toolbar h2,
.card h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}

.toolbar p,
.progress,
.group-head p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.progress {
  color: #1d4ed8;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.block {
  flex: 0 0 auto;
  border-radius: 12px;
}

.kpi-grid {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.kpi-grid--compact {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.kpi {
  display: grid;
  gap: 8px;
}

.kpi span {
  color: var(--muted);
  font-size: 13px;
}

.kpi strong {
  font-size: 22px;
  font-weight: 700;
}

.kpi em {
  font-style: normal;
  font-size: 13px;
  font-weight: 650;
}

.hourly-tools {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.hourly-vs {
  color: var(--muted);
  font-size: 13px;
}

.delta-up {
  color: #15803d;
}

.delta-down {
  color: #b91c1c;
}

.delta-flat {
  color: var(--muted);
}

.meta-line {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  color: #374151;
  font-size: 13px;
}

.list-tools {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.funnel-table {
  cursor: pointer;
}

.metric-head {
  border-bottom: 1px dashed #9ca3af;
  cursor: help;
}

.group-card {
  flex: 0 0 auto;
  display: grid;
  gap: 12px;
}

.group-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.group-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: #1f2937;
  font-size: 13px;
  font-weight: 600;
}

.draft-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.draft-tag {
  flex: 0 0 auto;
}

.draft-note {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.muted {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.row-actions {
  display: flex;
  gap: 2px;
  align-items: center;
  justify-content: flex-end;
}

.replace-log-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.replace-log-toolbar .el-input {
  flex: 1;
}

.replace-log-toolbar span {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 13px;
}

.link-cell {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.link-cell span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-ok {
  color: #15803d;
  font-weight: 650;
}

.log-bad {
  color: #b91c1c;
  font-weight: 650;
}

:deep(.col-status),
:deep(.col-actions) {
  background: #fff;
}

:deep(.el-table__body tr.hover-row > td.col-status),
:deep(.el-table__body tr.hover-row > td.col-actions),
:deep(.el-table__body tr:hover > td.col-status),
:deep(.el-table__body tr:hover > td.col-actions) {
  background: var(--el-table-row-hover-bg-color, #f5f7fa);
}

@media (max-width: 1100px) {
  .kpi-grid,
  .kpi-grid--compact {
    grid-template-columns: 1fr 1fr;
  }

  .toolbar,
  .group-head,
  .list-tools {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
