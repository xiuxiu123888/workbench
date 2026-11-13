<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { copyArticle, getAccountList, getArticleDetail, getSiteList, updateArticle } from '../api/article'
import { errorMessage } from '../api/http'
import { createCampaign, getAfsAccounts, type AccountOption as AfsAccountOption } from '../api/mis'
import { articleDomain, buildArticleUpdate, collectArticleGroups } from '../domain/batch'
import { buildCreatePayload, buildDirectLandingUrl, isPureArticleId, landingUrlFromCreated } from '../domain/campaignForm'
import type { GenerationDraft } from '../domain/generationLog'

interface ArticleAccount {
  id: number | string
  name: string
}

interface SiteItem {
  id: number | string
  siteName: string
  siteUrl?: string
  accountId?: number | string
}

interface BatchRow {
  sourceId: string
  channelId: string
  linkRef: string
  newId: string
  title: string
  url: string
  status: string
}

interface DraftGroup {
  key: number
  articleId: string
  channelId: string
  linkRef: string
}

const emit = defineEmits<{
  generated: [urls: string[]]
  recorded: [draft: GenerationDraft]
}>()

let groupKey = 1
const groups = ref<DraftGroup[]>([{ key: groupKey, articleId: '', channelId: '', linkRef: '' }])
const articleAccounts = ref<ArticleAccount[]>([])
const sites = ref<SiteItem[]>([])
const afsAccounts = ref<AfsAccountOption[]>([])
const accountId = ref<number | string | undefined>()
const siteId = ref<number | string | undefined>()
const afsSource = ref('')
const running = ref(false)
const retryingId = ref('')
const rows = ref<BatchRow[]>([])
const fieldErrors = ref<Record<string, string>>({})
const activeStatuses = new Set(['等待', '复制中', '更新归属', '拼接链接', '生成链接'])

const siteOptions = computed(() => {
  if (accountId.value == null || accountId.value === '') {
    return sites.value
  }
  return sites.value.filter((site) => site.accountId == accountId.value)
})

const doneCount = computed(() => rows.value.filter((row) => row.url).length)

onMounted(async () => {
  try {
    const [accounts, siteList, afsList] = await Promise.all([getAccountList(), getSiteList(), getAfsAccounts()])
    articleAccounts.value = accounts
    sites.value = siteList
    afsAccounts.value = afsList
  } catch (error) {
    ElMessage.error(errorMessage(error))
  }
})

function onAccountChange() {
  const exists = siteOptions.value.some((site) => site.id == siteId.value)
  if (!exists) {
    siteId.value = undefined
  }
}

function addGroup() {
  groupKey += 1
  groups.value.push({ key: groupKey, articleId: '', channelId: '', linkRef: '' })
}

function removeGroup(key: number) {
  if (groups.value.length === 1) {
    groups.value[0].articleId = ''
    groups.value[0].channelId = ''
    groups.value[0].linkRef = ''
    return
  }
  groups.value = groups.value.filter((group) => group.key !== key)
}

function clearAll() {
  if (running.value || retryingId.value) {
    return
  }
  groupKey += 1
  groups.value = [{ key: groupKey, articleId: '', channelId: '', linkRef: '' }]
  rows.value = []
  fieldErrors.value = {}
  emit('generated', [])
}

function canRetry(row: BatchRow) {
  if (row.status === '完成' || activeStatuses.has(row.status)) {
    return false
  }
  if (retryingId.value === row.sourceId) {
    return true
  }
  return !running.value
}

function sharedErrors(needsCreate: boolean) {
  const errors: Record<string, string> = {}
  if (accountId.value == null || accountId.value === '') {
    errors.accountId = '请选择文章账户'
  }
  if (siteId.value == null || siteId.value === '') {
    errors.siteId = '请选择网站'
  }
  if (needsCreate && !afsSource.value) {
    errors.afsSource = '请选择 AFS 账户'
  }
  const site = sites.value.find((item) => item.id == siteId.value)
  const domain = articleDomain(site)
  if (siteId.value != null && siteId.value !== '' && !domain) {
    errors.siteId = '这个网站没有域名'
  }
  return { errors, site, domain }
}

