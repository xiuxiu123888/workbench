<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getAccountList,
  getArticleDetail,
  getCategoryList,
  getLanguageList,
  getOperationConfigDetail,
  getSiteList,
  updateOperationConfig,
  type AccountOption,
  type CategoryOption,
  type LanguageOption,
  type SiteOption,
} from '../api/article'
import { createArticleJob, getArticleJob, platformUserFromToken } from '../api/articleJobs'
import { errorMessage } from '../api/http'
import { createCampaign } from '../api/mis'
import { serviceConfig } from '../config/env'
import {
  buildCategoryTree,
  categoryPathLabel,
  leafCategoryId,
} from '../domain/articleCategories'
import { resolveLandingUrl, type ExistingArticleLink } from '../domain/autoArticleWrite'
import { ARTICLE_REGIONS, regionLabel } from '../domain/articleRegions'
import { articleDomain } from '../domain/batch'
import { buildJobSiteGroups, type JobSiteGroup } from '../domain/articleJobGroups'
import {
  bareDomain,
  emptyProgress,
  isTerminalJobStatus,
  loadArticleJobs,
  removeArticleJob,
  saveArticleJobs,
  type ArticleJobResultItem,
  type StoredArticleJob,
  upsertArticleJob,
} from '../domain/articleJobStore'
import { channelFromUrl } from '../domain/campaignForm'
import { articleIdFromUrl, sourceFromAccountName } from '../domain/report'
import { appendGeneratedUrls, buildUpdatePayload, recentArticleItems } from '../domain/recentArticles'

const POLL_MS = 7000
const AUTO_WRITE_PREF_KEY = 'workbench.auto-article.auto-write'
const AUTO_WRITE_DONE_KEY = 'workbench.auto-article.written-keys'
const WRITE_LINKS_KEY = 'workbench.auto-article.write-links'

interface TargetPair {
  key: string
  accountId: number | string
  accountName: string
  siteId: number | string
  domain: string
}

interface KeywordGroup {
  key: string
  intentKeyword: string
  refKeyword: string
  /** 选填；写入链接时优先用 */
  channelId: string
}

interface LocaleBlock {
  key: string
  languageId: number | string | undefined
  regionId: string
  keywordGroups: KeywordGroup[]
}

