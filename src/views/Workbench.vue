<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getAccountList,
  getOperationConfigDetail,
  getOperationConfigPage,
  getSiteList,
  updateOperationConfig,
  type AccountOption,
  type OperationConfigRow,
  type SiteOption,
} from '../api/article'
import { errorMessage } from '../api/http'
import { pushDailyToFeishu } from '../api/feishuPush'
import { saveConfigArticles } from '../api/reportCache'
import { fetchGenerationLog, insertGenerationRecord, clearGenerationRecords } from '../api/generationLog'
import { channelFromUrl, isHttpUrl } from '../domain/campaignForm'
import { articleIdFromUrl, changedArticleLinks, sourceFromAccountName } from '../domain/report'
import { articleDomain } from '../domain/batch'
import { appendGeneratedUrls, buildUpdatePayload, countRecentArticles, normalizeRecentArticles, recentArticleItems, removeRecentArticle, replaceRecentArticle } from '../domain/recentArticles'
import BatchForm from '../components/BatchForm.vue'
import CategoryRecyclePanel from '../components/CategoryRecyclePanel.vue'
import DirectLinkForm from '../components/DirectLinkForm.vue'
import GenerationLog from '../components/GenerationLog.vue'
import DailyReport from '../components/DailyReport.vue'
import { generationLogOpen, generationRecords } from '../generationLogUi'
import {
  createGenerationRecord,
  prependGenerationRecord,
  type GenerationDraft,
} from '../domain/generationLog'

const PAGE_SIZE = 10

const sites = ref<SiteOption[]>([])
const accounts = ref<AccountOption[]>([])
const siteId = ref<number | string | undefined>()
const filterAccountId = ref<number | string | undefined>()
const pageNum = ref(1)
const total = ref(0)
const records = ref<OperationConfigRow[]>([])
const listLoading = ref(false)
const selectedId = ref<number | string | null>(null)
const detail = ref<Record<string, unknown> | null>(null)
const detailLoading = ref(false)
const generatedUrls = ref<string[]>([])
let insertChain = Promise.resolve()
const manualUrl = ref('')
const manualError = ref('')
const writing = ref(false)
const feishuPushing = ref<'today' | 'yesterday' | ''>('')
const highlightIndexes = ref<number[]>([])
const editingIndex = ref<number | null>(null)
const editingUrl = ref('')
const editingError = ref('')
let highlightTimer = 0

const articles = computed(() =>
  recentArticleItems(detail.value?.recentArticles).map((item) => ({
    url: item.url,
    channel: channelFromUrl(item.url),
    countryCode: item.countryCode,
  })),
)

const reportSiteLabel = computed(() => {
  const row = records.value.find((item) => item.id === selectedId.value)
  return row ? siteLabel(row) : ''
})

const reportUrls = computed(() => (detail.value == null ? [] : articles.value.map((item) => item.url)))

const reportCountryCodes = computed(() => {
  const codes: Record<string, string> = {}
  if (detail.value == null) {
    return codes
  }
  for (const article of articles.value) {
    const articleId = articleIdFromUrl(article.url)
    if (articleId && article.countryCode) {
      codes[articleId] = article.countryCode
    }
  }
  return codes
})

const reportAccountId = computed(() => {
  const fromDetail = detail.value?.accountId
  if (fromDetail != null && fromDetail !== '') {
    return String(fromDetail)
  }
  const row = records.value.find((item) => item.id === selectedId.value) as OperationConfigRow & { accountId?: number | string }
  return row?.accountId == null || row.accountId === '' ? '' : String(row.accountId)
})

const reportAccountName = computed(() => {
  const id = reportAccountId.value
  if (!id) {
    return ''
  }
  return accounts.value.find((item) => String(item.id) === id)?.name?.trim() || ''
})

const reportAccountSource = computed(() => sourceFromAccountName(reportAccountName.value))

