<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage } from '../api/http'
import { runKeywordHarvestFromUi } from '../api/keywordHarvestRun'
import {
  listKeywordHarvestDays,
  loadKeywordHarvestDay,
  loadSeedLexicon,
  saveSeedLexicon,
  type KeywordHarvestReport,
  type KeywordHarvestRow,
} from '../api/opsCenterLocal'
import { mergeHarvestIntoLexiconByCategory, type HarvestKeywordRow } from '../domain/keywordHarvest'
import { shanghaiDay } from '../domain/opsCenterTime'

const router = useRouter()
const loading = ref(false)
const pulling = ref(false)
const writing = ref(false)
const progress = ref('')
const days = ref<string[]>([])
const selectedDay = ref('')
const report = ref<KeywordHarvestReport | null>(null)
const tab = ref<'good' | 'watch'>('good')
const keywordFilter = ref('')
const selected = ref<KeywordHarvestRow[]>([])

const rows = computed(() => {
  if (!report.value) return [] as KeywordHarvestRow[]
  const list = tab.value === 'good' ? report.value.good : report.value.watch
  const q = keywordFilter.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((row) => row.keyword.toLowerCase().includes(q))
})

const selectedWithCategory = computed(() =>
  selected.value.filter((row) => row.categoryId != null && Number(row.categoryId) > 0),
)

onMounted(async () => {
  await loadDays()
  if (!selectedDay.value) {
    selectedDay.value = shanghaiDay()
  }
})

watch(selectedDay, async (day) => {
  selected.value = []
  if (!day) {
    report.value = null
    return
  }
  await loadReport(day)
})

watch(tab, () => {
  selected.value = []
})

async function loadDays() {
  loading.value = true
  try {
    const payload = await listKeywordHarvestDays()
    days.value = payload.days
    if (!selectedDay.value && payload.days[0]) {
      selectedDay.value = payload.days[0]
    } else if (selectedDay.value) {
      await loadReport(selectedDay.value)
    }
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}

async function loadReport(day: string) {
  loading.value = true
  try {
    report.value = await loadKeywordHarvestDay(day)
  } catch (error) {
    report.value = null
    const message = errorMessage(error)
    if (!/没有|不存在|失败/.test(message)) {
      ElMessage.error(message)
    }
  } finally {
    loading.value = false
  }
}

function pct(rate: number) {
  return `${(Number(rate || 0) * 100).toFixed(1)}%`
}

function onSelectionChange(rows: KeywordHarvestRow[]) {
  selected.value = rows
}

function goOfferSeed() {
  void router.push('/offer-seed')
}

async function pullKeywords(useToday = false) {
  if (pulling.value) return
  const day = useToday ? shanghaiDay() : String(selectedDay.value || shanghaiDay()).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    ElMessage.error('请先选择日期')
    return
  }
  pulling.value = true
  progress.value = '开始拉取…'
  try {
    const next = await runKeywordHarvestFromUi({
      day,
      onProgress: (message) => {
        progress.value = message
      },
    })
    selectedDay.value = day
    if (!days.value.includes(day)) {
      days.value = [day, ...days.value]
    }
    report.value = next
    ElMessage.success(
      `已拉取 ${day}：好词 ${next.goodCount}（挂类目 ${next.goodWithCategory ?? 0}）`,
    )
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    pulling.value = false
    progress.value = ''
  }
}

function toHarvestRow(row: KeywordHarvestRow): HarvestKeywordRow {
  return {
    keyword: row.keyword,
    termClicks: Number(row.termClicks || 0),
    adClicks: Number(row.adClicks || 0),
    adRate: Number(row.adRate || 0),
    articleCount: Number(row.articleCount || 0),
    articleIds: Array.isArray(row.articleIds) ? row.articleIds : [],
    categoryId: row.categoryId == null ? null : Number(row.categoryId),
    categoryKey: row.categoryKey || null,
    days: row.days || [],
    score: Number(row.score || 0),
  }
}