function newKeywordGroup(): KeywordGroup {
  return {
    key: `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intentKeyword: '',
    refKeyword: '',
    channelId: '',
  }
}

function newLocaleBlock(languageId?: number | string, regionId = 'US'): LocaleBlock {
  return {
    key: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    languageId,
    regionId,
    keywordGroups: [newKeywordGroup()],
  }
}

function loadAutoWritePref(): boolean {
  try {
    return localStorage.getItem(AUTO_WRITE_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function saveAutoWritePref(value: boolean) {
  try {
    localStorage.setItem(AUTO_WRITE_PREF_KEY, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function loadWrittenKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(AUTO_WRITE_DONE_KEY)
    if (!raw) {
      return new Set()
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return new Set()
    }
    return new Set(parsed.map((item) => String(item)).filter(Boolean))
  } catch {
    return new Set()
  }
}

function saveWrittenKeys(keys: Set<string>) {
  try {
    localStorage.setItem(AUTO_WRITE_DONE_KEY, JSON.stringify([...keys].slice(-500)))
  } catch {
    /* ignore */
  }
}

function loadWriteLinks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(WRITE_LINKS_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const link = String(value ?? '').trim()
      if (key && link) {
        out[key] = link
      }
    }
    return out
  } catch {
    return {}
  }
}

function saveWriteLinks(links: Record<string, string>) {
  try {
    const entries = Object.entries(links).slice(-500)
    localStorage.setItem(WRITE_LINKS_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* ignore */
  }
}

const accounts = ref<AccountOption[]>([])
const sites = ref<SiteOption[]>([])
const languages = ref<LanguageOption[]>([])
const categories = ref<CategoryOption[]>([])
const regions = ARTICLE_REGIONS
const jobs = ref<StoredArticleJob[]>([])
const categoryPath = ref<Array<number | string>>([])
const localeBlocks = ref<LocaleBlock[]>([newLocaleBlock()])
const draftAccountId = ref<number | string | undefined>()
const draftSiteIds = ref<Array<number | string>>([])
const targetPairs = ref<TargetPair[]>([])
const articlesPerDomain = ref(1)
const publish = ref(true)
const autoWrite = ref(loadAutoWritePref())
const creating = ref(false)
const createDrawerOpen = ref(false)
const polling = ref(false)
const writingKey = ref('')
const writingGroupKey = ref('')
const writeNotes = ref<Record<string, string>>({})
const writeLinks = ref<Record<string, string>>(loadWriteLinks())
const writtenKeys = ref<Set<string>>(loadWrittenKeys())
const autoWriteAttempted = ref<Set<string>>(new Set())
const autoWriteTaskIds = ref<Set<string>>(new Set())
let pollTimer = 0
let autoWriting = false

const articleCountOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const MAX_LOCALES = 15
const MAX_GROUPS_PER_LOCALE = 20
const MAX_TASKS = 60

const categoryTree = computed(() => buildCategoryTree(categories.value))
const selectedCategoryId = computed(() => leafCategoryId(categoryPath.value))

const addedSiteIds = computed(() => new Set(targetPairs.value.map((pair) => String(pair.siteId))))

const draftSiteOptions = computed(() => {
  if (draftAccountId.value == null || draftAccountId.value === '') {
    return []
  }
  return sites.value
    .filter((site) => site.accountId == draftAccountId.value)
    .filter((site) => site.isPass !== false)
    .map((site) => {
      const domain = bareDomain(articleDomain(site) || site.siteName)
      const already = addedSiteIds.value.has(String(site.id))
      return {
        id: site.id,
        label: domain || String(site.siteName || site.id),
        domain,
        disabled: already || !domain || site.accountId == null || site.accountId === '',
      }
    })
    .filter((item) => item.domain)
})

const flatTargets = computed(() =>
  targetPairs.value.map((pair) => ({
    domain: pair.domain,
    site_id: pair.siteId,
    account_id: pair.accountId,
  })),
)

const targetCount = computed(() => flatTargets.value.length)
const localeCount = computed(() => localeBlocks.value.length)
const groupCount = computed(() =>
  localeBlocks.value.reduce((sum, block) => sum + block.keywordGroups.length, 0),
)
/** 每个「国家/语言 × 种子词/ref」= 1 个任务 */
const plannedTaskCount = computed(() => groupCount.value)
const expectedArticleCount = computed(
  () => plannedTaskCount.value * targetCount.value * articlesPerDomain.value,
)
const activeCount = computed(() => jobs.value.filter((job) => !isTerminalJobStatus(job.status)).length)

const jobSiteGroups = computed(() =>
  buildJobSiteGroups({
    jobs: jobs.value,
    categoryLabel: (categoryId) => categoryPathLabel(categories.value, categoryId),
    accountLabel: (accountId) => accountName(accountId),
    writtenKeys: writtenKeys.value,
    writeLinks: writeLinks.value,
  }),
)

watch(draftAccountId, () => {
  draftSiteIds.value = []
})

onMounted(() => {
  jobs.value = loadArticleJobs()
  void loadMeta()
  void refreshActiveJobs()
  startPolling()
})

onUnmounted(() => {
  stopPolling()
})

watch(jobs, (value) => saveArticleJobs(value), { deep: true })

watch(autoWrite, (value) => {
  saveAutoWritePref(value)
})

function startPolling() {
  stopPolling()
  pollTimer = window.setInterval(() => {
    void refreshActiveJobs()
  }, POLL_MS)
}

function stopPolling() {
  window.clearInterval(pollTimer)
  pollTimer = 0
}

async function loadMeta() {
  try {
    const [accountList, siteList, languageList, categoryList] = await Promise.all([
      getAccountList(),
      getSiteList(),
      getLanguageList(),
      getCategoryList(),
    ])
    accounts.value = accountList
    sites.value = siteList
    languages.value = languageList
    categories.value = categoryList
    if (languageList.length > 0) {
      const english = languageList.find((item) => String(item.langCode || '').toLowerCase() === 'en')
      const defaultLang = english?.id ?? languageList[0].id
      localeBlocks.value = localeBlocks.value.map((block) =>
        block.languageId == null || block.languageId === ''
          ? { ...block, languageId: defaultLang }
          : block,
      )
    }
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
}

function addLocaleBlock() {
  if (localeBlocks.value.length >= MAX_LOCALES) {
    ElMessage.warning(`一次最多 ${MAX_LOCALES} 个国家/语言`)
    return
  }
  const defaultLang = languages.value.find((item) => String(item.langCode || '').toLowerCase() === 'en')?.id
    ?? languages.value[0]?.id
  localeBlocks.value = [...localeBlocks.value, newLocaleBlock(defaultLang)]
}

function removeLocaleBlock(key: string) {
  if (localeBlocks.value.length <= 1) {
    const first = localeBlocks.value[0]
    localeBlocks.value = [newLocaleBlock(first?.languageId, first?.regionId || 'US')]
    return
  }
  localeBlocks.value = localeBlocks.value.filter((block) => block.key !== key)
}

function addKeywordGroup(localeKey: string) {
  const block = localeBlocks.value.find((item) => item.key === localeKey)
  if (!block) {
    return
  }
  if (block.keywordGroups.length >= MAX_GROUPS_PER_LOCALE) {
    ElMessage.warning(`每个国家/语言最多 ${MAX_GROUPS_PER_LOCALE} 组种子词/ref`)
    return
  }
  block.keywordGroups = [...block.keywordGroups, newKeywordGroup()]
}

function removeKeywordGroup(localeKey: string, groupKey: string) {
  const block = localeBlocks.value.find((item) => item.key === localeKey)
  if (!block) {
    return
  }
  if (block.keywordGroups.length <= 1) {
    block.keywordGroups = [newKeywordGroup()]
    return
  }
  block.keywordGroups = block.keywordGroups.filter((group) => group.key !== groupKey)
}

function languageLabel(id: number | string | undefined): string {
  const found = languages.value.find((item) => String(item.id) === String(id))
  if (!found) {
    return id == null ? '—' : String(id)
  }
  const name = found.langName?.trim() || found.langCode?.trim() || String(found.id)
  return found.langCode ? `${name}（${found.langCode}）` : name
}

function accountName(id: number | string | undefined): string {
  if (id == null || id === '') {
    return ''
  }
  return accounts.value.find((item) => String(item.id) === String(id))?.name?.trim() || String(id)
}

function addTargetPairs() {
  if (draftAccountId.value == null || draftAccountId.value === '') {
    ElMessage.error('请先选择账户')
    return
  }
  if (draftSiteIds.value.length === 0) {
    ElMessage.error('请选择域名')
    return
  }
  const picked = draftSiteIds.value
    .map((id) => draftSiteOptions.value.find((item) => item.id == id && !item.disabled))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  if (picked.length === 0) {
    ElMessage.error('所选域名不可用或已添加')
    return
  }
  if (targetCount.value + picked.length > 20) {
    ElMessage.error(`单次最多 20 个目标，当前已选 ${targetCount.value}`)
    return
  }

  const accountId = draftAccountId.value
  const name = accountName(accountId)
  const stamp = Date.now()
  targetPairs.value = [
    ...targetPairs.value,
    ...picked.map((site, index) => ({
      key: `${accountId}-${site.id}-${stamp}-${index}`,
      accountId,
      accountName: name,
      siteId: site.id,
      domain: site.domain,
    })),
  ]
  draftSiteIds.value = []
}

function removeTargetPair(key: string) {
  targetPairs.value = targetPairs.value.filter((pair) => pair.key !== key)
}

function persist(next: StoredArticleJob[]) {
  jobs.value = next
}

function fromDetail(detail: Awaited<ReturnType<typeof getArticleJob>>, previous?: StoredArticleJob): StoredArticleJob {
  const now = new Date().toISOString()
  const fromOptions = Number(detail.options?.articles_per_domain)
  const intentKeyword = String(detail.intent_keyword || previous?.intentKeyword || '')
  const categoryFromDetail = Number(detail.category_id)
  return {
    taskId: String(detail.task_id),
    intentKeyword,
    refKeyword: previous?.refKeyword || intentKeyword,
    channelId: previous?.channelId || '',
    categoryId:
      Number.isFinite(categoryFromDetail) && categoryFromDetail > 0
        ? Math.floor(categoryFromDetail)
        : previous?.categoryId || 0,
    languageId: Number(detail.language_id || previous?.languageId || 1),
    regionId: String(detail.region_id || previous?.regionId || 'US'),
    publish: detail.options?.publish ?? previous?.publish ?? true,
    articlesPerDomain:
      Number.isFinite(fromOptions) && fromOptions > 0
        ? Math.min(10, Math.floor(fromOptions))
        : previous?.articlesPerDomain || 1,
    targets: previous?.targets || [],
    status: detail.status,
    progress: detail.progress || previous?.progress || emptyProgress(),
    results: detail.results || previous?.results || [],
    errorMessage: detail.error_message ?? previous?.errorMessage ?? null,
    createdAt: previous?.createdAt || detail.created_at || now,
    updatedAt: now,
  }
}

async function refreshActiveJobs() {
  const pending = jobs.value.filter((job) => !isTerminalJobStatus(job.status))
  if (pending.length === 0 || polling.value) {
    return
  }
  polling.value = true
  try {
    let next = jobs.value
    for (const job of pending) {
      try {
        const detail = await getArticleJob(job.taskId)
        next = upsertArticleJob(next, fromDetail(detail, job))
      } catch (error) {
        next = upsertArticleJob(next, {
          ...job,
          errorMessage: errorMessage(error),
          updatedAt: new Date().toISOString(),
        })
      }
    }
    persist(next)
    void drainAutoWrite()
  } finally {
    polling.value = false
  }
}

async function createJob() {
  const categoryId = selectedCategoryId.value
  if (categoryId == null) {
    ElMessage.error('请选择品类')
    return
  }
  if (localeBlocks.value.length === 0) {
    ElMessage.error('请至少添加一个国家/语言')
    return
  }

  type TaskPlan = {
    label: string
    intentKeyword: string
    refKeyword: string
    channelId: string
    languageId: number
    regionId: string
  }
  const taskPlans: TaskPlan[] = []
  for (const [localeIndex, block] of localeBlocks.value.entries()) {
    const localeLabel = `国家/语言 ${localeIndex + 1}`
    if (block.languageId == null || block.languageId === '') {
      ElMessage.error(`${localeLabel}：请选择语言`)
      return
    }
    if (!block.regionId) {
      ElMessage.error(`${localeLabel}：请选择国家/地区`)
      return
    }
    if (block.keywordGroups.length === 0) {
      ElMessage.error(`${localeLabel}：请至少一组种子词/ref`)
      return
    }
    for (const [groupIndex, group] of block.keywordGroups.entries()) {
      const label = `${localeLabel} · 第 ${groupIndex + 1} 组`
      const intentKeyword = group.intentKeyword.trim()
      const refKeyword = group.refKeyword.trim()
      const channelId = group.channelId.trim()
      if (!intentKeyword) {
        ElMessage.error(`${label}：请填写种子词`)
        return
      }
      if (intentKeyword.length > 300) {
        ElMessage.error(`${label}：种子词不能超过 300 字`)
        return
      }
      if (!refKeyword) {
        ElMessage.error(`${label}：请填写对应 ref`)
        return
      }
      if (refKeyword.length > 300) {
        ElMessage.error(`${label}：ref 不能超过 300 字`)
        return
      }
      if (refKeyword.toLowerCase() === intentKeyword.toLowerCase()) {
        ElMessage.error(`${label}：ref 不能与种子词相同`)
        return
      }
      taskPlans.push({
        label: `${intentKeyword} · ${languageLabel(block.languageId)} · ${block.regionId}`,
        intentKeyword,
        refKeyword,
        channelId,
        languageId: Number(block.languageId),
        regionId: block.regionId,
      })
    }
  }
  if (taskPlans.length === 0) {
    ElMessage.error('请至少配置一组种子词 / ref')
    return
  }
  if (taskPlans.length > MAX_TASKS) {
    ElMessage.error(`共 ${taskPlans.length} 个任务，超过上限 ${MAX_TASKS}`)
    return
  }
  const targets = flatTargets.value
  if (targets.length === 0) {
    ElMessage.error('请至少添加一个网站')
    return
  }
  if (targets.length > 20) {
    ElMessage.error('单次最多 20 个网站')
    return
  }

  const perDomain = Math.min(10, Math.max(1, Math.floor(Number(articlesPerDomain.value) || 1)))
  creating.value = true
  let nextJobs = jobs.value
  let success = 0
  const failures: string[] = []
  try {
    const user = platformUserFromToken(serviceConfig.articleToken)
    const stamp = Date.now()
    for (const [index, plan] of taskPlans.entries()) {
      try {
        const detail = await createArticleJob({
          intentKeyword: plan.intentKeyword,
          categoryId,
          languageId: plan.languageId,
          regionId: plan.regionId,
          userId: user.userId,
          userName: user.userName,
          targets,
          publish: publish.value,
          articlesPerDomain: perDomain,
          idempotencyKey: `wb-${stamp}-${index}-${Math.random().toString(36).slice(2, 10)}`,
        })
        if (autoWrite.value && detail.task_id) {
          const enrolled = new Set(autoWriteTaskIds.value)
          enrolled.add(String(detail.task_id))
          autoWriteTaskIds.value = enrolled
        }
        nextJobs = upsertArticleJob(
          nextJobs,
          fromDetail(detail, {
            taskId: detail.task_id,
            intentKeyword: plan.intentKeyword,
            refKeyword: plan.refKeyword,
            channelId: plan.channelId,
            categoryId,
            languageId: plan.languageId,
            regionId: plan.regionId,
            publish: publish.value,
            articlesPerDomain: perDomain,
            targets: targets.map((item) => ({
              domain: bareDomain(item.domain),
              site_id: item.site_id,
              account_id: item.account_id,
            })),
            status: detail.status,
            progress: detail.progress || emptyProgress(),
            results: detail.results || [],
            errorMessage: detail.error_message ?? null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        )
        persist(nextJobs)
        success += 1
      } catch (error) {
        failures.push(`${plan.label}：${errorMessage(error)}`)
      }
    }
    if (success > 0) {
      // 保留品类/国家语言结构与网站，只清空各组种子词，方便继续加
      localeBlocks.value = localeBlocks.value.map((block) => ({
        ...block,
        keywordGroups: [newKeywordGroup()],
      }))
    }
    if (failures.length === 0) {
      ElMessage.success(
        `已创建 ${success} 个任务（${localeCount.value} 国家/语言 · ${success} 组种子词/ref × ${targets.length} 站 × ${perDomain} ≈ ${success * targets.length * perDomain} 篇）`,
      )
    } else if (success === 0) {
      ElMessage.error(failures[0] || '创建失败')
    } else {
      ElMessage.warning(`成功 ${success} 个，失败 ${failures.length} 个。${failures[0]}`)
    }
    if (success > 0) {
      createDrawerOpen.value = false
      if (autoWrite.value) {
        void drainAutoWrite()
      }
    }
  } finally {
    creating.value = false
  }
}

function resultLabel(item: ArticleJobResultItem) {
  if (item.article_number != null && item.article_number > 0) {
    return `${item.domain} #${item.article_number}`
  }
  return item.domain
}