const canWrite = computed(() => selectedId.value != null && generatedUrls.value.length > 0)
const moduleName = ref<'report' | 'recycle' | 'copy' | 'direct'>('report')
const directDomain = computed(() => {
  const row = records.value.find((item) => item.id === selectedId.value)
  const site = sites.value.find((item) => item.id === row?.siteId)
  return articleDomain(site) || String(row?.siteName ?? '').trim()
})
const filterSiteOptions = computed(() => {
  if (filterAccountId.value == null || filterAccountId.value === '') {
    return sites.value
  }
  return sites.value.filter((site) => site.accountId == filterAccountId.value)
})

onMounted(() => {
  void loadSites()
  void loadAccounts()
  void loadPage()
  void loadGenerationLog()
})

async function loadSites() {
  try {
    sites.value = await getSiteList()
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
}

async function loadAccounts() {
  try {
    accounts.value = await getAccountList()
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
}

async function loadPage() {
  listLoading.value = true
  try {
    const result = await getOperationConfigPage({
      pageNum: pageNum.value,
      pageSize: PAGE_SIZE,
      ...(siteId.value ? { siteId: siteId.value } : {}),
      ...(filterAccountId.value ? { accountId: filterAccountId.value } : {}),
    })
    records.value = result.records
    total.value = result.total
    if (selectedId.value == null && records.value[0]) {
      void selectConfig(records.value[0])
    }
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    listLoading.value = false
  }
}

function search() {
  pageNum.value = 1
  void loadPage()
}

function onFilterAccountChange() {
  const stillValid = filterSiteOptions.value.some((site) => site.id == siteId.value)
  if (!stillValid) {
    siteId.value = undefined
  }
  search()
}

async function selectConfig(row: OperationConfigRow) {
  if (selectedId.value !== row.id) {
    highlightIndexes.value = []
    cancelEdit()
    detail.value = null
  }
  selectedId.value = row.id
  detailLoading.value = true
  try {
    detail.value = await getOperationConfigDetail(row.id)
  } catch (error) {
    detail.value = null
    ElMessage.error(errorMessage(error))
  } finally {
    detailLoading.value = false
  }
}

function onGenerated(urls: string[]) {
  generatedUrls.value = urls
}

async function loadGenerationLog() {
  try {
    generationRecords.value = await fetchGenerationLog()
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
}

function onRecorded(draft: GenerationDraft) {
  const record = createGenerationRecord(draft, Date.now())
  generationRecords.value = prependGenerationRecord(generationRecords.value, record)
  insertChain = insertChain.then(async () => {
    try {
      await insertGenerationRecord(record)
    } catch (error) {
      ElMessage.error(errorMessage(error))
    }
  })
}

function clearGenerationLog() {
  const previous = generationRecords.value
  generationRecords.value = []
  insertChain = insertChain.then(async () => {
    try {
      await clearGenerationRecords()
    } catch (error) {
      generationRecords.value = previous
      ElMessage.error(errorMessage(error))
    }
  })
}

async function pushFeishu(kind: 'today' | 'yesterday') {
  if (feishuPushing.value) {
    return
  }
  feishuPushing.value = kind
  try {
    const message = await pushDailyToFeishu(kind)
    ElMessage.success(message)
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    feishuPushing.value = ''
  }
}

async function copyUrls() {
  try {
    await navigator.clipboard.writeText(generatedUrls.value.join('\n'))
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

function confirmBody(urls: string[]) {
  const preview = urls.slice(0, 8).map((url) => h('code', url))
  const more = urls.length > 8 ? h('p', { class: 'confirm-label' }, `其余 ${urls.length - 8} 条一并追加`) : null
  return h('div', { class: 'write-confirm' }, [
    h('p', { class: 'confirm-lead' }, `将 ${urls.length} 条链接追加到当前运营配置的推荐文章。`),
    ...preview,
    more,
  ])
}

async function writeUrls(urls: string[]) {
  if (selectedId.value == null || urls.length === 0) {
    return false
  }
  try {
    await ElMessageBox.confirm(confirmBody(urls), '确认写入', {
      confirmButtonText: '追加',
      cancelButtonText: '取消',
      customClass: 'write-dialog',
    })
  } catch {
    return false
  }

  writing.value = true
  try {
    const fresh = await getOperationConfigDetail(selectedId.value)
    const current = normalizeRecentArticles(fresh.recentArticles)
    const applied = appendGeneratedUrls(current, urls)
    if (!applied.ok) {
      ElMessage.error(applied.reason)
      return false
    }
    await updateOperationConfig(buildUpdatePayload(fresh, applied.urls))
    detail.value = await getOperationConfigDetail(selectedId.value)
    highlightIndexes.value = applied.highlightIndexes
    window.clearTimeout(highlightTimer)
    highlightTimer = window.setTimeout(() => {
      highlightIndexes.value = []
    }, 2000)
    ElMessage.success(`已追加 ${urls.length} 条推荐文章`)
    await loadPage()
    return true
  } catch (error) {
    ElMessage.error(errorMessage(error))
    return false
  } finally {
    writing.value = false
  }
}

async function writeUrl() {
  await writeUrls(generatedUrls.value)
}

async function writeManual() {
  const url = manualUrl.value.trim()
  if (selectedId.value == null) {
    manualError.value = '先选择一条运营配置'
    return
  }
  if (!isHttpUrl(url)) {
    manualError.value = '请输入以 http:// 或 https:// 开头的链接'
    return
  }
  manualError.value = ''
  const wrote = await writeUrls([url])
  if (wrote) {
    manualUrl.value = ''
  }
}

async function rememberChangedArticles(
  configId: number | string,
  before: Array<{ url: string; countryCode: string }>,
  afterUrls: string[],
) {
  const changed = changedArticleLinks(before, afterUrls)
  if (changed.length === 0) {
    return
  }
  const today = new Date()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const date = String(today.getDate()).padStart(2, '0')
  await saveConfigArticles(
    changed.map((link) => ({
      configId: String(configId),
      day: `${today.getFullYear()}-${month}-${date}`,
      articleId: link.articleId,
      channelId: link.channelId,
      countryCode: link.countryCode,
    })),
  )
}

function cancelEdit() {
  editingIndex.value = null
  editingUrl.value = ''
  editingError.value = ''
}

function startEdit(index: number, url: string) {
  editingIndex.value = index
  editingUrl.value = url
  editingError.value = ''
}

async function saveArticleChange(
  change: (current: string[]) => ReturnType<typeof replaceRecentArticle>,
  success: string,
) {
  if (selectedId.value == null) {
    return false
  }
  writing.value = true
  try {
    const fresh = await getOperationConfigDetail(selectedId.value)
    const before = recentArticleItems(fresh.recentArticles)
    const applied = change(normalizeRecentArticles(fresh.recentArticles))
    if (!applied.ok) {
      detail.value = fresh
      cancelEdit()
      ElMessage.error(applied.reason)
      return false
    }
    await rememberChangedArticles(selectedId.value, before, applied.urls)
    await updateOperationConfig(buildUpdatePayload(fresh, applied.urls))
    detail.value = await getOperationConfigDetail(selectedId.value)
    highlightIndexes.value = applied.highlightIndexes
    window.clearTimeout(highlightTimer)
    highlightTimer = window.setTimeout(() => {
      highlightIndexes.value = []
    }, 2000)
    ElMessage.success(success)
    await loadPage()
    return true
  } catch (error) {
    ElMessage.error(errorMessage(error))
    return false
  } finally {
    writing.value = false
  }
}

async function saveEdit(index: number, previous: string) {
  const next = editingUrl.value.trim()
  if (!isHttpUrl(next)) {
    editingError.value = '请输入以 http:// 或 https:// 开头的链接'
    return
  }
  if (next === previous) {
    cancelEdit()
    return
  }
  editingError.value = ''
  const saved = await saveArticleChange(
    (current) => replaceRecentArticle(current, index, previous, next),
    `已更新第 ${index + 1} 条推荐文章`,
  )
  if (saved) {
    cancelEdit()
  }
}

async function removeArticle(index: number, previous: string) {
  try {
    await ElMessageBox.confirm(
      h('div', { class: 'write-confirm' }, [
        h('p', { class: 'confirm-lead' }, `删除第 ${index + 1} 条推荐文章。`),
        h('code', previous),
      ]),
      '确认删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', customClass: 'write-dialog', type: 'warning' },
    )
  } catch {
    return
  }
  await saveArticleChange((current) => removeRecentArticle(current, index, previous), `已删除第 ${index + 1} 条推荐文章`)
}

function articleCount(row: OperationConfigRow): string {
  const count = countRecentArticles(row)
  return count == null ? '—' : `${count} 条`
}

function siteLabel(row: OperationConfigRow): string {
  return row.siteName || sites.value.find((site) => site.id === row.siteId)?.siteName || '未命名站点'
}
</script>

<template>
  <GenerationLog :records="generationRecords" @clear="clearGenerationLog" />
  <div class="workbench">
  <div class="workspace">
    <aside class="panel">
      <div class="panel-head">
        <div class="head-title">
          <h2>运营配置</h2>
          <span>{{ total }} 条</span>
        </div>
        <div class="tool-actions">
          <el-button @click="generationLogOpen = true">生成记录 {{ generationRecords.length }}</el-button>
          <el-button :loading="feishuPushing === 'today'" :disabled="feishuPushing !== ''" @click="pushFeishu('today')">
            飞书·今日
          </el-button>
          <el-button
            :loading="feishuPushing === 'yesterday'"
            :disabled="feishuPushing !== ''"
            @click="pushFeishu('yesterday')"
          >
            飞书·昨日
          </el-button>
        </div>
        <div class="filters">
          <el-select
            v-model="filterAccountId"
            clearable
            filterable
            placeholder="按账户筛选"
            @change="onFilterAccountChange"
          >
            <el-option v-for="account in accounts" :key="account.id" :label="account.name" :value="account.id" />
          </el-select>
          <el-select v-model="siteId" clearable filterable placeholder="按域名筛选" @change="search">
            <el-option v-for="site in filterSiteOptions" :key="site.id" :label="site.siteName" :value="site.id" />
          </el-select>
          <el-button @click="search">查询</el-button>
        </div>
      </div>

      <div v-loading="listLoading" class="panel-body">
        <p v-if="!listLoading && records.length === 0" class="empty">没有运营配置</p>
        <div
          v-for="row in records"
          :key="row.id"
          class="config-card"
          :class="{ selected: selectedId === row.id }"
          @click="selectConfig(row)"
        >
          <div class="card-top">
            <strong>{{ siteLabel(row) }}</strong>
            <span>{{ row.isPut ? '投流站' : '内容站' }}</span>
          </div>
          <p class="count">推荐文章 {{ articleCount(row) }}</p>

          <div v-if="selectedId === row.id" class="articles" @click.stop>
            <p v-if="detailLoading" class="empty">正在读取推荐文章</p>
            <p v-else-if="articles.length === 0" class="empty">还没有推荐文章</p>
            <div
              v-for="(article, index) in articles"
              :key="`${article.url}-${index}`"
              class="article"
              :class="{ fresh: highlightIndexes.includes(index) }"
            >
              <span class="index">{{ index + 1 }}</span>
              <template v-if="editingIndex === index">
                <el-input v-model="editingUrl" type="textarea" :rows="3" />
                <div class="article-actions">
                  <el-button size="small" type="primary" :loading="writing" @click="saveEdit(index, article.url)">保存</el-button>
                  <el-button size="small" :disabled="writing" @click="cancelEdit">取消</el-button>
                  <em v-if="editingError">{{ editingError }}</em>
                </div>
              </template>
              <template v-else>
                <span class="url">{{ article.url }}</span>
                <div class="article-meta">
                  <span class="channel">
                    <template v-if="article.countryCode">{{ article.countryCode }} · </template>{{ article.channel || '无渠道' }}
                  </span>
                  <div class="article-actions">
                    <el-button size="small" text :disabled="writing" @click="startEdit(index, article.url)">编辑</el-button>
                    <el-button size="small" text type="danger" :disabled="writing" @click="removeArticle(index, article.url)">删除</el-button>
                  </div>
                </div>
              </template>
            </div>
            <div class="manual-link">
              <el-input v-model="manualUrl" placeholder="自己粘贴一条 http 链接" @keyup.enter="writeManual" />
              <el-button :loading="writing" @click="writeManual">写入这条</el-button>
            </div>
            <em v-if="manualError" class="manual-error">{{ manualError }}</em>
          </div>
        </div>
      </div>

      <div class="panel-foot">
        <el-pagination
          v-model:current-page="pageNum"
          layout="prev, pager, next"
          :total="total"
          :page-size="PAGE_SIZE"
          hide-on-single-page
          @current-change="loadPage"
        />
      </div>
    </aside>

    <section class="panel form-panel">
      <el-tabs v-model="moduleName" type="border-card" class="modules">
        <el-tab-pane label="1 配置·日报" name="report">
          <DailyReport
            :config-id="selectedId"
            :site-label="reportSiteLabel"
            :urls="reportUrls"
            :country-codes="reportCountryCodes"
            :account-source="reportAccountSource"
            :account-name="reportAccountName"
          />
        </el-tab-pane>
        <el-tab-pane label="2 回收·各国收入" name="recycle">
          <CategoryRecyclePanel
            :site-label="reportSiteLabel"
            :urls="reportUrls"
            :country-codes="reportCountryCodes"
            :account-source="reportAccountSource"
            :account-name="reportAccountName"
          />
        </el-tab-pane>
        <el-tab-pane label="复制并生成链接" name="copy">
          <BatchForm @generated="onGenerated" @recorded="onRecorded">
            <template v-if="generatedUrls.length" #after>
              <el-button native-type="button" @click="copyUrls">复制</el-button>
              <el-button type="primary" native-type="button" :disabled="!canWrite" :loading="writing" @click="writeUrl">
                追加 {{ generatedUrls.length }} 条
              </el-button>
            </template>
          </BatchForm>
        </el-tab-pane>
        <el-tab-pane label="直接生成链接" name="direct">
          <DirectLinkForm :domain="directDomain" :writing="writing" @write="writeUrls" />
        </el-tab-pane>
      </el-tabs>
    </section>
  </div>
  </div>
</template>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 56px);
  min-height: 0;
}

.form-panel .modules {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.form-panel :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 8px;
}

.form-panel :deep(.el-tabs__item) {
  height: 48px;
  font-size: 14px;
}

.form-panel :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: var(--line);
}

.form-panel :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 20px 16px;
}

