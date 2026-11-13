<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getAccountList, getLanguageList, getSiteList, type AccountOption, type LanguageOption, type SiteOption } from '../api/article'
import { createArticleJob, getArticleJob, platformUserFromToken } from '../api/articleJobs'
import { errorMessage } from '../api/http'
import {
  addLandpulseOffer,
  listOfferCategories,
  type LandpulseOfferCategory,
} from '../api/landpulseOffer'
import { createCampaign, getAfsAccounts, type AccountOption as AfsOption } from '../api/mis'
import { loadOpsCenterFunnelCatalog } from '../api/opsCenterLocal'
import { articleReady, misReady, serviceConfig } from '../config/env'
import { isTerminalJobStatus } from '../domain/articleJobStore'
import { buildCreatePayload, channelFromUrl, landingUrlFromCreated } from '../domain/campaignForm'
import { FUNNEL_BROWSE_ALLOWLIST } from '../domain/funnelBrowseAllowlist'
import { pickOfferJobResult, resolveLanguageId } from '../domain/funnelOfferGenerate'
import {
  OFFER_CREATE_STEP_LABEL,
  bareHost,
  buildOfferCreateName,
  buildOfferCreateUrls,
  buildRowsFromAllowlistFunnels,
  defaultOfferCreateBatch,
  emptyOfferCreateRow,
  matchAccountByLabel,
  matchAfsByLabel,
  matchSiteByDomain,
  parseOfferCreateLines,
  type OfferCreateBatchDefaults,
  type OfferCreateRowState,
  type OfferCreateStep,
} from '../domain/offerCreate'

const batch = ref<OfferCreateBatchDefaults>(defaultOfferCreateBatch())
const rows = ref<OfferCreateRowState[]>([])
const pasteText = ref('')
const accounts = ref<AccountOption[]>([])
const sites = ref<SiteOption[]>([])
const afsAccounts = ref<AfsOption[]>([])
const languages = ref<LanguageOption[]>([])
const categories = ref<LandpulseOfferCategory[]>([])
const accountId = ref<number | string | undefined>()
const siteId = ref<number | string | undefined>()
const afsSource = ref('')
const loadingMeta = ref(false)
const importingFunnels = ref(false)
const running = ref(false)
const progress = ref('')
let stopped = false

const ready = computed(() => articleReady && misReady)

const siteOptions = computed(() => {
  if (accountId.value == null || accountId.value === '') return sites.value
  return sites.value.filter((s) => String(s.accountId ?? '') === String(accountId.value))
})

const doneCount = computed(() => rows.value.filter((r) => r.step === 'done').length)
const failCount = computed(() => rows.value.filter((r) => r.step === 'failed').length)

const selectedSite = computed(() => sites.value.find((s) => String(s.id) === String(siteId.value)))

onMounted(async () => {
  await loadMeta()
})

onUnmounted(() => {
  stopped = true
})

async function loadMeta() {
  if (!ready.value) return
  loadingMeta.value = true
  try {
    const [accountList, siteList, afsList, languageList, categoryList] = await Promise.all([
      getAccountList(),
      getSiteList(),
      getAfsAccounts(),
      getLanguageList(),
      listOfferCategories().catch(() => [] as LandpulseOfferCategory[]),
    ])
    accounts.value = accountList
    sites.value = siteList
    afsAccounts.value = afsList
    languages.value = languageList
    categories.value = categoryList

    const account = matchAccountByLabel(accountList, batch.value.accountLabel)
    if (account) accountId.value = account.id

    const afs = matchAfsByLabel(afsList, batch.value.afsLabel)
    if (afs) afsSource.value = afs.value

    const site = matchSiteByDomain(siteList, batch.value.domain, accountId.value)
    if (site) {
      siteId.value = site.id
      if (!accountId.value && site.accountId != null) accountId.value = site.accountId
    }

    if (batch.value.languageId == null) {
      batch.value.languageId = resolveLanguageId(languageList, null)
    }

    if (!batch.value.offerCategoryId && categoryList.length) {
      const prefer =
        categoryList.find((c) => /cosmetic|beauty|美妆|化妆/i.test(c.categoryName)) ||
        categoryList.find((c) => c.categoryId !== '-1') ||
        categoryList[0]
      if (prefer) batch.value.offerCategoryId = prefer.categoryId
    }

    progress.value = `类目 ${categoryList.length} · 账户 ${account?.name || '未匹配'} · 站点 ${site?.siteName || '未匹配'} · AFS ${afs?.label || '未匹配'}`
    if (rows.value.length === 0) {
      await importAllowlistFunnels({ silent: true })
    }
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    loadingMeta.value = false
  }
}