function resultKey(job: StoredArticleJob, item: ArticleJobResultItem, index: number) {
  return `${job.taskId}:${item.id ?? `${item.domain}-${item.article_number ?? index}`}`
}

function canWriteResult(item: ArticleJobResultItem) {
  return String(item.status).toLowerCase() === 'success' && item.article_id != null && String(item.article_id).trim() !== ''
}

function afsSourceForAccount(accountId: number | string | undefined): string {
  const name = accountName(accountId)
  const source = sourceFromAccountName(name)
  if (!source) {
    throw new Error(`账户 ${name || accountId || '未知'} 无法映射 AFS source（需要 A数字）`)
  }
  return source
}

/** 优先用运营配置里自带的 countryCode；只有缺国家时才补查文章详情 */
async function loadExistingArticleLinks(
  items: Array<{ url: string; countryCode: string }>,
): Promise<ExistingArticleLink[]> {
  const links: ExistingArticleLink[] = []
  for (const item of items) {
    const url = item.url.trim()
    if (!url) {
      continue
    }
    const channelId = channelFromUrl(url)
    let countryCode = String(item.countryCode ?? '').trim()
    if (!countryCode) {
      const articleId = articleIdFromUrl(url)
      if (articleId) {
        try {
          const article = await getArticleDetail(articleId)
          countryCode = String(article.countryCode ?? '').trim()
        } catch {
          countryCode = ''
        }
      }
    }
    links.push({ url, countryCode, channelId })
  }
  return links
}

