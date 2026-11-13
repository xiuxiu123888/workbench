<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { TableInstance } from 'element-plus'
import { getArticleDetail, getLanguageList, getSiteList, type LanguageOption, type SiteOption } from '../api/article'
import { createArticleJob, getArticleJob, platformUserFromToken } from '../api/articleJobs'
import { errorMessage } from '../api/http'
import { getLandpulseOfferById, replaceLandpulseOfferResultUrl } from '../api/landpulseOffer'
import {
  loadOpsCenterFunnelOfferDrafts,
  loadOpsCenterOfferIndex,
  loadOpsCenterReportLocal,
  loadSeedLexicon,
  writeOpsCenterFile,
} from '../api/opsCenterLocal'
import { loadOpsCenterReport } from '../domain/opsCenter'
import { articleReady, misReady, serviceConfig } from '../config/env'
import { isTerminalJobStatus } from '../domain/articleJobStore'
import { assignSeedsToOffers, type OfferSeedAssignment } from '../domain/offerSeedAssign'
import type { OfferIndexRow } from '../domain/offerIndex'
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
  loadFunnelOfferReplaceLog,
  prependFunnelOfferReplaceLog,
  saveFunnelOfferReplaceLog,
  type FunnelOfferReplaceLogItem,
} from '../domain/funnelOfferReplaceLog'
import {
  buildOfferLandingUrl,
  pickOfferJobResult,
  regionFromCountry,
  resolveLanguageId,
  resolveOfferSiteTarget,
} from '../domain/funnelOfferGenerate'
import {
  listSeedRegions,
  listSeedsForCategories,
  type SeedLexiconFile,
  type SeedLexiconItem,
} from '../domain/offerSeedLexicon'

type SeedRow = SeedLexiconItem & { categoryKey: string; categoryId?: number | null; rowKey: string }

type RunRow = {
  offerId: string
  offerName: string
  keyword: string
  status: 'pending' | 'running' | 'ready' | 'written' | 'failed'
  note: string
  articleId?: string
  newLandingUrl?: string | null
}

const route = useRoute()
const router = useRouter()
const offerTableRef = ref<TableInstance>()
const seedTableRef = ref<TableInstance>()
const loading = ref(false)
const generating = ref(false)
const writingBack = ref(false)
const previewing = ref(false)
const polling = ref(false)
const importingAdvice = ref(false)
const offers = ref<OfferIndexRow[]>([])
const rawOfferRows = ref(0)
const uniqueOfferCount = ref(0)
const offerKeyword = ref('')
const funnelFilter = ref<string[]>([])
const selectedOfferIds = ref<string[]>([])
const lexicon = ref<SeedLexiconFile>({ updatedAt: '', categories: [] })
const seedCategoryFilter = ref<string[]>([])
const seedRegionFilter = ref<string[]>([])
const selectedSeedKeys = ref<string[]>([])
const assignments = ref<OfferSeedAssignment<SeedRow>[]>([])
const runRows = ref<RunRow[]>([])
const draftJobs = ref<FunnelOfferDraftJob[]>(loadFunnelOfferDrafts())
const replaceLogs = ref<FunnelOfferReplaceLogItem[]>(loadFunnelOfferReplaceLog())
const sites = ref<SiteOption[]>([])
const languages = ref<LanguageOption[]>([])
const progress = ref('')
const importBanner = ref('')
/** 预览/写回默认只处理当前词库关键词（避免旧草稿 400+ 条一起写） */
const scopeToCurrentLexicon = ref(true)
let pollTimer = 0
/** 程序勾选表格时忽略 selection-change，避免把刚导入的选择清空 */
let suppressSelectionEvents = false

const runningDraftCount = computed(() => draftJobs.value.filter((job) => job.status === 'running').length)

const generateReady = computed(() => articleReady && misReady)
const canGenerate = computed(
  () => generateReady.value && !generating.value && !writingBack.value && assignments.value.length > 0,
)

const currentLexiconKeywords = computed(() => {
  const set = new Set<string>()
  for (const cat of lexicon.value.categories) {
    for (const seed of cat.seeds) {
      const k = String(seed.keyword || '').trim().toLowerCase()
      if (k) set.add(k)
    }
  }
  return set
})

function inWriteScope(row: RunRow): boolean {
  if (!scopeToCurrentLexicon.value) return true
  const kw = String(row.keyword || '').trim().toLowerCase()
  return currentLexiconKeywords.value.has(kw)
}

const previewableRows = computed(() =>
  runRows.value.filter(
    (row) =>
      inWriteScope(row) &&
      (row.status === 'ready' || row.status === 'written' || Boolean(row.newLandingUrl)),
  ),
)
const writeableRows = computed(() =>
  runRows.value.filter(
    (row) =>
      inWriteScope(row) &&
      (row.status === 'ready' || row.status === 'written') &&
      Boolean(row.newLandingUrl) &&
      Boolean(row.articleId),
  ),
)
const pendingWriteRows = computed(() => writeableRows.value.filter((row) => row.status === 'ready'))