function addRow() {
  rows.value.push(emptyOfferCreateRow({ partner: batch.value.partner }))
}

function removeRow(id: string) {
  if (rows.value.length === 1) {
    rows.value[0] = emptyOfferCreateRow({ partner: batch.value.partner })
    return
  }
  rows.value = rows.value.filter((r) => r.id !== id)
}

function applyPaste() {
  const parsed = parseOfferCreateLines(pasteText.value, batch.value.partner)
  if (!parsed.length) {
    ElMessage.warning('没有解析到有效行（每行一个 ref，或 partner\\tref）')
    return
  }
  rows.value = parsed.map((item) => emptyOfferCreateRow(item))
  ElMessage.success(`已导入 ${parsed.length} 行`)
}

async function importAllowlistFunnels(options?: { silent?: boolean }) {
  if (importingFunnels.value) return
  importingFunnels.value = true
  try {
    const catalog = await loadOpsCenterFunnelCatalog()
    const built = buildRowsFromAllowlistFunnels(
      catalog.funnels.map((f) => ({
        funnelId: String(f.funnelId || ''),
        funnelName: String(f.funnelName || ''),
      })),
      { allowNames: FUNNEL_BROWSE_ALLOWLIST },
    )
    if (!built.length) {
      throw new Error('白名单漏斗在本地目录中一个都没匹配到，请先在漏斗总览拉取')
    }
    const missing = FUNNEL_BROWSE_ALLOWLIST.length - built.length
    rows.value = built.map((item) => emptyOfferCreateRow(item))
    const msg = `已导入白名单 ${built.length} 个漏斗（4 美妆词轮询）${missing > 0 ? `，缺 ${missing} 个未在目录中` : ''}`
    progress.value = msg
    if (!options?.silent) ElMessage.success(msg)
  } catch (error) {
    if (!options?.silent) ElMessage.error(errorMessage(error))
    else progress.value = errorMessage(error)
  } finally {
    importingFunnels.value = false
  }
}

function stepLabel(step: OfferCreateStep) {
  return OFFER_CREATE_STEP_LABEL[step] || step
}