function markWritten(key: string) {
  const next = new Set(writtenKeys.value)
  next.add(key)
  writtenKeys.value = next
  saveWrittenKeys(next)
}

function isAlreadyWritten(key: string) {
  if (writtenKeys.value.has(key)) {
    return true
  }
  const note = writeNotes.value[key] || ''
  return note.startsWith('已写入')
}

function nextAutoWriteCandidate(): { job: StoredArticleJob; item: ArticleJobResultItem; index: number } | null {
  for (const job of jobs.value) {
    if (!autoWriteTaskIds.value.has(job.taskId)) {
      continue
    }
    for (const [index, item] of job.results.entries()) {
      if (!canWriteResult(item)) {
        continue
      }
      const key = resultKey(job, item, index)
      if (isAlreadyWritten(key) || autoWriteAttempted.value.has(key)) {
        continue
      }
      return { job, item, index }
    }
  }
  return null
}

async function drainAutoWrite() {
  if (!autoWrite.value || autoWriting) {
    return
  }
  autoWriting = true
  let ok = 0
  let fail = 0
  try {
    while (autoWrite.value) {
      const candidate = nextAutoWriteCandidate()
      if (!candidate) {
        break
      }
      const key = resultKey(candidate.job, candidate.item, candidate.index)
      const attempted = new Set(autoWriteAttempted.value)
      attempted.add(key)
      autoWriteAttempted.value = attempted
      const wrote = await writeResult(candidate.job, candidate.item, candidate.index, { silent: true })
      if (wrote) {
        ok += 1
      } else {
        fail += 1
      }
    }
    if (ok > 0 && fail === 0) {
      ElMessage.success(`已自动写入 ${ok} 条到运营配置`)
    } else if (ok > 0) {
      ElMessage.warning(`自动写入成功 ${ok} 条，失败 ${fail} 条`)
    } else if (fail > 0) {
      ElMessage.error(`自动写入失败 ${fail} 条，可在结果行查看原因或手动重试`)
    }
  } finally {
    autoWriting = false
  }
}