function publishUrls() {
  emit('generated', rows.value.map((row) => row.url).filter((url) => url))
}

function emitRecord(row: BatchRow, siteName: string, ok: boolean, message: string) {
  const account = articleAccounts.value.find((item) => item.id == accountId.value)
  const afs = afsAccounts.value.find((item) => item.value === afsSource.value)
  emit('recorded', {
    sourceArticleId: row.sourceId,
    newArticleId: row.newId,
    title: row.title,
    linkRef: row.linkRef,
    url: row.url,
    siteName,
    articleAccount: account?.name || '',
    afsAccount: afs?.label || afsSource.value,
    ok,
    message,
  })
}

async function processRow(row: BatchRow, domain: string, siteName: string) {
  try {
    if (!row.newId) {
      row.status = '复制中'
      row.newId = await copyArticle(isPureArticleId(row.sourceId) ? Number(row.sourceId) : row.sourceId)
    }
    row.status = '更新归属'
    const detail = await getArticleDetail(row.newId)
    row.title = String(detail.title ?? '').trim()
    await updateArticle(buildArticleUpdate(detail, accountId.value as number | string, siteId.value as number | string))
    if (row.channelId) {
      row.status = '拼接链接'
      row.url = buildDirectLandingUrl(domain, row.newId, row.channelId, row.linkRef)
    } else {
      row.status = '生成链接'
      const payload = buildCreatePayload({
        source: afsSource.value,
        articleId: row.newId,
        siteName: domain,
        investTitle: row.linkRef,
      })
      const created = await createCampaign({ ...payload })
      row.url = landingUrlFromCreated(payload, created)
    }
    row.status = '完成'
    emitRecord(row, siteName, true, '完成')
    return true
  } catch (error) {
    row.status = errorMessage(error)
    emitRecord(row, siteName, false, row.status)
    return false
  }
}

async function run() {
  if (running.value) {
    return
  }
  const collected = collectArticleGroups(groups.value)
  const needsCreate = groups.value.some(
    (group) => (group.articleId.trim() || group.linkRef.trim() || group.channelId.trim()) && !group.channelId.trim(),
  )
  const { errors, site, domain } = sharedErrors(needsCreate)
  if (!collected.ok) {
    errors.groups = collected.message
  }
  fieldErrors.value = errors
  if (Object.keys(errors).length > 0 || !collected.ok) {
    return
  }

  running.value = true
  rows.value = collected.groups.map((group) => ({
    sourceId: group.articleId,
    channelId: group.channelId,
    linkRef: group.linkRef,
    newId: '',
    title: '',
    url: '',
    status: '等待',
  }))

  for (const row of rows.value) {
    await processRow(row, domain, site?.siteName || domain)
  }

  publishUrls()
  running.value = false
  const urls = rows.value.filter((row) => row.url)
  if (urls.length === 0) {
    ElMessage.error('没有生成成功的链接')
  } else {
    ElMessage.success(`已生成 ${urls.length} 条链接`)
  }
}

async function retry(row: BatchRow) {
  if (running.value || !canRetry(row)) {
    return
  }
  const { errors, site, domain } = sharedErrors(!row.channelId)
  fieldErrors.value = errors
  if (Object.keys(errors).length > 0) {
    return
  }
  retryingId.value = row.sourceId
  running.value = true
  const ok = await processRow(row, domain, site?.siteName || domain)
  publishUrls()
  running.value = false
  retryingId.value = ''
  if (ok) {
    ElMessage.success('这一条已生成')
  }
}
</script>