async function writeSelectedToLexicon() {
  const picks = selectedWithCategory.value
  if (!picks.length) {
    ElMessage.warning('请先勾选已带类目的词（来自文章 articleCategoryId）')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将把 ${picks.length} 个词按文章品类写入种子词库（同 categoryId 合并去重）。未挂类目的不会写入。`,
      '按类目入库',
      { type: 'warning', confirmButtonText: '写入词库', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  writing.value = true
  try {
    const { lexicon } = await loadSeedLexicon()
    const next = mergeHarvestIntoLexiconByCategory(
      lexicon,
      picks.map(toHarvestRow),
      'US',
    )
    await saveSeedLexicon(next)
    ElMessage.success(`已写入词库 ${picks.length} 词`)
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    writing.value = false
  }
}
</script>

<template>
  <div class="panel">
    <header class="head">
      <div>
        <h2>种子词日报</h2>
        <p>
          来自 <code>subid2DailyStat</code>；类目由贡献文章的
          <code>article/detail.articleCategoryId</code> 加权投票得到。当天可反复跑
          <code>npm run seeds:harvest</code> 拉截至当前的数据，再勾选按类目写入词库。
        </p>
      </div>
      <div class="actions">
        <el-button type="primary" :loading="pulling" :disabled="loading || writing" @click="pullKeywords(true)">
          拉取今天关键词
        </el-button>
        <el-button :loading="pulling" :disabled="loading || writing || !selectedDay" @click="pullKeywords(false)">
          拉取所选日
        </el-button>
        <el-button :loading="loading" :disabled="pulling" @click="loadDays">刷新列表</el-button>
        <el-button
          type="success"
          :disabled="!selectedWithCategory.length || pulling"
          :loading="writing"
          @click="writeSelectedToLexicon"
        >
          按类目写入词库{{ selectedWithCategory.length ? `（${selectedWithCategory.length}）` : '' }}
        </el-button>
        <el-button plain :disabled="pulling" @click="goOfferSeed">去 Offer 创编</el-button>
      </div>
    </header>
    <p v-if="progress" class="progress">{{ progress }}</p>

    <section class="toolbar card">
      <label>
        <span>统计日</span>
        <el-select v-model="selectedDay" filterable placeholder="选择日期" style="width: 180px">
          <el-option v-for="day in days" :key="day" :label="day" :value="day" />
        </el-select>
      </label>
      <label>
        <span>搜索关键词</span>
        <el-input v-model="keywordFilter" clearable placeholder="过滤关键词" style="width: 220px" />
      </label>
      <el-radio-group v-model="tab">
        <el-radio-button value="good">好词</el-radio-button>
        <el-radio-button value="watch">观察池</el-radio-button>
      </el-radio-group>
    </section>

    <el-alert
      type="info"
      :closable="false"
      class="mb"
      title="好词门槛：词点≥30 · 广告点≥3 · 广告/词点≥8%。类目来自文章详情，不是手工猜的。"
    />

    <section v-if="report" class="card summary">
      <div><em>文章数</em><strong>{{ report.articleCount }}</strong></div>
      <div><em>好词</em><strong>{{ report.goodCount }}</strong></div>
      <div><em>已挂类目</em><strong>{{ report.goodWithCategory ?? '—' }}</strong></div>
      <div><em>观察池</em><strong>{{ report.watchCount }}</strong></div>
    </section>

    <section class="card">
      <el-table
        v-loading="loading"
        :data="rows"
        size="small"
        border
        height="560"
        empty-text="暂无该日日报"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="44" />
        <el-table-column type="index" width="52" label="#" />
        <el-table-column prop="keyword" label="关键词" min-width="200" show-overflow-tooltip />
        <el-table-column label="品类" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.categoryKey">{{ row.categoryKey }}</span>
            <span v-else class="muted">未解析</span>
            <div v-if="row.categoryId" class="sub">id {{ row.categoryId }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="termClicks" label="词点击" width="90" sortable />
        <el-table-column prop="adClicks" label="广告点击" width="100" sortable />
        <el-table-column label="二跳率" width="90" sortable :sort-method="(a, b) => a.adRate - b.adRate">
          <template #default="{ row }">{{ pct(row.adRate) }}</template>
        </el-table-column>
        <el-table-column prop="articleCount" label="文章数" width="90" sortable />
        <el-table-column prop="score" label="综合分" width="90" sortable>
          <template #default="{ row }">{{ Number(row.score || 0).toFixed(0) }}</template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 4px 2px 20px;
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
  max-width: 720px;
}

.actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.progress {
  margin: 0;
  font-size: 12px;
  color: #0369a1;
}

.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px 14px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: flex-end;
}

.toolbar label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #475569;
}

.summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.summary div {
  background: #f8fafc;
  border-radius: 8px;
  padding: 10px 12px;
}

.summary em {
  display: block;
  font-style: normal;
  color: #64748b;
  font-size: 12px;
}

.summary strong {
  font-size: 18px;
}

.mb {
  margin: 0;
}

.muted {
  color: #94a3b8;
}

.sub {
  font-size: 11px;
  color: #94a3b8;
}

code {
  font-size: 12px;
}
</style>