async function writeResult(
  job: StoredArticleJob,
  item: ArticleJobResultItem,
  index: number,
  options: { silent?: boolean; skipLock?: boolean } = {},
): Promise<boolean> {
  const key = resultKey(job, item, index)
  if ((!options.skipLock && (writingKey.value || writingGroupKey.value)) || !canWriteResult(item)) {
    return false
  }
  if (!options.skipLock) {
    writingKey.value = key
  }
  writeNotes.value = { ...writeNotes.value, [key]: '写入中…' }
  try {
    const domain = bareDomain(item.domain)
    if (!domain) {
      throw new Error('结果缺少域名')
    }
    const detail = await getOperationConfigDetail({ site: domain })
    if (detail.id == null || detail.id === '') {
      throw new Error(`找不到域名 ${domain} 对应的运营配置`)
    }
    const recentItems = recentArticleItems(detail.recentArticles)
    const currentUrls = recentItems.map((row) => row.url)
    const articleId = String(item.article_id).trim()
    if (currentUrls.some((url) => articleIdFromUrl(url) === articleId)) {
      const existingUrl = currentUrls.find((url) => articleIdFromUrl(url) === articleId) || ''
      if (existingUrl) {
        rememberWriteLink(key, existingUrl)
      }
      writeNotes.value = { ...writeNotes.value, [key]: '已写入（配置里已有该文章）' }
      markWritten(key)
      if (!options.silent) {
        ElMessage.success(`${resultLabel(item)} 已在运营配置中，跳过`)
      }
      return true
    }
    const existing = await loadExistingArticleLinks(recentItems)
    const accountId = item.account_id ?? detail.accountId
    const linkRef = job.refKeyword || job.intentKeyword
    const resolved = await resolveLandingUrl({
      domain,
      articleId,
      countryCode: job.regionId,
      intentKeyword: linkRef,
      preferredChannelId: job.channelId,
      existing,
      afsSource: afsSourceForAccount(accountId as number | string | undefined),
      createCampaign,
    })
    const applied = appendGeneratedUrls(currentUrls, [resolved.url])
    if (!applied.ok) {
      throw new Error(applied.reason)
    }
    await updateOperationConfig(buildUpdatePayload(detail, applied.urls))
    rememberWriteLink(key, resolved.url)
    const modeLabel =
      resolved.mode === 'preferred'
        ? `指定渠道 ${resolved.channelId}`
        : resolved.mode === 'reused'
          ? `复用渠道 ${resolved.channelId}`
          : `MIS 新建渠道 ${resolved.channelId}`
    writeNotes.value = {
      ...writeNotes.value,
      [key]: `已写入（${modeLabel} · 文章 ${articleId} · ref ${linkRef}）`,
    }
    markWritten(key)
    if (!options.silent) {
      ElMessage.success(`${resultLabel(item)} 已写入运营配置`)
    }
    return true
  } catch (error) {
    const message = errorMessage(error)
    writeNotes.value = { ...writeNotes.value, [key]: message }
    if (!options.silent) {
      ElMessage.error(message)
    }
    return false
  } finally {
    if (!options.skipLock) {
      writingKey.value = ''
    }
  }
}

function rememberWriteLink(key: string, url: string) {
  const link = url.trim()
  if (!key || !link) {
    return
  }
  const next = { ...writeLinks.value, [key]: link }
  writeLinks.value = next
  saveWriteLinks(next)
}

async function writeSiteGroup(group: JobSiteGroup) {
  if (writingGroupKey.value || writingKey.value) {
    return
  }
  const rows = group.countries.flatMap((country) => country.articles).filter((row) => row.writable && !row.written)
  if (rows.length === 0) {
    ElMessage.warning('没有可写入的文章（需生成成功且尚未写入）')
    return
  }
  writingGroupKey.value = group.key
  let ok = 0
  let fail = 0
  try {
    for (const row of rows) {
      const wrote = await writeResult(row.job, row.item, row.index, { silent: true, skipLock: true })
      if (wrote) {
        ok += 1
      } else {
        fail += 1
      }
    }
    if (ok > 0 && fail === 0) {
      ElMessage.success(`${group.title} 已写入 ${ok} 篇`)
    } else if (ok > 0) {
      ElMessage.warning(`${group.title} 写入成功 ${ok} 篇，失败 ${fail} 篇`)
    } else {
      ElMessage.error(`${group.title} 写入失败 ${fail} 篇`)
    }
  } finally {
    writingGroupKey.value = ''
  }
}

