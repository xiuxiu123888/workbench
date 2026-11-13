<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { errorMessage } from '../api/http'
import { replaceLandpulseOfferResultUrl } from '../api/landpulseOffer'
import {
  consumeStockLocal,
  harvestOptimizeBatchLocal,
  listOptimizeBatchesLocal,
  loadArticleStockLocal,
  loadOptimizeBatchLocal,
  loadOpsCenterFunnelOfferDrafts,
  loadOpsCenterOfferIndex,
  loadOptimizeScheduleLocal,
  markOptimizeBatchWrittenLocal,
  orderStockFromBatchLocal,
  planStockRunLocal,
  readyStockLocal,
  saveOptimizeScheduleLocal,
} from '../api/opsCenterLocal'
import type { ArticleStockPool, ReplaceRunAssignment } from '../domain/articleStockPool'
import type {
  OptimizeBatch,
  OptimizeBatchIndexEntry,
  OptimizeBatchItem,
  OptimizeScheduleConfig,
  OfferMetricSnapshot,
} from '../domain/offerOptimizeBatch'
import {
  defaultOptimizeSchedule,
  summarizeTuneBySeed,
  verdictOfItem,
} from '../domain/offerOptimizeBatch'
import { shanghaiDay } from '../domain/opsCenterTime'
import {
  buildOfferPlacementUnit,
  type OfferPlacementUnit,
} from '../domain/offerPlacementUnit'
import { buildOfferLandingUrl } from '../domain/funnelOfferGenerate'
import { misReady } from '../config/env'

const loading = ref(false)
const harvesting = ref(false)
const savingSchedule = ref(false)
const stockBusy = ref(false)
const runBusy = ref(false)
const batches = ref<OptimizeBatchIndexEntry[]>([])
const selectedId = ref('')
const batch = ref<OptimizeBatch | null>(null)
const harvestDay = ref(shanghaiDay())
const schedule = ref<OptimizeScheduleConfig>(defaultOptimizeSchedule())
const activeSeed = ref('')
const showSchedule = ref(false)
/** offerId → 类目 / 渠道 */
const offerMeta = ref<Map<string, { categoryName: string; channelId: string }>>(new Map())
const stockPool = ref<ArticleStockPool | null>(null)
const stockWater = ref({
  ordered: 0,
  ready: 0,
  consumed: 0,
  failed: 0,
  byPartner: [] as Array<{ partner: string; ordered: number; ready: number }>,
})
const pendingAssignments = ref<ReplaceRunAssignment[]>([])
let scheduleTimer: ReturnType<typeof setInterval> | null = null

type Grade = 'A' | 'B' | 'C' | 'D' | '-'

type RowView = OptimizeBatchItem & {
  grade: Grade
  unit: OfferPlacementUnit
  verdict: ReturnType<typeof verdictOfItem>
}

function money(n: number | null | undefined) {
  return `$${Number(n || 0).toFixed(2)}`
}