const funnelFilterOptions = computed(() => {
  const names = new Set<string>()
  for (const offer of offers.value) {
    for (const name of offer.funnelNames) {
      if (name) names.add(name)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
})

const categoryOptions = computed(() =>
  lexicon.value.categories.map((row) => ({
    value: row.categoryKey,
    label: `${row.categoryKey}（${row.seeds.length}）`,
  })),
)

const regionOptions = computed(() =>
  listSeedRegions(lexicon.value).map((code) => ({
    value: code,
    label: code,
  })),
)

const visibleOffers = computed(() => {
  const q = offerKeyword.value.trim().toLowerCase()
  const funnels = new Set(funnelFilter.value)
  return offers.value.filter((row) => {
    if (funnels.size > 0 && !row.funnelNames.some((name) => funnels.has(name))) {
      return false
    }
    if (!q) {
      return true
    }
    return (
      row.offerName.toLowerCase().includes(q) ||
      row.offerId.toLowerCase().includes(q) ||
      row.funnelNames.some((name) => name.toLowerCase().includes(q))
    )
  })
})

const seedRows = computed<SeedRow[]>(() => {
  const keys = seedCategoryFilter.value.length ? seedCategoryFilter.value : null
  const regions = seedRegionFilter.value.length ? seedRegionFilter.value : null
  return listSeedsForCategories(lexicon.value, keys, regions).map((row) => ({
    ...row,
    rowKey: `${row.categoryKey}::${String(row.regionId || '').toUpperCase()}::${row.keyword}`,
  }))
})

const selectedOffers = computed(() =>
  offers.value.filter((row) => selectedOfferIds.value.includes(row.offerId)),
)

const selectedSeeds = computed(() =>
  seedRows.value.filter((row) => selectedSeedKeys.value.includes(row.rowKey)),
)

const lexiconStats = computed(() => {
  const seedCount = lexicon.value.categories.reduce((sum, row) => sum + row.seeds.length, 0)
  return {
    categoryCount: lexicon.value.categories.length,
    seedCount,
    updatedAt: lexicon.value.updatedAt || '—',
  }
})

function hydrateRunRowsFromDrafts(jobs: FunnelOfferDraftJob[]): RunRow[] {
  const sorted = [...jobs].sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
  )
  const map = new Map<string, RunRow>()
  for (const job of sorted) {
    const offerId = String(job.offerId || '').trim()
    if (!offerId || map.has(offerId)) {
      continue
    }
    const status: RunRow['status'] =
      job.status === 'running' ? 'running' : job.status === 'failed' ? 'failed' : 'ready'
    map.set(offerId, {
      offerId,
      offerName: job.offerName || offerId,
      keyword: job.seedKeyword || '',
      status,
      note: job.note || '',
      articleId: job.articleId,
      newLandingUrl: job.newLandingUrl,
    })
  }
  return [...map.values()]
}

function syncRunRowsFromDrafts() {
  runRows.value = hydrateRunRowsFromDrafts(draftJobs.value)
}

async function clearOrchestrationRecords() {
  if (generating.value || writingBack.value) {
    ElMessage.warning('创编或替换进行中，先等结束再清空')
    return
  }
  const count = draftJobs.value.length
  if (count === 0 && runRows.value.length === 0) {
    ElMessage.info('当前没有创编记录')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将清空 ${count || runRows.value.length} 条编排草稿/创编记录（漏斗详情里的「新落地链」也会一起消失）。替换日志不会删。`,
      '清空创编记录',
      { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = 0
  }
  await persistDrafts([])
  runRows.value = []
  progress.value = '已清空创编记录'
  ElMessage.success('创编记录已清空')
}

async function persistDrafts(next: FunnelOfferDraftJob[]) {
  draftJobs.value = next
  saveFunnelOfferDrafts(next)
  syncRunRowsFromDrafts()
  try {
    await writeOpsCenterFile('funnel-offer-drafts.json', {
      updatedAt: new Date().toISOString(),
      source: 'offer-seed-workbench',
      count: next.length,
      jobs: next,
    })
  } catch {
    // 磁盘写失败不阻断主流程
  }
}

function ensureDraftPoll() {
  if (pollTimer) {
    return
  }
  pollTimer = window.setInterval(() => {
    void pollRunningDrafts()
  }, 8000)
}

function stopDraftPollIfIdle() {
  if (draftJobs.value.some((job) => job.status === 'running')) {
    return
  }
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = 0
  }
}

function applyJobDetailToDrafts(
  jobs: FunnelOfferDraftJob[],
  offerId: string,
  taskId: string,
  host: string,
  detail: Awaited<ReturnType<typeof getArticleJob>>,
): FunnelOfferDraftJob[] {
  const updatedAt = new Date().toISOString()
  if (!isTerminalJobStatus(detail.status)) {
    const p = detail.progress
    const note = p ? `生成中 ${p.success}/${p.total}` : `状态 ${detail.status}`
    return jobs.map((job) =>
      job.offerId === offerId && job.taskId === taskId ? { ...job, note, updatedAt } : job,
    )
  }
  if (String(detail.status) === 'failed') {
    const note = detail.error_message || '生成失败'
    return jobs.map((job) =>
      job.offerId === offerId && job.taskId === taskId
        ? { ...job, status: 'failed' as const, note, updatedAt }
        : job,
    )
  }
  const result = pickOfferJobResult(detail.results, host)
  const articleId = String(result?.articleId || '').trim()
  if (!result?.id || !articleId) {
    const note = detail.error_message || '生成结束但没有 article_id（publish=true 应直接返回）'
    return jobs.map((job) =>
      job.offerId === offerId && job.taskId === taskId
        ? { ...job, status: 'failed' as const, note, updatedAt }
        : job,
    )
  }
  const related = jobs.filter((job) => job.offerId === offerId && job.taskId === taskId)
  const seedKeyword = related[0]?.seedKeyword || ''
  let next = jobs
  for (const job of related) {
    const newLandingUrl = buildOfferLandingUrl(job.oldLandingUrl, job.channelId, articleId, seedKeyword)
    next = upsertFunnelOfferDraft(next, {
      ...job,
      itemId: result.id,
      articleId,
      newLandingUrl,
      status: 'ready',
      note: newLandingUrl
        ? `已就绪，可预览/替换 · ${articleId}`
        : `已有 article_id ${articleId}，但无法拼链`,
      updatedAt,
    })
  }
  return next
}

async function pollRunningDrafts(options: { manual?: boolean } = {}) {
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
    await ensureArticleMeta()
    const seen = new Set<string>()
    const jobs: FunnelOfferDraftJob[] = []
    for (const job of running) {
      const key = `${job.offerId}:${job.taskId}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      jobs.push(job)
    }

    // 并行拉状态，再串行合并落盘，避免互相覆盖
    const fetched = await Promise.all(
      jobs.map(async (job) => {
        try {
          const host = resolveOfferSiteTarget(sites.value, job.oldLandingUrl)?.domain || ''
          const detail = await getArticleJob(job.taskId)
          return { job, host, detail, error: null as string | null }
        } catch (error) {
          return { job, host: '', detail: null, error: errorMessage(error) }
        }
      }),
    )

    let next = draftJobs.value
    for (const item of fetched) {
      if (item.error || !item.detail) {
        if (options.manual) {
          ElMessage.warning(`${item.job.offerName}：${item.error || '轮询失败'}`)
        }
        continue
      }
      next = applyJobDetailToDrafts(next, item.job.offerId, item.job.taskId, item.host, item.detail)
    }
    await persistDrafts(next)

    const left = next.filter((job) => job.status === 'running').length
    const ready = next.filter((job) => job.status === 'ready').length
    progress.value = left
      ? `批量轮询中：进行中 ${left} · 已就绪 ${ready}`
      : `批量轮询完成：已就绪 ${ready}，可预览后替换`
  } finally {
    polling.value = false
    stopDraftPollIfIdle()
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
    // 本地落盘失败不影响主流程
  }
}