function removeSiteGroup(group: JobSiteGroup) {
  let next = jobs.value
  for (const taskId of group.taskIds) {
    next = removeArticleJob(next, taskId)
  }
  persist(next)
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    queued: '排队中',
    planning: '规划中',
    running: '生成中',
    success: '全部成功',
    partial_success: '部分成功',
    failed: '失败',
  }
  return map[status] || status
}

function progressText(job: StoredArticleJob) {
  const p = job.progress
  return `${p.success}/${p.total} 成功 · ${p.failed} 失败 · ${p.running} 进行中`
}
</script>

<template>
  <div class="auto-article">
    <header class="hero">
      <div>
        <p class="eyebrow">自动编排</p>
        <h3>任务列表</h3>
        <p class="hint">主页看进度与写入；创建任务在抽屉里配置品类、国家、种子词和网站。</p>
      </div>
      <div class="hero-actions">
        <div class="hero-stats">
          <div class="stat">
            <em>{{ jobSiteGroups.length }}</em>
            <span>站点组</span>
          </div>
          <div class="stat">
            <em>{{ jobs.length }}</em>
            <span>任务</span>
          </div>
          <div class="stat accent">
            <em>{{ activeCount }}</em>
            <span>未完成</span>
          </div>
        </div>
        <el-button :loading="polling" @click="refreshActiveJobs">刷新</el-button>
        <el-button type="primary" @click="createDrawerOpen = true">创建任务</el-button>
      </div>
    </header>

    <section class="panel list-panel">
      <p v-if="jobs.length === 0" class="empty">还没有任务，点右上角「创建任务」开始。</p>
      <p v-else-if="jobSiteGroups.length === 0" class="empty">
        已有 {{ jobs.length }} 个任务，但缺少网站目标信息（旧记录）。可重新创建，或等生成结果后出现。
      </p>
      <div v-else class="job-list">
        <article v-for="group in jobSiteGroups" :key="group.key" class="job site-group">
          <header>
            <div class="job-title">
              <strong>{{ group.title }}</strong>
              <span
                class="status"
                :data-status="
                  group.pendingCount
                    ? 'queued'
                    : group.writableCount
                      ? 'partial_success'
                      : group.writtenCount
                        ? 'success'
                        : 'queued'
                "
              >
                {{ group.statusSummary }}
                · {{ group.writtenCount }}/{{ group.totalCount }} 已写入
                <template v-if="group.pendingCount"> · 生成中 {{ group.pendingCount }}</template>
                <template v-else-if="group.writableCount"> · 待写 {{ group.writableCount }}</template>
              </span>
            </div>
            <div class="group-actions">
              <el-button
                size="small"
                type="primary"
                :loading="writingGroupKey === group.key"
                :disabled="Boolean(writingGroupKey || writingKey) && writingGroupKey !== group.key"
                @click="writeSiteGroup(group)"
              >
                写入
              </el-button>
              <el-button size="small" text type="danger" @click="removeSiteGroup(group)">移除</el-button>
            </div>
          </header>
          <div class="job-meta">
            <span>{{ group.domain }}</span>
            <span>{{ group.countries.length }} 个国家</span>
            <span>{{ group.totalCount }} 篇文章</span>
          </div>

          <div v-for="country in group.countries" :key="`${group.key}-${country.countryCode}`" class="country-block">
            <h5>{{ country.countryCode }}</h5>
            <div class="article-table">
              <div class="article-head">
                <span>域名</span>
                <span>账户</span>
                <span>渠道 ID</span>
                <span>链接</span>
              </div>
              <div v-for="row in country.articles" :key="row.key" class="article-row">
                <span class="mono">{{ row.domain }}</span>
                <span>{{ accountName(row.accountId) || row.accountId || '—' }}</span>
                <span class="mono">{{ row.channelId || '—' }}</span>
                <span class="link-cell">
                  <a v-if="row.link" :href="row.link" target="_blank" rel="noreferrer">{{ row.link }}</a>
                  <span v-else-if="row.pending" class="dash">生成中…</span>
                  <span v-else class="dash">—</span>
                  <em v-if="row.pending" class="pending">{{ row.job.intentKeyword || row.job.taskId }}</em>
                  <em
                    v-else-if="writeNotes[row.key]"
                    :class="{ ok: writeNotes[row.key].startsWith('已写入'), err: !writeNotes[row.key].startsWith('已写入') && writeNotes[row.key] !== '写入中…' }"
                  >
                    {{ writeNotes[row.key] }}
                  </em>
                </span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <el-drawer
      v-model="createDrawerOpen"
      title="创建编排任务"
      direction="rtl"
      size="720px"
      class="create-drawer"
      destroy-on-close
    >
      <div class="drawer-body">
        <div class="hero-stats drawer-stats">
          <div class="stat">
            <em>{{ localeCount }}</em>
            <span>国家/语言</span>
          </div>
          <div class="stat">
            <em>{{ groupCount }}</em>
            <span>种子词组</span>
          </div>
          <div class="stat">
            <em>{{ targetCount }}</em>
            <span>网站</span>
          </div>
          <div class="stat accent">
            <em>{{ plannedTaskCount }}</em>
            <span>将创建任务</span>
          </div>
        </div>

        <section class="panel">
          <div class="panel-head">
            <div>
              <span class="step">1</span>
              <h4>品类</h4>
            </div>
            <span class="meta">整批共用一个品类</span>
          </div>
          <el-cascader
            v-model="categoryPath"
            class="field-wide"
            :options="categoryTree"
            filterable
            clearable
            placeholder="选择品类（任意一级都可选）"
            :props="{ expandTrigger: 'hover', checkStrictly: true }"
          />
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <span class="step">2</span>
              <h4>国家 / 语言与种子词</h4>
            </div>
            <el-button type="primary" plain @click="addLocaleBlock">添加国家/语言</el-button>
          </div>

          <div class="locale-list">
            <article v-for="(block, localeIndex) in localeBlocks" :key="block.key" class="locale-card">
              <header class="locale-card-head">
                <div class="locale-title">
                  <span class="badge">{{ localeIndex + 1 }}</span>
                  <div>
                    <strong>国家 / 语言</strong>
                    <p>{{ block.keywordGroups.length }} 组种子词/ref</p>
                  </div>
                </div>
                <el-button
                  size="small"
                  text
                  type="danger"
                  :disabled="localeBlocks.length <= 1"
                  @click="removeLocaleBlock(block.key)"
                >
                  删除
                </el-button>
              </header>

              <div class="locale-picks">
                <label class="field">
                  <span>语言</span>
                  <el-select v-model="block.languageId" filterable placeholder="选择语言">
                    <el-option
                      v-for="lang in languages"
                      :key="lang.id"
                      :label="languageLabel(lang.id)"
                      :value="lang.id"
                    />
                  </el-select>
                </label>
                <label class="field">
                  <span>国家 / 地区</span>
                  <el-select v-model="block.regionId" filterable placeholder="选择国家">
                    <el-option
                      v-for="region in regions"
                      :key="region.code"
                      :label="`${region.name}（${region.code}）`"
                      :value="region.code"
                    />
                  </el-select>
                </label>
              </div>

              <div class="seed-table">
                <div class="seed-table-head">
                  <span>#</span>
                  <span>种子词</span>
                  <span>ref</span>
                  <span>渠道 ID（选填）</span>
                  <span />
                </div>
                <div
                  v-for="(group, groupIndex) in block.keywordGroups"
                  :key="group.key"
                  class="seed-row"
                >
                  <span class="seed-index">{{ groupIndex + 1 }}</span>
                  <el-input v-model="group.intentKeyword" clearable placeholder="生成用" />
                  <el-input v-model="group.refKeyword" clearable placeholder="写入链接" />
                  <el-input v-model="group.channelId" clearable placeholder="可不填" />
                  <el-button
                    size="small"
                    text
                    type="danger"
                    :disabled="block.keywordGroups.length <= 1"
                    @click="removeKeywordGroup(block.key, group.key)"
                  >
                    删
                  </el-button>
                </div>
              </div>

              <button type="button" class="add-row" @click="addKeywordGroup(block.key)">
                + 再加一组种子词 / ref
              </button>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <span class="step">3</span>
              <h4>网站与篇数</h4>
            </div>
            <span class="meta">每个任务都会带上这些网站</span>
          </div>

          <div class="site-editor">
            <label class="field">
              <span>账户</span>
              <el-select v-model="draftAccountId" filterable placeholder="选择账户">
                <el-option v-for="account in accounts" :key="account.id" :label="account.name" :value="account.id" />
              </el-select>
            </label>
            <label class="field grow">
              <span>域名</span>
              <el-select
                v-model="draftSiteIds"
                multiple
                filterable
                collapse-tags
                collapse-tags-tooltip
                :disabled="draftAccountId == null || draftAccountId === ''"
                placeholder="可多选后添加"
              >
                <el-option
                  v-for="site in draftSiteOptions"
                  :key="site.id"
                  :label="site.label"
                  :value="site.id"
                  :disabled="site.disabled"
                />
              </el-select>
            </label>
            <el-button type="primary" plain class="site-add" @click="addTargetPairs">添加网站</el-button>
          </div>

          <div v-if="targetPairs.length" class="pairs">
            <span v-for="pair in targetPairs" :key="pair.key" class="pair-chip">
              <strong>{{ pair.domain }}</strong>
              <em>{{ pair.accountName || pair.accountId }}</em>
              <button type="button" class="pair-remove" aria-label="移除" @click="removeTargetPair(pair.key)">×</button>
            </span>
          </div>
          <p v-else class="empty-inline">还没有网站，选账户后多选域名再添加。</p>

          <label class="field per-domain">
            <span>每域名篇数</span>
            <el-select v-model="articlesPerDomain" placeholder="篇数">
              <el-option
                v-for="n in articleCountOptions"
                :key="n"
                :label="`${n} 篇`"
                :value="n"
              />
            </el-select>
          </label>
        </section>

        <section class="submit-bar">
          <div class="submit-opts">
            <el-switch v-model="publish" active-text="直接发布" inactive-text="仅草稿" />
            <el-switch v-model="autoWrite" active-text="生成后自动写入" inactive-text="手动写入" />
          </div>
          <div class="submit-actions">
            <p class="meta">
              {{ localeCount }} 国家/语言 · {{ groupCount }} 组 × {{ targetCount }} 站 × {{ articlesPerDomain }}
              ≈ {{ expectedArticleCount }} 篇
            </p>
            <el-button type="primary" size="large" :loading="creating" @click="createJob">
              创建 {{ plannedTaskCount }} 个任务
            </el-button>
          </div>
          <p v-if="autoWrite" class="hint submit-note">
            写入时优先用填的渠道 ID，否则复用同国家渠道 / MIS 新建；链接含渠道、文章 ID、ref。
          </p>
        </section>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.auto-article {
  display: grid;
  gap: 16px;
  max-width: 1200px;
}