function pct(n: number | null | undefined) {
  return `${Number(n || 0).toFixed(2)}%`
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function numFmt(n: number | null | undefined) {
  return Number(n || 0).toLocaleString('zh-CN')
}

function sumSnap(items: OptimizeBatchItem[], which: 'before' | 'after') {
  const empty = {
    visits: 0,
    funnelClicks: 0,
    adClicks: 0,
    conversion: 0,
    revenue: 0,
    funnelImpressions: 0,
    count: 0,
  }
  for (const item of items) {
    const s = which === 'before' ? item.before : item.after
    if (!s) continue
    empty.visits += s.visits
    empty.funnelClicks += s.funnelClicks
    empty.adClicks += s.adClicks
    empty.conversion += s.conversion
    empty.revenue += s.revenue
    empty.funnelImpressions += s.funnelImpressions
    empty.count += 1
  }
  const rpm =
    empty.funnelImpressions > 0 ? (empty.revenue / empty.funnelImpressions) * 1000 : 0
  const keywordCtr =
    empty.funnelImpressions > 0 ? (empty.funnelClicks / empty.funnelImpressions) * 100 : 0
  const secondHop =
    empty.funnelClicks > 0 ? (empty.adClicks / empty.funnelClicks) * 100 : 0
  const cvr =
    empty.adClicks > 0 ? (empty.conversion / empty.adClicks) * 100 : 0
  return { ...empty, rpm, keywordCtr, secondHop, cvr }
}

function placementOf(item: OptimizeBatchItem): OfferPlacementUnit {
  const meta = offerMeta.value.get(item.offerId)
  return buildOfferPlacementUnit({
    offerId: item.offerId,
    offerName: item.offerName,
    beforeUrl: item.beforeUrl,
    afterUrl: item.afterUrl,
    beforeRef: item.beforeRef,
    plannedSeedRef: item.plannedSeedRef,
    afterRef: item.afterRef,
    categoryName: meta?.categoryName || null,
    channelId: meta?.channelId || null,
  })
}

function gradeOf(item: OptimizeBatchItem, medianRpm: number): Grade {
  const snap = item.after || item.before
  const rpm = snap.funnelRpm
  if (item.after) {
    if (item.after.adClicks <= 0 && item.after.funnelClicks >= 50) return 'D'
    if (medianRpm <= 0) return rpm >= 1 ? 'A' : rpm >= 0.4 ? 'B' : 'C'
    if (rpm >= medianRpm * 1.3) return 'A'
    if (rpm >= medianRpm * 0.8) return 'B'
    if (rpm >= medianRpm * 0.4) return 'C'
    return 'D'
  }
  // 未回收：按无广告严重度，流量越高越要先换（展示为待优化等级）
  if (item.before.adClicks <= 0 && item.before.funnelClicks >= 500) return 'D'
  if (item.before.adClicks <= 0 && item.before.funnelClicks >= 200) return 'C'
  if (item.before.secondHopPct < 2) return 'B'
  return 'A'
}

const partnerTags = computed(() => {
  const set = new Set((batch.value?.items || []).map((i) => i.partner))
  return [...set]
})

const beforeAgg = computed(() => sumSnap(batch.value?.items || [], 'before'))
const afterAgg = computed(() => sumSnap(batch.value?.items || [], 'after'))
const hasAfter = computed(() => afterAgg.value.count > 0)

const seedChips = computed(() => {
  const map = new Map<string, number>()
  for (const item of batch.value?.items || []) {
    const seed = item.plannedSeedRef || item.beforeRef || '(空)'
    map.set(seed, (map.get(seed) || 0) + 1)
  }
  return [...map.entries()]
    .map(([seed, count]) => ({ seed, count }))
    .sort((a, b) => b.count - a.count)
})

const medianRpm = computed(() => {
  const rpms = (batch.value?.items || [])
    .map((i) => (i.after || i.before).funnelRpm)
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
  if (!rpms.length) return 0
  return rpms[Math.floor(rpms.length / 2)] || 0
})

const gradeThresholds = computed(() => {
  const m = medianRpm.value || 1
  return {
    a: m * 1.3,
    b: m * 0.8,
    c: m * 0.4,
  }
})

const rows = computed<RowView[]>(() => {
  const items = batch.value?.items || []
  const filtered = activeSeed.value
    ? items.filter(
        (i) =>
          i.plannedSeedRef === activeSeed.value ||
          i.beforeRef === activeSeed.value ||
          i.afterRef === activeSeed.value,
      )
    : items
  return filtered
    .map((item) => ({
      ...item,
      grade: gradeOf(item, medianRpm.value),
      unit: placementOf(item),
      verdict: verdictOfItem(item),
    }))
    .sort((a, b) => {
      const order = { bad: 0, watch: 1, good: 2 }
      return (
        order[a.verdict] - order[b.verdict] ||
        b.before.funnelClicks - a.before.funnelClicks
      )
    })
})

const seedTuneSummary = computed(() => summarizeTuneBySeed(batch.value?.items || []))

const goodRows = computed(() => rows.value.filter((r) => r.verdict === 'good'))
const watchRows = computed(() => rows.value.filter((r) => r.verdict === 'watch'))
const badRows = computed(() => rows.value.filter((r) => r.verdict === 'bad'))

const tableSummary = computed(() => {
  const all = batch.value?.items || []
  const withRev = all.filter((i) => (i.after || i.before).revenue > 0).length
  const t = gradeThresholds.value
  return `${all.length} 个投放单元 · 好 ${goodRows.value.length} / 观察 ${watchRows.value.length} / 差 ${badRows.value.length} · 有收入 ${withRev} · 中位 RPM ${medianRpm.value.toFixed(2)}（A≥${t.a.toFixed(2)} B≥${t.b.toFixed(2)} C≥${t.c.toFixed(2)}）`
})

const statusCard = computed(() => {
  const b = batch.value
  if (!b) {
    return {
      tone: 'idle' as const,
      title: '暂无批次',
      badge: '等待建批',
      body: '先有优化记录后，这里会显示观察结论与下一步动作。',
      next: '',
    }
  }
  const planned = b.items.filter((i) => i.status === 'planned').length
  const written = b.items.filter((i) => i.status === 'written').length
  const skipped = b.items.filter((i) => i.status === 'skipped').length
  const stillNoAd = b.items.filter(
    (i) => i.after && i.after.adClicks <= 0 && i.after.funnelClicks >= 50,
  ).length

  if (!hasAfter.value) {
    return {
      tone: 'watch' as const,
      title: '观察中 · 优化前已存档',
      badge: schedule.value.enabled ? `${schedule.value.intervalHours}小时轮转` : '半自动换文',
      body: `本批 ${b.itemCount} 条（计划 ${planned} / 已写 ${written} / 跳过 ${skipped}）。优化前 ${b.beforeMetricsDay}：收入 ${money(beforeAgg.value.revenue)} · session ${numFmt(beforeAgg.value.visits)} · 词点击 ${numFmt(beforeAgg.value.funnelClicks)} · 二跳 ${pct(beforeAgg.value.secondHop)} · RPM ${beforeAgg.value.rpm.toFixed(2)}。`,
      next: `下一步：按同商借种换文（P0 无广告优先）→ 写回后选指标日「回收优化后」出对比报告；${schedule.value.enabled ? `已启用每 ${schedule.value.intervalHours} 小时节奏` : '可在右上角打开 3 小时节奏配置'}。`,
    }
  }

  const revDelta = afterAgg.value.revenue - beforeAgg.value.revenue
  const hopDelta = afterAgg.value.secondHop - beforeAgg.value.secondHop
  const pass = hopDelta > 0 && stillNoAd === 0
  return {
    tone: pass ? 'pass' as const : 'fail' as const,
    title: pass ? '已回收 · 二跳改善' : '已回收 · 仍需跟进',
    badge: schedule.value.enabled ? '全自动轮转' : '半自动换文',
    body: `优化前 ${b.beforeMetricsDay} 合计 ${money(beforeAgg.value.revenue)} / ${numFmt(beforeAgg.value.visits)} sess / RPM ${beforeAgg.value.rpm.toFixed(2)}；优化后 ${b.afterMetricsDay} 合计 ${money(afterAgg.value.revenue)} / ${numFmt(afterAgg.value.visits)} sess / RPM ${afterAgg.value.rpm.toFixed(2)}（二跳 ${pct(beforeAgg.value.secondHop)} → ${pct(afterAgg.value.secondHop)}）。`,
    next: pass
      ? `下一步：本批可视为达标趋势；收入 Δ ${money(revDelta)}，二跳 Δ ${hopDelta.toFixed(2)} pt。继续按 ${schedule.value.intervalHours} 小时节奏扫下一轮 P0。`
      : `下一步：按当前结果判定「未达标」——仍有 ${stillNoAd} 条疑似无广告；优先换域/换模板，本词记入优化记录避免空跑同词。`,
  }
})

async function refreshList(preferId?: string) {
  loading.value = true
  try {
    const index = await listOptimizeBatchesLocal()
    batches.value = index.batches
    const cosmetic = index.batches.find((row) => row.id.includes('cosmetic'))
    const nextId =
      preferId || selectedId.value || cosmetic?.id || index.batches[0]?.id || ''
    if (nextId) await openBatch(nextId)
    else {
      selectedId.value = ''
      batch.value = null
    }
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}

async function openBatch(id: string) {
  selectedId.value = id
  activeSeed.value = ''
  loading.value = true
  try {
    batch.value = await loadOptimizeBatchLocal(id)
    if (batch.value.afterMetricsDay) harvestDay.value = batch.value.afterMetricsDay
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}

async function harvestNow() {
  if (!selectedId.value) return
  harvesting.value = true
  try {
    const result = await harvestOptimizeBatchLocal(selectedId.value, harvestDay.value)
    batch.value = result.batch
    await refreshList(selectedId.value)
    ElMessage.success(result.message)
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    harvesting.value = false
  }
}

async function loadSchedule() {
  try {
    schedule.value = await loadOptimizeScheduleLocal()
  } catch {
    schedule.value = defaultOptimizeSchedule()
  }
}

async function loadOfferMeta() {
  try {
    const index = await loadOpsCenterOfferIndex()
    const map = new Map<string, { categoryName: string; channelId: string }>()
    for (const row of index.offers || []) {
      const id = String(row.offerId || '').trim()
      if (!id) continue
      map.set(id, {
        categoryName: String(row.categoryName || '').trim(),
        channelId: String(row.channelId || '').trim(),
      })
    }
    offerMeta.value = map
  } catch {
    offerMeta.value = new Map()
  }
}

async function saveSchedule() {
  savingSchedule.value = true
  try {
    schedule.value = await saveOptimizeScheduleLocal({
      ...schedule.value,
      intervalHours: Number(schedule.value.intervalHours) || 3,
      maxPerRun: Number(schedule.value.maxPerRun) || 10,
    })
    ElMessage.success('已保存换文节奏')
    showSchedule.value = false
    armScheduleTimer()
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    savingSchedule.value = false
  }
}

async function refreshStock() {
  try {
    const result = await loadArticleStockLocal()
    stockPool.value = result.pool
    stockWater.value = result.water
  } catch {
    stockPool.value = null
  }
}

async function importStockOrders() {
  if (!selectedId.value) return
  stockBusy.value = true
  try {
    const result = await orderStockFromBatchLocal(selectedId.value)
    stockPool.value = result.pool
    stockWater.value = result.water
    ElMessage.success(result.message)
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    stockBusy.value = false
  }
}

async function syncStockFromDrafts() {
  stockBusy.value = true
  try {
    const drafts = await loadOpsCenterFunnelOfferDrafts()
    const ordered = (stockPool.value?.items || []).filter((row) => row.status === 'ordered')
    let filled = 0
    for (const stock of ordered) {
      const draft = drafts.find((raw) => {
        const row = raw as {
          offerId?: string
          articleId?: string
          newLandingUrl?: string | null
          status?: string
        }
        return (
          String(row.offerId || '') === stock.targetOfferId &&
          String(row.articleId || '').trim() !== '' &&
          (row.status === 'ready' || row.status === 'done' || row.status === 'success' || Boolean(row.newLandingUrl))
        )
      }) as
        | {
            offerId?: string
            articleId?: string
            newLandingUrl?: string | null
            seedKeyword?: string
            channelId?: string
            oldLandingUrl?: string
            status?: string
          }
        | undefined
      if (!draft) continue
      const articleId = String(draft.articleId || '').trim()
      let landingUrl = String(draft.newLandingUrl || '').trim()
      if (!landingUrl) {
        landingUrl =
          buildOfferLandingUrl(
            draft.oldLandingUrl || stock.beforeUrl,
            draft.channelId || stock.channelId,
            articleId,
            stock.seedRef || draft.seedKeyword,
          ) || ''
      }
      if (!articleId || !landingUrl) continue
      const result = await readyStockLocal({
        stockId: stock.id,
        articleId,
        landingUrl,
        note: '从创编草稿同步就绪',
      })
      stockPool.value = result.pool
      stockWater.value = result.water
      filled += 1
    }
    ElMessage.success(filled ? `已从草稿同步 ${filled} 条就绪` : '没有可同步的草稿文章')
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    stockBusy.value = false
  }
}

async function planRound() {
  if (!selectedId.value) return
  stockBusy.value = true
  try {
    const plan = await planStockRunLocal({
      batchId: selectedId.value,
      maxPerRun: schedule.value.maxPerRun,
    })
    pendingAssignments.value = plan.assignments
    stockWater.value = plan.water
    if (!plan.assignments.length) {
      ElMessage.warning('没有可写回的就绪备货（先导入备货单，并同步/登记 article）')
      return
    }
    ElMessage.success(`本轮可替换 ${plan.assignments.length} 条`)
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    stockBusy.value = false
  }
}

async function executeAssignments(assignments: ReplaceRunAssignment[], auto: boolean) {
  if (!assignments.length) return
  if (!misReady) {
    ElMessage.error('需要配置 MIS 才能写回 offer')
    return
  }
  if (schedule.value.requirePreview && !auto) {
    await ElMessageBox.confirm(
      `将写回 ${assignments.length} 条 offer（备货文章直接替换进漏斗）。确认？`,
      '预览确认写回',
      { type: 'warning' },
    )
  }
  runBusy.value = true
  let ok = 0
  let fail = 0
  const written: Array<{ offerId: string; afterRef?: string; afterUrl?: string | null; note?: string }> =
    []
  try {
    for (const row of assignments) {
      try {
        await replaceLandpulseOfferResultUrl(row.offerId, row.landingUrl, {
          articleId: row.articleId,
          ref: row.seedRef,
        })
        await consumeStockLocal(row.stockId, row.offerId)
        written.push({
          offerId: row.offerId,
          afterRef: row.seedRef,
          afterUrl: row.landingUrl,
          note: `备货写回 ${row.articleId}`,
        })
        ok += 1
      } catch (error) {
        fail += 1
        console.error(error)
      }
    }
    if (selectedId.value && written.length) {
      await markOptimizeBatchWrittenLocal(selectedId.value, written)
      await openBatch(selectedId.value)
    }
    await refreshStock()
    pendingAssignments.value = []
    schedule.value = await saveOptimizeScheduleLocal({
      ...schedule.value,
      lastRunAt: new Date().toISOString(),
    })
    ElMessage.success(`写回完成：成功 ${ok}${fail ? ` · 失败 ${fail}` : ''}`)
  } catch (error) {
    if (String(errorMessage(error)).includes('cancel')) return
    ElMessage.error(errorMessage(error))
  } finally {
    runBusy.value = false
  }
}

async function runRound(auto = false) {
  await planRound()
  if (!pendingAssignments.value.length) return
  await executeAssignments(pendingAssignments.value, auto)
}

function armScheduleTimer() {
  if (scheduleTimer) {
    clearInterval(scheduleTimer)
    scheduleTimer = null
  }
  if (!schedule.value.enabled) return
  const ms = Math.max(1, Number(schedule.value.intervalHours) || 3) * 60 * 60 * 1000
  scheduleTimer = setInterval(() => {
    void runRound(true)
  }, ms)
}

function rpmDelta(before: OfferMetricSnapshot, after: OfferMetricSnapshot | null) {
  if (!after) return null
  if (before.funnelRpm <= 0) return after.funnelRpm > 0 ? 100 : 0
  return ((after.funnelRpm - before.funnelRpm) / before.funnelRpm) * 100
}

const stockRows = computed(() =>
  (stockPool.value?.items || [])
    .filter((row) => row.status === 'ordered' || row.status === 'ready')
    .slice(0, 40),
)

onMounted(async () => {
  await Promise.all([refreshList(), loadSchedule(), loadOfferMeta(), refreshStock()])
  armScheduleTimer()
})

onUnmounted(() => {
  if (scheduleTimer) clearInterval(scheduleTimer)
})
</script>

<template>
  <div class="review" v-loading="loading && !batch">
    <aside class="batch-rail">
      <div class="rail-head">
        <strong>优化记录</strong>
        <el-button text size="small" @click="refreshList(selectedId)">刷新</el-button>
      </div>
      <button
        v-for="row in batches"
        :key="row.id"
        type="button"
        class="batch-card"
        :class="{ active: row.id === selectedId }"
        @click="openBatch(row.id)"
      >
        <div class="batch-title">{{ row.title }}</div>
        <div class="batch-meta">
          <span>{{ row.beforeMetricsDay }}</span>
          <span v-if="row.afterMetricsDay">→ {{ row.afterMetricsDay.slice(5) }}</span>
          <span>{{ row.itemCount }} 条</span>
        </div>
        <span class="pill" :class="row.harvestedAt ? 'ok' : 'wait'">
          {{ row.harvestedAt ? '已回收' : '待回收' }}
        </span>
      </button>
      <p v-if="!batches.length" class="rail-empty">还没有优化批次</p>
    </aside>

    <main class="report" v-if="batch">
      <header class="report-head">
        <div>
          <div class="eyebrow">调优报告</div>
          <h1>{{ batch.title }}</h1>
          <div class="tags">
            <span v-for="p in partnerTags" :key="p" class="tag">合作方 {{ p }}</span>
            <span class="tag">P0 无广告优先</span>
            <span class="tag">{{ schedule.intervalHours }}小时 × 上限{{ schedule.maxPerRun }}</span>
          </div>
          <div class="submeta">
            <span>批次 {{ batch.id }}</span>
            <span>优化前 {{ batch.beforeMetricsDay }}</span>
            <span>采样 {{ fmtTime(batch.createdAt) }}</span>
            <span v-if="batch.harvestedAt">回收 {{ fmtTime(batch.harvestedAt) }}</span>
          </div>
        </div>
        <div class="head-actions">
          <el-date-picker
            v-model="harvestDay"
            type="date"
            value-format="YYYY-MM-DD"
            size="small"
            style="width: 140px"
          />
          <el-button type="primary" size="small" :loading="harvesting" @click="harvestNow">
            刷新数据 / 回收
          </el-button>
          <el-button size="small" @click="showSchedule = !showSchedule">节奏设置</el-button>
        </div>
      </header>

      <section v-if="showSchedule" class="schedule-box">
        <el-switch v-model="schedule.enabled" active-text="启用3小时节奏" inactive-text="仅配置" />
        <el-input-number v-model="schedule.intervalHours" :min="1" :max="24" size="small" />
        <span>小时</span>
        <el-input-number v-model="schedule.maxPerRun" :min="1" :max="50" size="small" />
        <span>条/轮</span>
        <el-checkbox v-model="schedule.requirePreview">预览后写回</el-checkbox>
        <el-button type="primary" size="small" :loading="savingSchedule" @click="saveSchedule">
          保存
        </el-button>
      </section>

      <section class="stock-card">
        <div class="stock-head">
          <div>
            <strong>备货池</strong>
            <span class="muted">
              待产 {{ stockWater.ordered }} · 就绪 {{ stockWater.ready }} · 已用
              {{ stockWater.consumed }}
            </span>
          </div>
          <div class="actions">
            <el-button size="small" :loading="stockBusy" @click="importStockOrders">
              本批导入备货单
            </el-button>
            <el-button size="small" :loading="stockBusy" @click="syncStockFromDrafts">
              从创编草稿同步就绪
            </el-button>
            <el-button size="small" :loading="stockBusy" @click="planRound">预览本轮</el-button>
            <el-button
              type="primary"
              size="small"
              :loading="runBusy || stockBusy"
              :disabled="!misReady"
              @click="runRound(false)"
            >
              跑一轮写回
            </el-button>
          </div>
        </div>
        <p class="stock-hint">
          流程：导入备货单 → Offer 创编产文 → 同步就绪 → 跑一轮直接替换漏斗。开启节奏后，本页打开期间按
          {{ schedule.intervalHours }} 小时自动跑一轮。
        </p>
        <div v-if="pendingAssignments.length" class="pending">
          本轮待写 {{ pendingAssignments.length }} 条：
          <span v-for="row in pendingAssignments.slice(0, 6)" :key="row.stockId" class="tag">
            {{ row.offerName.slice(0, 28) }} → {{ row.seedRef }}
          </span>
        </div>
        <el-table v-if="stockRows.length" :data="stockRows" size="small" max-height="220">
          <el-table-column prop="status" label="状态" width="72" />
          <el-table-column prop="partner" label="商" width="90" />
          <el-table-column prop="targetOfferName" label="目标 offer" min-width="160" show-overflow-tooltip />
          <el-table-column prop="seedRef" label="借种 ref" min-width="140" show-overflow-tooltip />
          <el-table-column prop="articleId" label="文章 id" width="120" show-overflow-tooltip />
          <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
        </el-table>
      </section>

      <section class="status-card" :class="statusCard.tone">
        <div class="status-top">
          <strong>{{ statusCard.title }}</strong>
          <span class="badge">{{ statusCard.badge }}</span>
        </div>
        <p>{{ statusCard.body }}</p>
        <p v-if="statusCard.next" class="next">{{ statusCard.next }}</p>
      </section>

      <section class="metric-bar">
        <div class="metric-block">
          <div class="metric-label">优化前 · {{ batch.beforeMetricsDay }}</div>
          <div class="metric-row">
            <span>收入 <b>{{ money(beforeAgg.revenue) }}</b></span>
            <span>Session <b>{{ numFmt(beforeAgg.visits) }}</b></span>
            <span>funnelClick <b>{{ numFmt(beforeAgg.funnelClicks) }}</b></span>
            <span>广告点击 <b>{{ numFmt(beforeAgg.adClicks) }}</b></span>
            <span>二跳 <b class="warn">{{ pct(beforeAgg.secondHop) }}</b></span>
            <span>词CTR <b>{{ pct(beforeAgg.keywordCtr) }}</b></span>
          </div>
        </div>
        <div class="metric-block">
          <div class="metric-label">
            优化后 · {{ batch.afterMetricsDay || '尚未回收' }}
          </div>
          <div class="metric-row" v-if="hasAfter">
            <span>收入 <b>{{ money(afterAgg.revenue) }}</b></span>
            <span>Session <b>{{ numFmt(afterAgg.visits) }}</b></span>
            <span>Avg RPM <b>{{ afterAgg.rpm.toFixed(2) }}</b></span>
            <span>二跳 <b>{{ pct(afterAgg.secondHop) }}</b></span>
            <span>Funnel CTR <b>{{ pct(afterAgg.keywordCtr) }}</b></span>
          </div>
          <div v-else class="metric-row muted">换文写回并拉取新指标日后，点「回收」填充这里</div>
        </div>
      </section>

      <section class="seed-bar">
        <div class="seed-label">试词筛选</div>
        <button
          type="button"
          class="seed-chip"
          :class="{ on: !activeSeed }"
          @click="activeSeed = ''"
        >
          全部 {{ batch.itemCount }}
        </button>
        <button
          v-for="chip in seedChips"
          :key="chip.seed"
          type="button"
          class="seed-chip"
          :class="{ on: activeSeed === chip.seed }"
          @click="activeSeed = chip.seed"
        >
          {{ chip.seed }}
          <em>{{ chip.count }}</em>
        </button>
        <div class="seed-range">
          观察范围 {{ batch.beforeMetricsDay }}
          <template v-if="batch.afterMetricsDay"> — {{ batch.afterMetricsDay }}</template>
          · 状态
          <span class="running">{{ hasAfter ? '已回收对比' : '观察中·待回收' }}</span>
        </div>
      </section>

      <section class="verdict-grid">
        <div class="verdict-card good">
          <strong>跑得好 {{ goodRows.length }}</strong>
          <p>二跳≥8% 且 RPM≥1（回收后更准）</p>
        </div>
        <div class="verdict-card watch">
          <strong>观察中 {{ watchRows.length }}</strong>
          <p>有一点转化但仍弱</p>
        </div>
        <div class="verdict-card bad">
          <strong>跑得差 {{ badRows.length }}</strong>
          <p>二跳低 / 疑似无广告</p>
        </div>
      </section>

      <section class="seed-tune card-like">
        <div class="table-summary">按关键词汇总（找好词）</div>
        <el-table :data="seedTuneSummary" size="small" stripe>
          <el-table-column label="判定" width="72">
            <template #default="{ row }">
              <span class="verdict-tag" :class="row.verdict">
                {{ row.verdict === 'good' ? '好' : row.verdict === 'watch' ? '观察' : '差' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="seed" label="关键词" min-width="180" show-overflow-tooltip />
          <el-table-column prop="offers" label="单元" width="64" />
          <el-table-column label="好/观察/差" width="110">
            <template #default="{ row }">{{ row.good }}/{{ row.watch }}/{{ row.bad }}</template>
          </el-table-column>
          <el-table-column label="收入" width="90" align="right">
            <template #default="{ row }">{{ money(row.revenue) }}</template>
          </el-table-column>
          <el-table-column label="二跳" width="80" align="right">
            <template #default="{ row }">{{ pct(row.secondHopPct) }}</template>
          </el-table-column>
          <el-table-column label="词点击" width="90" align="right">
            <template #default="{ row }">{{ numFmt(row.funnelClicks) }}</template>
          </el-table-column>
        </el-table>
        <p v-if="!hasAfter" class="seed-tune-hint">
          现在还是「优化前/旧词」基线。跑几小时后点右上角「回收优化后」，这里会按新词表现重算好词/差词。
        </p>
      </section>

      <section class="table-card">
        <div class="table-summary">{{ tableSummary }}</div>
        <el-table :data="rows" size="small" stripe height="100%" class="unit-table">
          <el-table-column label="好坏" width="64" align="center" fixed>
            <template #default="{ row }">
              <span class="verdict-tag" :class="row.verdict">
                {{ row.verdict === 'good' ? '好' : row.verdict === 'watch' ? '观察' : '差' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="等级" width="56" align="center">
            <template #default="{ row }">
              <span class="grade" :class="'g-' + row.grade">{{ row.grade }}</span>
            </template>
          </el-table-column>
          <el-table-column label="账户" min-width="170" fixed>
            <template #default="{ row }">
              <div class="unit">
                <strong>{{ row.unit.accountLabel }}</strong>
                <span>{{ row.funnelName }} · 渠道 {{ row.unit.channelId || '—' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="域名" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ row.unit.domain || '—' }}</template>
          </el-table-column>
          <el-table-column label="类目" min-width="110" show-overflow-tooltip>
            <template #default="{ row }">{{ row.unit.categoryName }}</template>
          </el-table-column>
          <el-table-column label="当前 ref" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="ref-now">{{ row.unit.currentRef || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="借种 ref" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="ref-plan">{{ row.unit.plannedSeedRef || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="链接" min-width="220">
            <template #default="{ row }">
              <a
                v-if="row.unit.link"
                class="link"
                :href="row.unit.link.replace('{hit}', '1')"
                target="_blank"
                rel="noreferrer"
                :title="row.unit.link"
              >
                /detail/{{ row.unit.articleId || '…' }}
              </a>
              <span v-else class="muted-sm">—</span>
            </template>
          </el-table-column>
          <el-table-column label="收入 前 / 后" width="120" align="right">
            <template #default="{ row }">
              <div class="stack">
                <span>{{ money(row.before.revenue) }}</span>
                <span :class="row.after && row.after.revenue > row.before.revenue ? 'up' : ''">
                  {{ row.after ? money(row.after.revenue) : '—' }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="Session / FC / 广告" width="150" align="right">
            <template #default="{ row }">
              <div class="stack">
                <span>
                  {{ numFmt(row.before.visits) }} / {{ numFmt(row.before.funnelClicks) }} /
                  {{ numFmt(row.before.adClicks) }}
                </span>
                <span v-if="row.after" class="muted-sm">
                  {{ numFmt(row.after.visits) }} / {{ numFmt(row.after.funnelClicks) }} /
                  {{ numFmt(row.after.adClicks) }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="RPM 前 / 后" width="110" align="right">
            <template #default="{ row }">
              <div class="stack">
                <span>{{ row.before.funnelRpm.toFixed(2) }}</span>
                <span>
                  {{ row.after ? row.after.funnelRpm.toFixed(2) : '—' }}
                  <em
                    v-if="row.after && rpmDelta(row.before, row.after) != null"
                    :class="(rpmDelta(row.before, row.after) || 0) >= 0 ? 'up' : 'down'"
                  >
                    {{ (rpmDelta(row.before, row.after) || 0) >= 0 ? '+' : ''
                    }}{{ (rpmDelta(row.before, row.after) || 0).toFixed(1) }}%
                  </em>
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="二跳" width="72" align="right">
            <template #default="{ row }">
              <div class="stack">
                <span>{{ pct(row.before.secondHopPct) }}</span>
                <span v-if="row.after">{{ pct(row.after.secondHopPct) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="72" />
        </el-table>
      </section>
    </main>

    <main v-else class="report empty">
      <h1>换文复盘报告</h1>
      <p>左侧选择优化批次后，这里会按每日复盘样式展示观察结论、前后指标与投放单元明细。</p>
    </main>
  </div>
</template>

<style scoped>
.review {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 0;
  height: 100%;
  min-height: 0;
  background: #f3f5f8;
}

.batch-rail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-right: 1px solid #e5eaf1;
  background: #fbfcfe;
  overflow: auto;
}

.rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.batch-card {
  text-align: left;
  border: 1px solid #e6ebf2;
  background: #fff;
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
  position: relative;
}

.batch-card.active {
  border-color: #7aa2ff;
  box-shadow: 0 0 0 1px rgba(64, 120, 255, 0.2);
  background: #f5f8ff;
}

.batch-title {
  font-size: 13px;
  font-weight: 650;
  color: #1f2937;
  line-height: 1.35;
  padding-right: 52px;
}

.batch-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  color: #6b7280;
  font-size: 11px;
}

.pill {
  position: absolute;
  top: 10px;
  right: 10px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
}

.pill.ok {
  background: #ecfdf3;
  color: #067647;
}

.pill.wait {
  background: #fff7ed;
  color: #c2410c;
}

.rail-empty,
.empty {
  color: #6b7280;
  font-size: 13px;
}

.report {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  padding: 14px 16px 18px;
  overflow: auto;
}

.report-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.eyebrow {
  font-size: 12px;
  color: #6b7280;
}

.report-head h1 {
  margin: 2px 0 8px;
  font-size: 22px;
  font-weight: 700;
  color: #111827;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2ff;
  color: #3730a3;
}

.submeta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  color: #6b7280;
  font-size: 12px;
}

.head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.schedule-box {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e5eaf1;
  border-radius: 10px;
  font-size: 12px;
  color: #4b5563;
}

.stock-card {
  background: #fff;
  border: 1px solid #e5eaf1;
  border-radius: 10px;
  padding: 12px;
}

.stock-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.stock-head strong {
  margin-right: 8px;
  font-size: 14px;
}

.stock-hint {
  margin: 8px 0 10px;
  font-size: 12px;
  color: #6b7280;
}

.pending {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  color: #374151;
}

.muted {
  color: #6b7280;
  font-size: 12px;
}

.status-card {
  border-radius: 12px;
  padding: 14px 16px;
  border: 1px solid #f3c6cf;
  background: linear-gradient(180deg, #fff1f4 0%, #ffe8ee 100%);
  color: #4a1d2a;
}

.status-card.pass {
  border-color: #abefc6;
  background: linear-gradient(180deg, #ecfdf3 0%, #dcfae6 100%);
  color: #085d3a;
}

.status-card.fail {
  border-color: #f3c6cf;
  background: linear-gradient(180deg, #fff1f4 0%, #ffe8ee 100%);
}

.status-card.idle {
  border-color: #e5eaf1;
  background: #f8fafc;
  color: #334155;
}

.status-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.status-top strong {
  font-size: 15px;
}

.badge {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.status-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
}

.status-card .next {
  margin-top: 8px;
  font-weight: 600;
}

.metric-bar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.metric-block {
  background: #fff;
  border: 1px solid #e5eaf1;
  border-radius: 10px;
  padding: 10px 12px;
}

.metric-label {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 6px;
}

.metric-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  font-size: 13px;
  color: #374151;
}

.metric-row b {
  color: #111827;
  font-weight: 700;
}

.metric-row .warn {
  color: #b42318;
}

.metric-row.muted {
  color: #9ca3af;
}

.verdict-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.verdict-card {
  border-radius: 10px;
  padding: 12px 14px;
  border: 1px solid #e5eaf1;
  background: #fff;
}

.verdict-card strong {
  display: block;
  font-size: 15px;
  margin-bottom: 4px;
}

.verdict-card p {
  margin: 0;
  font-size: 12px;
  color: #6b7280;
}

.verdict-card.good {
  background: #ecfdf3;
  border-color: #abefc6;
}

.verdict-card.watch {
  background: #fffbeb;
  border-color: #fcd34d;
}

.verdict-card.bad {
  background: #fef3f2;
  border-color: #fda29b;
}

.verdict-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.verdict-tag.good {
  background: #ecfdf3;
  color: #067647;
}

.verdict-tag.watch {
  background: #fffbeb;
  color: #b54708;
}

.verdict-tag.bad {
  background: #fef3f2;
  color: #b42318;
}

.seed-tune {
  background: #fff;
  border: 1px solid #e5eaf1;
  border-radius: 10px;
  padding: 10px 12px;
}

.seed-tune-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #6b7280;
}

.seed-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  background: #fff;
  border: 1px solid #e5eaf1;
  border-radius: 10px;
  padding: 10px 12px;
}

.seed-label {
  font-size: 12px;
  color: #6b7280;
  margin-right: 4px;
}

.seed-chip {
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  color: #374151;
}

.seed-chip em {
  font-style: normal;
  margin-left: 4px;
  color: #9ca3af;
}

.seed-chip.on {
  background: #fef3c7;
  border-color: #fcd34d;
  color: #92400e;
  font-weight: 650;
}

.seed-range {
  margin-left: auto;
  font-size: 12px;
  color: #6b7280;
}

.running {
  color: #2563eb;
  font-weight: 600;
}

.table-card {
  flex: 1;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e5eaf1;
  border-radius: 10px;
  padding: 10px 12px 12px;
  overflow: hidden;
}

.table-summary {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 8px;
}

.unit-table {
  flex: 1;
}

.grade {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  font-weight: 800;
  font-size: 13px;
}

.g-A {
  background: #ecfdf3;
  color: #067647;
}

.g-B {
  background: #eff8ff;
  color: #175cd3;
}

.g-C {
  background: #fff7ed;
  color: #c2410c;
}

.g-D {
  background: #fef3f2;
  color: #b42318;
}

.unit {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.unit strong {
  font-size: 13px;
  color: #111827;
}

.unit span {
  font-size: 11px;
  color: #9ca3af;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.35;
}

.muted-sm {
  color: #9ca3af;
  font-size: 11px;
}

.up {
  color: #067647;
  font-weight: 650;
}

.down {
  color: #b42318;
  font-weight: 650;
}

.ref-now {
  color: #4b5563;
}

.ref-plan {
  color: #92400e;
  font-weight: 650;
}

.link {
  color: #2563eb;
  text-decoration: none;
  font-size: 12px;
}

.link:hover {
  text-decoration: underline;
}

@media (max-width: 1100px) {
  .review {
    grid-template-columns: 1fr;
  }

  .batch-rail {
    max-height: 180px;
    border-right: 0;
    border-bottom: 1px solid #e5eaf1;
  }

  .metric-bar {
    grid-template-columns: 1fr;
  }
}
</style>