<template>
  <form class="campaign" @submit.prevent="run">
    <div class="campaign-scroll">
      <section>
        <h2>复制并生成</h2>
        <p class="hint">整批共用文章账户和网站。每篇都要填 ref，先复制再只改归属。填了渠道 ID 就不再调用创建投放，用新文章 ID 和 ref 拼链接。没填渠道 ID 时还要选择 AFS 账户。</p>
        <div class="groups">
          <div v-for="(group, index) in groups" :key="group.key" class="group">
            <span class="group-index">{{ index + 1 }}</span>
            <label>
              <span>文章 ID</span>
              <el-input v-model="group.articleId" placeholder="原文章 ID" />
            </label>
            <label>
              <span>渠道 ID</span>
              <el-input v-model="group.channelId" placeholder="已有渠道就填写" />
            </label>
            <label>
              <span>ref</span>
              <el-input v-model="group.linkRef" placeholder="这条链接的 ref" />
            </label>
            <el-button text @click="removeGroup(group.key)">删除</el-button>
          </div>
          <div class="group-actions">
            <el-button @click="addGroup">添加一组</el-button>
            <el-button :disabled="running || Boolean(retryingId)" @click="clearAll">全部清除</el-button>
          </div>
          <em v-if="fieldErrors.groups">{{ fieldErrors.groups }}</em>
        </div>
        <label>
          <span>文章账户</span>
          <el-select v-model="accountId" filterable placeholder="请选择文章账户" @change="onAccountChange">
            <el-option v-for="item in articleAccounts" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
          <em v-if="fieldErrors.accountId">{{ fieldErrors.accountId }}</em>
        </label>
        <label>
          <span>网站</span>
          <el-select v-model="siteId" filterable placeholder="请选择网站">
            <el-option v-for="item in siteOptions" :key="item.id" :label="item.siteName" :value="item.id" />
          </el-select>
          <em v-if="fieldErrors.siteId">{{ fieldErrors.siteId }}</em>
        </label>
        <label>
          <span>AFS 账户</span>
          <el-select v-model="afsSource" filterable placeholder="请选择 AFS 账户">
            <el-option v-for="item in afsAccounts" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <em v-if="fieldErrors.afsSource">{{ fieldErrors.afsSource }}</em>
        </label>
      </section>

      <section v-if="rows.length" class="result-list">
        <h2>处理结果 {{ doneCount }}/{{ rows.length }}</h2>
        <article v-for="row in rows" :key="row.sourceId" class="batch-row">
          <div class="batch-top">
            <strong>{{ row.sourceId }}<template v-if="row.newId"> → {{ row.newId }}</template></strong>
            <div class="batch-status">
              <span :class="{ ok: row.status === '完成' }">{{ row.status }}</span>
              <el-button v-if="canRetry(row)" size="small" native-type="button" :loading="retryingId === row.sourceId" @click="retry(row)">重试</el-button>
            </div>
          </div>
          <p v-if="row.linkRef">ref：{{ row.linkRef }}</p>
          <code v-if="row.url">{{ row.url }}</code>
        </article>
      </section>
    </div>

    <div class="submit-row">
      <el-button type="primary" native-type="submit" :loading="running">复制并生成链接</el-button>
      <slot name="after" />
      <p>每篇都会复制文章并改归属。有渠道 ID 的直接拼链接，没有渠道 ID 的会在 MIS 新增一条 AFS 记录。</p>
    </div>
  </form>
</template>

<style scoped>
.campaign {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.campaign-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: 650;
}

h2::before {
  content: "";
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--blue);
}

.hint,
.submit-row p,
.batch-row p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.hint {
  margin-bottom: 16px;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.group-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.group {
  display: grid;
  grid-template-columns: 24px minmax(110px, 150px) minmax(120px, 160px) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
}

.group-index {
  padding-bottom: 8px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
}

.group label {
  margin: 0;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

label > span {
  color: #344054;
  font-size: 13px;
}

em {
  color: #c2410c;
  font-size: 12px;
  font-style: normal;
}

.submit-row {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.campaign :deep(.el-select) {
  width: 100%;
}

.batch-row {
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
}

.batch-top {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
}

.batch-top strong {
  font-size: 13px;
  word-break: break-all;
}

.batch-status {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
  max-width: 280px;
}

.batch-status span {
  color: #c2410c;
  font-size: 12px;
  line-height: 1.4;
}

.batch-top span.ok {
  color: var(--ok);
}

.batch-row code {
  display: block;
  margin-top: 6px;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}
</style>