.hero {
  display: flex;
  gap: 20px;
  justify-content: space-between;
  align-items: flex-end;
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
}

.drawer-body {
  display: grid;
  gap: 14px;
  padding-bottom: 24px;
}

.drawer-stats {
  margin-bottom: 2px;
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
  font-size: 15px;
  font-weight: 650;
}

.hint,
.meta,
.empty,
.empty-inline {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.hero .hint {
  margin-top: 6px;
  max-width: 520px;
}

.hero-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.stat {
  min-width: 76px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
  text-align: center;
}

.stat em {
  display: block;
  font-style: normal;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--ink);
}

.stat span {
  color: var(--muted);
  font-size: 11px;
}

.stat.accent {
  border-color: #bfd3ff;
  background: #f3f7ff;
}

.stat.accent em {
  color: var(--blue);
}

.panel,
.submit-bar {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #fff;
  padding: 16px 18px;
}

.panel-head {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.panel-head > div {
  display: flex;
  gap: 10px;
  align-items: center;
}

.step {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--blue);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.step.soft {
  background: #e8eef8;
  color: var(--blue);
}

.field-wide {
  width: min(420px, 100%);
}

.field {
  display: grid;
  gap: 6px;
}

.field > span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.locale-list {
  display: grid;
  gap: 14px;
}

.locale-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #d9e2f1;
  border-radius: 14px;
  background: linear-gradient(180deg, #fbfcfe 0%, #f5f8fc 100%);
  box-shadow: inset 3px 0 0 var(--blue);
}

.locale-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.locale-title {
  display: flex;
  gap: 10px;
  align-items: center;
}

.locale-title strong {
  display: block;
  font-size: 14px;
}

.locale-title p {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.badge {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #e8f0ff;
  color: var(--blue);
  font-size: 13px;
  font-weight: 700;
}

.locale-picks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.seed-table {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
}

.seed-table-head,
.seed-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 0.9fr) 40px;
  gap: 8px;
  align-items: center;
}