.form-panel :deep(.el-tab-pane) {
  height: 100%;
}

.workspace {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: #fff;
}

.panel-head,
.panel-foot {
  flex: 0 0 auto;
  padding: 16px;
}

.panel-head {
  border-bottom: 1px solid var(--line);
}

.panel-foot {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--line);
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.head-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}

.head-title h2 {
  margin: 0;
  font-size: 15px;
}

.head-title span,
.count {
  color: var(--muted);
  font-size: 12px;
}

.tool-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.filters .el-select {
  flex: 1 1 calc(50% - 4px);
  min-width: 0;
}

.config-card {
  display: block;
  width: 100%;
  margin-bottom: 8px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.config-card.selected {
  border-color: #b9d4ff;
  background: #f8fbff;
  box-shadow: inset 3px 0 0 var(--blue);
}

.card-top {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
}

.card-top strong {
  font-size: 14px;
  line-height: 1.4;
  word-break: break-all;
}

.card-top span {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--paper);
  color: var(--muted);
  font-size: 12px;
}

.count {
  margin: 6px 0 0;
}

.articles {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.article,
.append {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 4px 8px;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  color: inherit;
  text-align: left;
}

.article.selected,
.append.selected {
  border-color: var(--blue);
  background: #f3f8ff;
}

.article.fresh {
  background: #fff6d8;
}

.manual-link {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.manual-error {
  color: #c2410c;
  font-size: 12px;
  font-style: normal;
}

.index {
  grid-row: span 2;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.6;
}

.url {
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}

.channel {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}

.article-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.article-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  align-items: center;
}

.article-actions em {
  color: #c2410c;
  font-size: 12px;
  font-style: normal;
}

.append {
  display: block;
  color: var(--blue);
  font-size: 13px;
  text-align: center;
}

.empty {
  margin: 8px 0;
  color: var(--muted);
  font-size: 13px;
}

@media (max-width: 960px) {
  .workbench {
    height: auto;
    min-height: calc(100vh - 56px);
  }

  .workspace {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    height: auto;
    overflow: visible;
  }

  .panel {
    min-height: 420px;
  }
}
</style>