function patchRow(id: string, patch: Partial<OfferCreateRowState>) {
  const index = rows.value.findIndex((r) => r.id === id)
  if (index < 0) return
  rows.value[index] = { ...rows.value[index], ...patch }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitArticleId(taskId: string, domain: string, rowId: string): Promise<string> {
  patchRow(rowId, { step: 'poll', note: '轮询编排结果…', taskId })
  for (let i = 0; i < 120; i += 1) {
    if (stopped) throw new Error('已停止')
    const detail = await getArticleJob(taskId)
    const status = String(detail.status || '')
    const picked = pickOfferJobResult(detail.results, domain)
    if (picked?.articleId) {
      return picked.articleId
    }
    if (isTerminalJobStatus(status) && status === 'failed') {
      throw new Error(detail.error_message || '编排失败')
    }
    if (isTerminalJobStatus(status) && !picked?.articleId) {
      throw new Error('编排结束但没有 article_id')
    }
    const p = detail.progress
    patchRow(rowId, {
      note: `编排 ${status}${p ? ` ${p.completed}/${p.total}` : ''}…`,
    })
    await sleep(5000)
  }
  throw new Error('编排超时（约 10 分钟）')
}

async function ensureChannel(
  row: OfferCreateRowState,
  domain: string,
  articleId: string,
): Promise<string> {
  const existing = String(row.channelId || '').trim()
  if (existing) return existing
  if (!afsSource.value) throw new Error('请选择 AFS 账户')
  patchRow(row.id, { step: 'campaign', note: '调用 campaign/add…', error: '' })
  const form = {
    source: afsSource.value,
    articleId,
    siteName: domain,
    investTitle: row.ref,
  }
  const payload = buildCreatePayload(form)
  const created = await createCampaign({ ...payload })
  const channel = channelFromUrl(created) || channelFromUrl(landingUrlFromCreated(form, created))
  if (!channel) throw new Error('campaign/add 成功但未解析到 channel')
  patchRow(row.id, { channelId: channel, note: `渠道 ${channel}` })
  return channel
}

async function processRow(row: OfferCreateRowState) {
  const domain = bareHost(batch.value.domain)
  const partner = (row.partner || batch.value.partner).trim()
  if (!row.ref.trim()) throw new Error('缺少 ref / 种子词')
  if (!batch.value.offerCategoryId) throw new Error('请选择 Offer 类目')
  if (!batch.value.offerSourceId.trim()) throw new Error('缺少 offerSourceId')
  if (accountId.value == null || accountId.value === '') throw new Error('请选择文章账户 A17')
  if (siteId.value == null || siteId.value === '') throw new Error('请选择网站 seekmoon.ai')
  const languageId = batch.value.languageId ?? resolveLanguageId(languages.value, null)
  if (!languageId) throw new Error('缺少 languageId')

  // MIS campaign/add 需要真实 articleId，故先编排产文，再创建渠道拼链
  let articleId = String(row.articleId || '').trim()
  if (!articleId) {
    patchRow(row.id, { step: 'orchestrate', note: '发起编排…', error: '' })
    const user = platformUserFromToken(serviceConfig.articleToken)
    const job = await createArticleJob({
      intentKeyword: row.ref.trim(),
      categoryId: batch.value.articleCategoryId,
      languageId,
      regionId: batch.value.regionId || 'US',
      userId: user.userId,
      userName: user.userName,
      targets: [
        {
          domain,
          site_id: siteId.value,
          account_id: accountId.value,
        },
      ],
      publish: true,
      articlesPerDomain: 1,
      idempotencyKey: `offer-create-${Date.now()}-${row.id}`,
    })
    const taskId = String(job.task_id || '').trim()
    if (!taskId) throw new Error('未返回 task_id')
    patchRow(row.id, { taskId })
    articleId = await waitArticleId(taskId, domain, row.id)
    patchRow(row.id, { articleId, note: `文章 ${articleId}` })
  }

  const channelId = await ensureChannel(row, domain, articleId)
  patchRow(row.id, { step: 'buildUrl', note: '拼落地链…' })

  const { url, resultUrl } = buildOfferCreateUrls({
    domain,
    articleId,
    channelId,
    ref: row.ref.trim(),
  })
  const offerName = buildOfferCreateName({
    partner,
    version: batch.value.version,
    accountCode: batch.value.accountLabel || 'A17',
    countryCode: batch.value.countryCode,
    channelId,
    domain,
    funnelName: row.funnelName,
  })
  patchRow(row.id, { url, resultUrl, offerName, step: 'addOffer', note: '调用 offer/add…' })

  const offerId = await addLandpulseOffer({
    offerCategoryId: batch.value.offerCategoryId,
    offerName,
    countryCode: batch.value.countryCode || 'US',
    url,
    offerSourceId: batch.value.offerSourceId.trim(),
    resultUrl,
  })
  patchRow(row.id, {
    step: 'done',
    offerId: offerId || '(已创建)',
    note: offerId ? `offerId ${offerId}` : '已创建（接口未返回 id）',
    error: '',
  })
}

async function runAll() {
  if (running.value || !ready.value) return
  stopped = false
  running.value = true
  let ok = 0
  let fail = 0
  for (let i = 0; i < rows.value.length; i += 1) {
    if (stopped) break
    const row = rows.value[i]
    if (row.step === 'done') {
      ok += 1
      continue
    }
    progress.value = `处理 ${i + 1}/${rows.value.length} · ${row.ref}`
    try {
      await processRow(row)
      ok += 1
    } catch (error) {
      fail += 1
      patchRow(row.id, {
        step: 'failed',
        error: errorMessage(error),
        note: errorMessage(error),
      })
    }
  }
  running.value = false
  progress.value = `完成：成功 ${ok} · 失败 ${fail}`
  if (fail === 0) ElMessage.success(`全部完成 ${ok} 条`)
  else ElMessage.warning(`成功 ${ok} · 失败 ${fail}`)
}

async function retryRow(row: OfferCreateRowState) {
  if (running.value) return
  stopped = false
  running.value = true
  progress.value = `重试 · ${row.ref}`
  try {
    await processRow(row)
    ElMessage.success('这一条已完成')
  } catch (error) {
    patchRow(row.id, {
      step: 'failed',
      error: errorMessage(error),
      note: errorMessage(error),
    })
    ElMessage.error(errorMessage(error))
  } finally {
    running.value = false
  }
}

function stopRun() {
  stopped = true
  progress.value = '正在停止…'
}

function copyText(text: string) {
  if (!text) return
  void navigator.clipboard.writeText(text).then(
    () => ElMessage.success('已复制'),
    () => ElMessage.error('复制失败'),
  )
}

function copyDoneSummary() {
  const lines = rows.value
    .filter((r) => r.step === 'done')
    .map((r) =>
      [r.funnelName || '', r.funnelId || '', r.offerId, r.offerName, r.ref, r.url, r.resultUrl].join('\t'),
    )
  if (!lines.length) {
    ElMessage.warning('还没有完成的行')
    return
  }
  copyText(
    ['funnelName\tfunnelId\tofferId\tofferName\tref\turl\tresultUrl', ...lines].join('\n'),
  )
}
</script>

<template>
  <div class="panel">
    <header class="head">
      <div>
        <h2>创建 Offer</h2>
        <p>
          仅为白名单漏斗各建 1 条：4 美妆词轮询 → 编排产文 → campaign/add → offer/add。命名
          <code>{漏斗名}-A17-us-{channel}-seekmoon.ai</code>。创建后自行挂漏斗。
        </p>
      </div>
      <div class="head-actions">
        <el-button :loading="loadingMeta" @click="loadMeta">刷新账户/类目</el-button>
        <el-button v-if="running" @click="stopRun">停止</el-button>
        <el-button type="primary" :disabled="!ready || running" :loading="running" @click="runAll">
          开始批量创建
        </el-button>
      </div>
    </header>

    <el-alert
      v-if="!ready"
      type="warning"
      :closable="false"
      title="需要同时配置文章接口与 MIS（.env.local）后才能创建"
      class="mb"
    />

    <section class="card">
      <h3>批级默认</h3>
      <div class="grid">
        <label>
          <span>域名</span>
          <el-input v-model="batch.domain" placeholder="seekmoon.ai" />
        </label>
        <label>
          <span>文章账户</span>
          <el-select v-model="accountId" filterable placeholder="A17">
            <el-option v-for="item in accounts" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </label>
        <label>
          <span>网站</span>
          <el-select v-model="siteId" filterable placeholder="seekmoon.ai">
            <el-option
              v-for="item in siteOptions"
              :key="item.id"
              :label="item.siteName"
              :value="item.id"
            />
          </el-select>
        </label>
        <label>
          <span>AFS</span>
          <el-select v-model="afsSource" filterable placeholder="AFS17">
            <el-option
              v-for="item in afsAccounts"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </label>
        <label>
          <span>Offer 类目</span>
          <el-select v-model="batch.offerCategoryId" filterable clearable placeholder="从 listByType 选择">
            <el-option
              v-for="item in categories"
              :key="item.categoryId"
              :label="`${item.categoryName} (${item.categoryId})`"
              :value="item.categoryId"
            />
          </el-select>
        </label>
        <label>
          <span>offerSourceId</span>
          <el-input v-model="batch.offerSourceId" />
        </label>
        <label>
          <span>默认 partner</span>
          <el-input v-model="batch.partner" placeholder="blinkdrama" />
        </label>
        <label>
          <span>版本段</span>
          <el-input v-model="batch.version" placeholder="v0x" />
        </label>
        <label>
          <span>账户码（进名称）</span>
          <el-input v-model="batch.accountLabel" placeholder="A17" />
        </label>
        <label>
          <span>国家</span>
          <el-input v-model="batch.countryCode" placeholder="US" />
        </label>
        <label>
          <span>产文类目 id</span>
          <el-input-number v-model="batch.articleCategoryId" :min="1" controls-position="right" />
        </label>
        <label>
          <span>languageId</span>
          <el-input-number v-model="batch.languageId" :min="1" controls-position="right" />
        </label>
      </div>
      <p class="hint">
        命名：
        <code>&#123;漏斗名&#125;-{{ batch.accountLabel || 'A17' }}-us-&#123;channel&#125;-{{ bareHost(batch.domain) || 'seekmoon.ai' }}</code>
        · 白名单 {{ FUNNEL_BROWSE_ALLOWLIST.length }} · 站点 {{ selectedSite?.siteName || '—' }} · {{ progress }}
      </p>
      <p v-if="categories.length === 0" class="hint warn">
        未拉到 Offer 类目。可点「刷新账户/类目」；若仍为空请检查 MIS token 是否能访问
        <code>/landpulse/category/listByType?categoryType=offer</code>
      </p>
    </section>

    <section class="card">
      <div class="row-head">
        <h3>待创建行 {{ doneCount }}/{{ rows.length }}<template v-if="failCount"> · 失败 {{ failCount }}</template></h3>
        <div class="row-actions">
          <el-button :loading="importingFunnels" :disabled="running" @click="importAllowlistFunnels()">
            按白名单漏斗导入
          </el-button>
          <el-button :disabled="running" @click="addRow">加一行</el-button>
          <el-button :disabled="!doneCount" @click="copyDoneSummary">复制完成结果</el-button>
        </div>
      </div>
      <label class="paste">
        <span>粘贴导入（每行一个 ref，或 partner[Tab]ref）</span>
        <el-input v-model="pasteText" type="textarea" :rows="3" placeholder="Cosmetic Products" />
        <el-button class="mt" @click="applyPaste">覆盖为粘贴内容</el-button>
      </label>

      <el-table :data="rows" size="small" border class="mt">
        <el-table-column label="#" width="48" type="index" />
        <el-table-column label="漏斗" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <strong>{{ row.funnelName || '—' }}</strong>
          </template>
        </el-table-column>
        <el-table-column label="partner" width="120">
          <template #default="{ row }">
            <el-input v-model="row.partner" size="small" :disabled="running" />
          </template>
        </el-table-column>
        <el-table-column label="ref / 种子词" min-width="180">
          <template #default="{ row }">
            <el-input v-model="row.ref" size="small" :disabled="running" />
          </template>
        </el-table-column>
        <el-table-column label="渠道" width="120">
          <template #default="{ row }">
            <el-input v-model="row.channelId" size="small" placeholder="空则 add" :disabled="running" />
          </template>
        </el-table-column>
        <el-table-column label="步骤" width="100">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.step === 'done' ? 'success' : row.step === 'failed' ? 'danger' : 'info'"
            >
              {{ stepLabel(row.step) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="进度" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span :class="{ err: row.step === 'failed' }">{{ row.note || row.error || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="文章" width="120" prop="articleId" show-overflow-tooltip />
        <el-table-column label="offer 名" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.offerName || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="offerId" width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <el-button v-if="row.offerId" link type="primary" @click="copyText(row.offerId)">
              {{ row.offerId }}
            </el-button>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="链接" min-width="160">
          <template #default="{ row }">
            <el-button v-if="row.url" link type="primary" @click="copyText(row.url)">复制 url</el-button>
            <el-button v-if="row.resultUrl" link type="primary" @click="copyText(row.resultUrl)">
              复制 resultUrl
            </el-button>
            <span v-if="!row.url">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" :disabled="running" @click="removeRow(row.id)">删</el-button>
            <el-button
              v-if="row.step === 'failed' || row.step === 'idle'"
              link
              type="primary"
              :disabled="running"
              @click="retryRow(row)"
            >
              {{ row.step === 'failed' ? '重试' : '只跑这条' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding: 4px 2px 24px;
}

.head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.head h2 {
  margin: 0 0 4px;
  font-size: 18px;
}

.head p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 16px;
}

.card h3 {
  margin: 0 0 12px;
  font-size: 15px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px 14px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #475569;
}

.hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #64748b;
}

.hint.warn {
  color: #b45309;
}

.hint code {
  font-size: 12px;
}

.row-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.row-head h3 {
  margin: 0;
}

.row-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.paste {
  margin-bottom: 8px;
}

.mb {
  margin-bottom: 0;
}

.mt {
  margin-top: 8px;
}

.err {
  color: #b91c1c;
}
</style>