.seed-table-head {
  padding: 0 2px 4px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.seed-index {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin: 0 auto;
  border-radius: 6px;
  background: #f0f3f8;
  color: #475467;
  font-size: 12px;
  font-weight: 650;
}

.add-row {
  justify-self: start;
  margin: 0;
  padding: 8px 12px;
  border: 1px dashed #b7c7e0;
  border-radius: 10px;
  background: transparent;
  color: var(--blue);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.add-row:hover {
  background: #f3f7ff;
}

.site-editor {
  display: grid;
  grid-template-columns: minmax(160px, 200px) minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.field.grow {
  min-width: 0;
}

.site-add {
  margin-bottom: 1px;
}

.pairs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.pair-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #f8fafc;
  color: #334155;
  font-size: 12px;
  line-height: 1.3;
}

.pair-chip strong {
  font-weight: 650;
}

.pair-chip em {
  color: var(--muted);
  font-style: normal;
}

.pair-remove {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.pair-remove:hover {
  color: #b42318;
}

.empty-inline {
  margin-top: 10px;
}

.per-domain {
  width: min(180px, 100%);
  margin-top: 14px;
}

.submit-bar {
  display: grid;
  gap: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);
}

.submit-opts,
.submit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.submit-actions {
  justify-content: flex-end;
}

.submit-actions .meta {
  margin-right: auto;
}

.submit-note {
  padding-top: 2px;
  border-top: 1px dashed var(--line);
}

.list-panel {
  padding-bottom: 12px;
}

.job-list {
  display: grid;
  gap: 12px;
}

.job {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fbfcfe;
}

.job header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.job-title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.group-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.job-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}

.job-meta span {
  padding: 2px 0;
}

.status {
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2f7;
  font-size: 12px;
}

.status[data-status='success'] {
  background: #e8f7ee;
  color: #18794e;
}

.status[data-status='failed'] {
  background: #fdecec;
  color: #b42318;
}

.status[data-status='partial_success'] {
  background: #fff6e5;
  color: #b54708;
}

.country-block {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}

.country-block h5 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
}

.article-table {
  display: grid;
  gap: 6px;
}

.article-head,
.article-row {
  display: grid;
  grid-template-columns: 1.1fr 0.7fr 0.9fr 1.8fr;
  gap: 8px;
  align-items: start;
  font-size: 12px;
}

.article-head {
  color: var(--muted);
  font-weight: 650;
}

.article-row {
  padding: 8px 0;
  border-top: 1px dashed var(--line);
}

.mono {
  font-family: var(--mono);
}

.link-cell {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.link-cell a {
  color: var(--blue);
  word-break: break-all;
  text-decoration: none;
}

.link-cell em {
  font-style: normal;
  color: var(--muted);
}

.link-cell em.ok {
  color: #18794e;
}

.link-cell em.err {
  color: #b42318;
}

.link-cell em.pending {
  color: var(--muted);
}

.dash {
  color: var(--muted);
}

code {
  font-family: var(--mono);
}

@media (max-width: 900px) {
  .hero,
  .hero-actions,
  .submit-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .hero-stats {
    width: 100%;
  }

  .stat {
    flex: 1;
  }

  .locale-picks,
  .site-editor,
  .seed-table-head,
  .seed-row {
    grid-template-columns: 1fr;
  }

  .seed-table-head {
    display: none;
  }

  .seed-index {
    margin: 0;
  }

  .submit-actions .meta {
    margin-right: 0;
  }

  .article-head,
  .article-row {
    grid-template-columns: 1fr;
  }

  .article-head {
    display: none;
  }
}
</style>