async function appendReplaceLog(
  draft: Omit<FunnelOfferReplaceLogItem, 'id' | 'createdAt'>,
): Promise<void> {
  const record = createFunnelOfferReplaceLogItem(draft)
  await persistReplaceLogs(prependFunnelOfferReplaceLog(replaceLogs.value, record))
}

function funnelPairsForOffer(offer: OfferIndexRow): { funnelId: string; funnelName: string }[] {
  const ids = (offer.funnelIds || []).map((id) => String(id || '').trim()).filter(Boolean)
  const names = offer.funnelNames || []
  if (ids.length === 0) {
    const fallbackId = String(offer.funnelId || 'offer').trim() || 'offer'
    const fallbackName = String(offer.funnelName || fallbackId).trim() || fallbackId
    return [{ funnelId: fallbackId, funnelName: fallbackName }]
  }
  return ids.map((funnelId, index) => ({
    funnelId,
    funnelName: String(names[index] || names[0] || funnelId).trim() || funnelId,
  }))
}

async function ensureArticleMeta() {
  if (sites.value.length && languages.value.length) {
    return
  }
  const [siteList, languageList] = await Promise.all([getSiteList(), getLanguageList()])
  sites.value = siteList
  languages.value = languageList
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function resolveLanguageIdForLanding(landingUrl: string): Promise<number> {
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

async function bootstrap() {
  loading.value = true
  progress.value = '加载词库与 offer 库…'
  try {
    const [{ lexicon: nextLexicon }, index, remoteDrafts] = await Promise.all([
      loadSeedLexicon(),
      loadOpsCenterOfferIndex(),
      loadOpsCenterFunnelOfferDrafts()
        .then((rows) => ({ ok: true as const, rows }))
        .catch(() => ({ ok: false as const, rows: [] as unknown[] })),
    ])
    lexicon.value = nextLexicon
    offers.value = index.offers
    rawOfferRows.value = index.rawOfferRows
    uniqueOfferCount.value = index.uniqueOfferCount
    if (remoteDrafts.ok && remoteDrafts.rows.length === 0) {
      // 磁盘已清空时以磁盘为准，避免浏览器旧草稿把记录「复活」
      draftJobs.value = []
      saveFunnelOfferDrafts([])
    } else {
      draftJobs.value = sanitizeDraftJobsRefZeros(
        mergeFunnelOfferDrafts(
          loadFunnelOfferDrafts(),
          remoteDrafts.rows.filter(
            (item): item is FunnelOfferDraftJob =>
              Boolean(item && typeof item === 'object' && (item as FunnelOfferDraftJob).key),
          ),
        ),
      )
      saveFunnelOfferDrafts(draftJobs.value)
    }
    syncRunRowsFromDrafts()
    selectedOfferIds.value = []
    assignments.value = []
    const running = runningDraftCount.value
    progress.value = `唯一 offer ${index.uniqueOfferCount}（白名单行 ${index.rawOfferRows}）· 词库 ${lexiconStats.value.categoryCount} 品类 / ${lexiconStats.value.seedCount} 词 · 编排记录 ${runRows.value.length}${running ? `（进行中 ${running}）` : ''}`
    if (running > 0) {
      ensureDraftPoll()
      void pollRunningDrafts()
    }
  } catch (error) {
    ElMessage.error(errorMessage(error))
    progress.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

function onOfferSelectionChange(rows: OfferIndexRow[]) {
  if (suppressSelectionEvents) return
  selectedOfferIds.value = rows.map((row) => row.offerId)
  assignments.value = []
  importBanner.value = ''
}

function onSeedSelectionChange(rows: SeedRow[]) {
  if (suppressSelectionEvents) return
  selectedSeedKeys.value = rows.map((row) => row.rowKey)
  assignments.value = []
  importBanner.value = ''
}

/** 用选中 offer 的 geo 映射成词库 region，快速滤国家 */
function filterSeedsBySelectedOfferGeo() {
  if (selectedOfferIds.value.length === 0) {
    ElMessage.warning('先勾选 offer')
    return
  }
  const regions = [
    ...new Set(
      selectedOffers.value
        .map((row) => regionFromCountry(row.geo) || String(row.geo || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  ]
  if (regions.length === 0) {
    ElMessage.info('选中 offer 没有可用 geo/国家，未改国家筛选')
    return
  }
  seedRegionFilter.value = regions
  ElMessage.success(`已按选中 offer 国家过滤词库：${regions.join('、')}`)
}

function reshuffleAssignments() {
  try {
    assignments.value = assignSeedsToOffers(selectedOffers.value, selectedSeeds.value)
    progress.value = `已分配 ${assignments.value.length} 条（每个 offer 一个词）`
  } catch (error) {
    assignments.value = []
    ElMessage.warning(errorMessage(error))
  }
}

async function syncTableSelection() {
  suppressSelectionEvents = true
  try {
    await nextTick()
    offerTableRef.value?.clearSelection()
    seedTableRef.value?.clearSelection()
    for (const row of visibleOffers.value) {
      if (selectedOfferIds.value.includes(row.offerId)) {
        offerTableRef.value?.toggleRowSelection(row, true)
      }
    }
    for (const row of seedRows.value) {
      if (selectedSeedKeys.value.includes(row.rowKey)) {
        seedTableRef.value?.toggleRowSelection(row, true)
      }
    }
    await nextTick()
  } finally {
    suppressSelectionEvents = false
  }
}

/** 从漏斗分析「待换 offer」导入，并用当前词库全部词随机分配 */
async function importFromReplaceAdvice(options?: { silentEmpty?: boolean }) {
  importingAdvice.value = true
  importBanner.value = ''
  try {
    let report = await loadOpsCenterReportLocal()
    if (!report) {
      report = loadOpsCenterReport()
    }
    const advice = (report?.replaceAdvice || []).filter(
      (row) => !/default/i.test(String(row.offerName || '')),
    )
    if (!advice.length) {
      if (!options?.silentEmpty) {
        ElMessage.warning('分析报告里没有待换 offer（已排除 default），先去漏斗分析同步/重算')
      }
      return false
    }
    const wanted = [...new Set(advice.map((row) => String(row.offerId || '').trim()).filter(Boolean))]
    // 清空筛选，避免导入后表格看不见勾选
    offerKeyword.value = ''
    funnelFilter.value = []
    seedCategoryFilter.value = []
    seedRegionFilter.value = []
    await nextTick()

    const matched = offers.value.filter(
      (row) => wanted.includes(row.offerId) && !/default/i.test(row.offerName || ''),
    )
    if (!matched.length) {
      ElMessage.warning(
        `待换 ${wanted.length} 个 offer 不在当前白名单去重库（或全是 default）。请先在漏斗总览拉取白名单数据。`,
      )
      return false
    }
    if (!seedRows.value.length) {
      ElMessage.warning('当前词库没有可用种子词（应有 4 个美妆词，点刷新重载词库）')
      return false
    }
    selectedOfferIds.value = matched.map((row) => row.offerId)
    selectedSeedKeys.value = seedRows.value.map((row) => row.rowKey)
    await syncTableSelection()
    reshuffleAssignments()
    if (!assignments.value.length) {
      ElMessage.warning('随机分配失败，请再点「随机分配预览」')
      return false
    }
    const seedNames = [...new Set(assignments.value.map((row) => row.seed.keyword))]
    importBanner.value = `已导入待换 ${matched.length} 个 offer（分析 ${wanted.length}）· 词库 ${selectedSeedKeys.value.length} 词随机分配：${seedNames.join(' / ')} · 请往下看「3. 分配预览」`
    progress.value = importBanner.value
    ElMessage.success(importBanner.value)
    await nextTick()
    document.getElementById('offer-seed-assignments')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return true
  } catch (error) {
    ElMessage.error(errorMessage(error))
    return false
  } finally {
    importingAdvice.value = false
  }
}

function patchRunRow(offerId: string, patch: Partial<RunRow>) {
  const exists = runRows.value.some((row) => row.offerId === offerId)
  if (!exists) {
    runRows.value = [
      {
        offerId,
        offerName: offerId,
        keyword: '',
        status: 'pending',
        note: '',
        ...patch,
      },
      ...runRows.value,
    ]
    return
  }
  runRows.value = runRows.value.map((row) => (row.offerId === offerId ? { ...row, ...patch } : row))
}

async function generateFromAssignments() {
  if (!canGenerate.value) {
    if (!generateReady.value) {
      ElMessage.error('需要配置文章 API（VITE_ARTICLE_*）与 MIS 后重启')
    } else if (assignments.value.length === 0) {
      ElMessage.warning('先完成随机分配预览')
    }
    return
  }

  generating.value = true
  for (const row of assignments.value) {
    const offer = selectedOffers.value.find((item) => item.offerId === row.offerId)
    patchRunRow(row.offerId, {
      offerId: row.offerId,
      offerName: offer?.offerName || row.offerId,
      keyword: row.seed.keyword,
      status: 'pending',
      note: '排队创建中',
      articleId: undefined,
      newLandingUrl: null,
    })
  }

  let created = 0
  let failed = 0
  const failures: string[] = []

  try {
    await ensureArticleMeta()
    const user = platformUserFromToken(serviceConfig.articleToken)
    const stamp = Date.now()

    // 1) 批量发起编排（不等待单个任务完成）
    for (let index = 0; index < assignments.value.length; index += 1) {
      const assignment = assignments.value[index]
      const offer = selectedOffers.value.find((item) => item.offerId === assignment.offerId)
      if (!offer) {
        failed += 1
        failures.push(`${assignment.offerId}：找不到 offer`)
        patchRunRow(assignment.offerId, { status: 'failed', note: '找不到 offer' })
        continue
      }

      progress.value = `批量发起 ${index + 1}/${assignments.value.length} · ${offer.offerName}`
      patchRunRow(assignment.offerId, {
        status: 'running',
        note: '准备发起',
        offerName: offer.offerName,
        keyword: assignment.seed.keyword,
      })

      try {
        if (
          draftJobs.value.some(
            (job) => job.offerId === offer.offerId && job.status === 'running',
          )
        ) {
          throw new Error('已有进行中的编排任务')
        }

        let oldLandingUrl = String(offer.landingUrl || '').trim()
        let channelId = String(offer.channelId || '').trim()
        if (!oldLandingUrl || !channelId) {
          const detail = await getLandpulseOfferById(offer.offerId)
          oldLandingUrl = String(detail.resultUrl || detail.url || oldLandingUrl).trim()
          if (!channelId) {
            try {
              channelId = new URL(oldLandingUrl).searchParams.get('channel') || ''
            } catch {
              channelId = String(detail.sourceChannelId || '').trim()
            }
          }
        }
        if (!oldLandingUrl) {
          throw new Error('缺少落地页 URL')
        }
        if (!channelId) {
          throw new Error('缺少 channelId')
        }

        const target = resolveOfferSiteTarget(sites.value, oldLandingUrl)
        if (!target) {
          throw new Error('无法根据落地链匹配站点/账号')
        }

        const regionId =
          String(assignment.seed.regionId || '').trim() ||
          regionFromCountry(offer.geo) ||
          regionFromCountry(offer.countryCode)
        if (!regionId) {
          throw new Error('种子或 offer 都没有可用国家/地区')
        }

        const categoryId =
          assignment.seed.categoryId != null && Number(assignment.seed.categoryId) > 0
            ? Number(assignment.seed.categoryId)
            : undefined
        if (!categoryId) {
          throw new Error(`词「${assignment.seed.keyword}」缺少文章类目 id，请检查词库 categoryId`)
        }

        const languageId = await resolveLanguageIdForLanding(oldLandingUrl)
        const funnelPairs = funnelPairsForOffer(offer)

        const jobDetail = await createArticleJob({
          intentKeyword: assignment.seed.intentKeyword || assignment.seed.keyword,
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
          idempotencyKey: `offer-seed-${stamp}-${offer.offerId}-${Math.random().toString(36).slice(2, 8)}`,
        })
        const taskId = String(jobDetail.task_id || '').trim()
        if (!taskId) {
          throw new Error('未返回 task_id')
        }

        let nextDrafts = draftJobs.value
        const updatedAt = new Date().toISOString()
        for (const pair of funnelPairs) {
          nextDrafts = upsertFunnelOfferDraft(nextDrafts, {
            key: draftKey(pair.funnelId, offer.offerId),
            funnelId: pair.funnelId,
            funnelName: pair.funnelName,
            offerId: offer.offerId,
            offerName: offer.offerName,
            groupId: offer.groupId,
            groupName: offer.groupName,
            oldLandingUrl,
            channelId,
            categoryName: assignment.seed.categoryKey,
            seedKeyword: assignment.seed.keyword,
            taskId,
            status: 'running',
            note: `已发起 ${taskId} · 等待批量轮询`,
            updatedAt,
          })
        }
        await persistDrafts(nextDrafts)
        created += 1
        patchRunRow(assignment.offerId, {
          status: 'running',
          note: `已发起 ${taskId} · 批量轮询中`,
        })
      } catch (error) {
        failed += 1
        const message = errorMessage(error)
        failures.push(`${offer.offerName}：${message}`)
        patchRunRow(assignment.offerId, {
          status: 'failed',
          note: message,
        })
      }
    }

    // 2) 统一轮询：已发起的任务并行查结果，不串行等完再开下一个
    if (created > 0) {
      ensureDraftPoll()
      void pollRunningDrafts()
      progress.value = `已批量发起 ${created} 个编排${failed ? `，失败 ${failed}` : ''}；后台轮询结果中`
      ElMessage.success(`已批量发起 ${created} 个编排（publish=true），完成后可预览 / 替换`)
    }
    if (failed > 0) {
      progress.value = failures.slice(0, 3).join('；')
      if (created === 0) {
        ElMessage.error(failures[0] || '批量发起失败')
      } else {
        ElMessage.warning(`${failed} 个发起失败，其余已在轮询`)
      }
    }
  } catch (error) {
    ElMessage.error(errorMessage(error))
    progress.value = errorMessage(error)
  } finally {
    generating.value = false
    stopDraftPollIfIdle()
  }
}

function openLanding(url: string | null | undefined) {
  const next = String(url || '').trim()
  if (!next) {
    return
  }
  const win = window.open(next, '_blank')
  if (win) {
    try {
      win.opener = null
    } catch {
      // ignore
    }
  }
  return Boolean(win)
}

async function previewAllReady() {
  const rows = previewableRows.value.filter((row) => row.newLandingUrl)
  if (rows.length === 0) {
    ElMessage.warning('还没有可预览的新落地链，请先创编成功')
    return
  }
  previewing.value = true
  let opened = 0
  try {
    ElMessage.info(`将打开 ${rows.length} 个预览标签`)
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      progress.value = `一键预览 ${index + 1}/${rows.length} · ${row.offerName}`
      const ok = openLanding(row.newLandingUrl)
      if (!ok) {
        ElMessage.warning(
          opened > 0
            ? `已打开 ${opened}/${rows.length}，后续被浏览器拦截；请允许弹窗后重试`
            : '浏览器拦截了弹窗，请允许本站弹窗后重试',
        )
        progress.value = `一键预览中断：已打开 ${opened}/${rows.length}`
        return
      }
      opened += 1
      if (index < rows.length - 1) {
        await sleep(200)
      }
    }
    progress.value = `一键预览完成：已打开 ${opened} 个`
    ElMessage.success(`已打开 ${opened} 个预览，确认无误后再替换 offer`)
  } finally {
    previewing.value = false
  }
}

async function writebackAllReady() {
  if (writingBack.value || generating.value) {
    return
  }
  if (!misReady) {
    ElMessage.error('需要配置 VITE_MIS_* 后才能替换 offer')
    return
  }
  const rows = [...pendingWriteRows.value]
  if (rows.length === 0) {
    ElMessage.warning(
      scopeToCurrentLexicon.value
        ? '当前词库下没有待替换项（请确认这 18 条状态是「已就绪」）'
        : '没有待替换项（需要状态为「已就绪」且有新链）',
    )
    return
  }

  try {
    await ElMessageBox.confirm(
      scopeToCurrentLexicon.value
        ? `将只写入当前词库关键词的 ${rows.length} 条（不会动其它旧草稿）。确认写回 offer？`
        : `将写入全部 ${rows.length} 条已就绪记录。确认写回？`,
      '确认一键替换',
      { type: 'warning', confirmButtonText: '确认写回', cancelButtonText: '取消' },
    )
  } catch {
    return
  }

  writingBack.value = true
  let success = 0
  let failed = 0
  try {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      progress.value = `替换 ${index + 1}/${rows.length} · ${row.offerName}`
      patchRunRow(row.offerId, { note: '替换 offer…' })
      const articleId = String(row.articleId || '').trim()
      const newLandingUrl = String(row.newLandingUrl || '').trim()
      const draft =
        draftJobs.value.find((job) => job.offerId === row.offerId && job.articleId === articleId) ||
        draftJobs.value.find((job) => job.offerId === row.offerId)
      try {
        if (!articleId || !newLandingUrl) {
          throw new Error('缺少 articleId 或新落地链')
        }
        const updated = await replaceLandpulseOfferResultUrl(row.offerId, newLandingUrl, {
          articleId,
          ref: row.keyword,
        })
        await appendReplaceLog({
          funnelId: draft?.funnelId || '',
          funnelName: draft?.funnelName || '',
          offerId: row.offerId,
          offerName: row.offerName,
          channelId: draft?.channelId || null,
          articleId,
          ref: draft?.seedKeyword || row.keyword,
          oldUrl: draft?.oldLandingUrl || null,
          newUrl: updated.url || null,
          resultUrl: updated.resultUrl || newLandingUrl,
          ok: true,
          message: '替换成功',
        })
        // 已写入：漏斗详情去掉该 offer 草稿（新链/状态一并消失），只留替换日志
        await persistDrafts(draftJobs.value.filter((job) => job.offerId !== row.offerId))
        success += 1
        patchRunRow(row.offerId, {
          status: 'written',
          note: `已替换 · 见替换日志 · ${articleId}`,
          newLandingUrl: null,
        })
      } catch (error) {
        const message = errorMessage(error)
        failed += 1
        await appendReplaceLog({
          funnelId: draft?.funnelId || '',
          funnelName: draft?.funnelName || '',
          offerId: row.offerId,
          offerName: row.offerName,
          channelId: draft?.channelId || null,
          articleId,
          ref: draft?.seedKeyword || row.keyword,
          oldUrl: draft?.oldLandingUrl || null,
          newUrl: null,
          resultUrl: newLandingUrl || null,
          ok: false,
          message,
        })
        patchRunRow(row.offerId, {
          note: `替换失败：${message}`,
        })
      }
    }
    progress.value = `替换结束：成功 ${success} · 失败 ${failed}`
    if (failed === 0) {
      ElMessage.success(`已替换 ${success} 个 offer；漏斗详情新链已清除，可在替换日志查看`)
    } else {
      ElMessage.warning(`替换结束：成功 ${success} · 失败 ${failed}`)
    }
  } finally {
    writingBack.value = false
  }
}

onMounted(async () => {
  await bootstrap()
  if (String(route.query.import || '') === 'replace-advice') {
    const ok = await importFromReplaceAdvice()
    if (ok) {
      await router.replace({ path: route.path, query: {} })
    }
  }
})

onBeforeUnmount(() => {
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = 0
  }
})
</script>

<template>
  <div class="workbench" v-loading="loading">
    <section class="toolbar card">
      <div>
        <h2>Offer 创编</h2>
        <p class="muted">
          流程：从分析导入待换 / 手选 offer → 当前词库随机分配 → <strong>开始创编</strong> →
          <strong>一键预览</strong> → <strong>一键替换</strong>。现行词库
          <code>seed-lexicon/</code>（现仅美妆 4 词）。
        </p>
        <p v-if="progress" class="progress">{{ progress }}</p>
      </div>
      <div class="toolbar-actions">
        <el-button :loading="loading" :disabled="generating || writingBack" @click="bootstrap">刷新</el-button>
        <el-button
          type="success"
          :loading="importingAdvice || loading"
          :disabled="generating || writingBack || loading"
          @click="importFromReplaceAdvice()"
        >
          导入分析待换并随机分配
        </el-button>
        <el-button
          :loading="polling"
          :disabled="runningDraftCount === 0 || generating || writingBack"
          @click="pollRunningDrafts({ manual: true })"
        >
          刷新编排状态{{ runningDraftCount ? `（${runningDraftCount}）` : '' }}
        </el-button>
        <el-button
          :disabled="generating || writingBack || selectedOfferIds.length === 0 || selectedSeedKeys.length === 0"
          @click="reshuffleAssignments"
        >
          随机分配预览
        </el-button>
        <el-button type="primary" :loading="generating" :disabled="!canGenerate" @click="generateFromAssignments">
          开始创编{{ assignments.length ? `（${assignments.length}）` : '' }}
        </el-button>
        <el-button
          :loading="previewing"
          :disabled="generating || writingBack || previewableRows.length === 0"
          @click="previewAllReady"
        >
          一键预览{{ previewableRows.length ? `（${previewableRows.length}）` : '' }}
        </el-button>
        <el-button
          type="warning"
          :loading="writingBack"
          :disabled="!misReady || generating || previewing || pendingWriteRows.length === 0"
          @click="writebackAllReady"
        >
          一键替换本批{{ pendingWriteRows.length ? `（${pendingWriteRows.length}）` : '' }}
        </el-button>
        <el-checkbox v-model="scopeToCurrentLexicon" :disabled="generating || writingBack">
          仅当前词库（{{ currentLexiconKeywords.size }}词）
        </el-checkbox>
      </div>
    </section>

    <section class="stats card">
      <span>唯一 offer {{ uniqueOfferCount }}</span>
      <span>原始行 {{ rawOfferRows }}</span>
      <span>词库品类 {{ lexiconStats.categoryCount }}</span>
      <span>种子词 {{ lexiconStats.seedCount }}</span>
      <span>已选 offer {{ selectedOfferIds.length }}</span>
      <span>已选词 {{ selectedSeedKeys.length }}</span>
      <span>已分配 {{ assignments.length }}</span>
    </section>

    <el-alert
      v-if="importBanner"
      type="success"
      :closable="true"
      show-icon
      class="import-banner"
      :title="importBanner"
      @close="importBanner = ''"
    />

    <div class="grid">
      <section class="card pane">
        <header class="pane-head">
          <strong>1. 选 offer（已按 offerId 去重）</strong>
        </header>
        <div class="filters">
          <el-input v-model="offerKeyword" clearable placeholder="搜 offer 名 / id / 漏斗" style="width: 220px" />
          <el-select
            v-model="funnelFilter"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="可选：按漏斗过滤（不影响去重）"
            style="width: 260px"
          >
            <el-option v-for="name in funnelFilterOptions" :key="name" :label="name" :value="name" />
          </el-select>
        </div>
        <el-table
          ref="offerTableRef"
          :data="visibleOffers"
          height="360"
          size="small"
          row-key="offerId"
          @selection-change="onOfferSelectionChange"
        >
          <el-table-column type="selection" width="42" reserve-selection />
          <el-table-column prop="offerName" label="offer" min-width="150" show-overflow-tooltip />
          <el-table-column prop="offerId" label="offerId" width="120" show-overflow-tooltip />
          <el-table-column label="出现漏斗" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ row.funnelNames.join('、') }}</template>
          </el-table-column>
          <el-table-column prop="geo" label="geo" width="70" />
          <el-table-column prop="categoryName" label="数据品类" width="100" show-overflow-tooltip />
        </el-table>
      </section>

      <section class="card pane">
        <header class="pane-head">
          <strong>2. 选词（品类 × 国家）</strong>
        </header>
        <div class="filters">
          <el-select
            v-model="seedCategoryFilter"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="品类（空=全部）"
            style="width: 200px"
          >
            <el-option v-for="opt in categoryOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <el-select
            v-model="seedRegionFilter"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="国家（空=全部）"
            style="width: 160px"
          >
            <el-option v-for="opt in regionOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <el-button link type="primary" @click="filterSeedsBySelectedOfferGeo">按选中 offer 国家滤词</el-button>
        </div>
        <el-table
          ref="seedTableRef"
          :data="seedRows"
          height="360"
          size="small"
          row-key="rowKey"
          @selection-change="onSeedSelectionChange"
        >
          <el-table-column type="selection" width="42" />
          <el-table-column prop="regionId" label="国家" width="70" />
          <el-table-column prop="categoryKey" label="品类" width="130" show-overflow-tooltip />
          <el-table-column prop="keyword" label="种子词" min-width="160" show-overflow-tooltip />
        </el-table>
      </section>
    </div>

    <section id="offer-seed-assignments" class="card pane" :class="{ 'pane-highlight': assignments.length > 0 }">
      <header class="pane-head">
        <strong>3. 分配预览{{ assignments.length ? `（${assignments.length}）` : '' }}</strong>
        <el-button :disabled="generating || !assignments.length" @click="reshuffleAssignments">重新打乱</el-button>
      </header>
      <el-table :data="assignments" size="small" max-height="240" empty-text="选好 offer 和词后点「随机分配预览」">
        <el-table-column label="offerId" width="140">
          <template #default="{ row }">{{ row.offerId }}</template>
        </el-table-column>
        <el-table-column label="offer" min-width="150">
          <template #default="{ row }">
            {{ selectedOffers.find((item) => item.offerId === row.offerId)?.offerName || row.offerId }}
          </template>
        </el-table-column>
        <el-table-column label="种子词" min-width="180">
          <template #default="{ row }">{{ row.seed.keyword }}</template>
        </el-table-column>
        <el-table-column label="国家" width="70">
          <template #default="{ row }">{{ row.seed.regionId || '—' }}</template>
        </el-table-column>
        <el-table-column label="词品类" width="140">
          <template #default="{ row }">{{ row.seed.categoryKey }}</template>
        </el-table-column>
        <el-table-column label="类目id" width="80">
          <template #default="{ row }">{{ row.seed.categoryId || '—' }}</template>
        </el-table-column>
      </el-table>
    </section>

    <section class="card pane">
      <header class="pane-head">
        <strong>4. 创编记录</strong>
        <span class="muted">
          写回默认「仅当前词库」——现在应显示约 18 条待替换，不会动旧草稿。先预览再点「一键替换本批」。
        </span>
        <el-button
          type="danger"
          plain
          :disabled="generating || writingBack || (runRows.length === 0 && draftJobs.length === 0)"
          @click="clearOrchestrationRecords"
        >
          清空创编记录
        </el-button>
      </header>
      <el-alert
        v-if="!generateReady"
        type="warning"
        :closable="false"
        class="block"
        title="产文依赖未齐全"
        description="需要 VITE_ARTICLE_* 与 VITE_MIS_*，改完后重启 npm run dev。"
      />
      <el-table :data="runRows" size="small" max-height="280" empty-text="暂无编排记录；开始创编后会落盘，刷新仍可看到">
        <el-table-column prop="offerName" label="offer" min-width="140" show-overflow-tooltip />
        <el-table-column prop="keyword" label="种子词" min-width="140" show-overflow-tooltip />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="
                row.status === 'written' || row.status === 'ready'
                  ? 'success'
                  : row.status === 'failed'
                    ? 'danger'
                    : 'warning'
              "
            >
              {{
                row.status === 'written'
                  ? '已写回'
                  : row.status === 'ready'
                    ? '已就绪'
                    : row.status === 'failed'
                      ? '失败'
                      : row.status === 'running'
                        ? '进行中'
                        : '排队'
              }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="articleId" label="文章id" width="120" show-overflow-tooltip />
        <el-table-column prop="note" label="说明" min-width="180" show-overflow-tooltip />
        <el-table-column label="预览" width="70">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :disabled="!row.newLandingUrl"
              @click="openLanding(row.newLandingUrl)"
            >
              打开
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding: 4px 2px 16px;
}
.card {
  background: #fff;
  border: 1px solid #e6ebf2;
  border-radius: 10px;
  padding: 12px 14px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.toolbar h2 {
  margin: 0 0 4px;
  font-size: 16px;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  align-items: center;
  flex-wrap: wrap;
}
.block {
  margin-bottom: 10px;
}
.muted {
  color: #6b7785;
  margin: 0;
  font-size: 13px;
}
.progress {
  margin: 6px 0 0;
  font-size: 13px;
  color: #3b4a5a;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 13px;
  color: #405064;
}
.import-banner {
  margin: 0;
}
.pane-highlight {
  border-color: #86efac;
  box-shadow: 0 0 0 1px rgba(22, 163, 74, 0.15);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.pane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.foot-note {
  margin: 10px 0 0;
}
code {
  font-size: 12px;
}
</style>
