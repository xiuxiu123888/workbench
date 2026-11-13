<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { errorMessage } from '../api/http'
import { pushOpsCenterTextToFeishu } from '../api/opsCenterPush'
import { loadLatestOpsCenterReport, reanalyzeOpsCenterFromLocal, syncOpsCenterReport } from '../api/opsCenterSync'
import { misReady, ruoyiReady } from '../config/env'
import {
  formatOpsCenterFeishuText,
  loadOpsCenterReport,
  saveOpsCenterReport,
  type OpsCenterReport,
  type RankRow,
} from '../domain/opsCenter'
import { formatMoney } from '../domain/report'

type RankTab = 'partner' | 'url' | 'geo' | 'category' | 'funnel' | 'offer'

const router = useRouter()
const report = ref<OpsCenterReport | null>(null)
const loading = ref(false)
const rebuilding = ref(false)
const pushing = ref(false)
const progress = ref('')
const showOfferAdvice = ref(false)
const rankTab = ref<RankTab>('partner')

const ready = computed(() => ruoyiReady && misReady)
const busy = computed(() => loading.value || rebuilding.value)

const pulledLabel = computed(() => {
  if (!report.value?.pulledAt) {
    return '尚未同步'
  }
  return new Date(report.value.pulledAt).toLocaleString('zh-CN', { hour12: false })
})

const topInsights = computed(() => (report.value?.insights || []).slice(0, 5))

const replaceCount = computed(() => report.value?.funnelReplaceSummaries?.length || 0)
const weakOfferCount = computed(() => report.value?.replaceAdvice?.length || 0)

const rankTitle = computed(() => {
  const map: Record<RankTab, string> = {
    partner: '合作方',
    url: '链接',
    geo: '国家',
    category: '品类',
    funnel: '漏斗',
    offer: 'Offer Top 20',
  }
  return map[rankTab.value]
})

const rankRows = computed(() => {
  if (!report.value) {
    return [] as RankRow[]
  }
  if (rankTab.value === 'partner') return report.value.partnerRank
  if (rankTab.value === 'url') return report.value.urlRank
  if (rankTab.value === 'geo') return report.value.geoRank
  if (rankTab.value === 'category') return report.value.categoryRank
  return []
})

onMounted(async () => {
  report.value = loadOpsCenterReport()
  try {
    const local = await loadLatestOpsCenterReport()
    if (local) {
      report.value = local
      saveOpsCenterReport(local)
    }
  } catch {
    // keep browser cache
  }
})

async function syncNow() {
  if (!ready.value) {
    ElMessage.error('需要同时配置 VITE_RUOYI_* 与 VITE_MIS_TOKEN，并重启开发服务')
    return
  }
  if (busy.value) {
    return
  }
  loading.value = true
  progress.value = '开始同步到 data/ops-center …'
  try {
    const next = await syncOpsCenterReport({
      concurrency: 4,
      onProgress: (message) => {
        progress.value = message
      },
    })
    report.value = next
    saveOpsCenterReport(next)
    progress.value = `已落盘并分析：${next.primaryDay} · 对齐 ${next.matchedOfferCount}/${next.offerCount} · 待换漏斗 ${next.funnelReplaceSummaries.length}`
    ElMessage.success('漏斗 + flatStats 已写入项目本地并完成分析')
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    loading.value = false
  }
}

async function rebuildLocal() {
  if (busy.value) {
    return
  }
  rebuilding.value = true
  progress.value = '读取 data/ops-center 本地数据并重算换文建议…'
  try {
    const next = await reanalyzeOpsCenterFromLocal()
    report.value = next
    saveOpsCenterReport(next)
    progress.value = `本地重算完成：待换漏斗 ${next.funnelReplaceSummaries.length} · 弱 offer ${next.replaceAdvice.length}`
    ElMessage.success(progress.value)
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    rebuilding.value = false
  }
}

async function sendReport() {
  if (!report.value) {
    ElMessage.warning('请先同步生成报告')
    return
  }
  if (pushing.value) {
    return
  }
  pushing.value = true
  try {
    const text = formatOpsCenterFeishuText(report.value)
    const message = await pushOpsCenterTextToFeishu(text)
    ElMessage.success(message)
  } catch (error) {
    ElMessage.error(errorMessage(error))
  } finally {
    pushing.value = false
  }
}

function money(value: number | null | undefined): string {
  return formatMoney(Number(value) || 0)
}

function int(value: number | null | undefined): string {
  return String(Math.round(Number(value) || 0))
}
</script>

<template>
  <div class="ops-center">
    <section class="toolbar card">
      <div class="toolbar-copy">
        <h2>报告分析</h2>
        <p>
          用本地报告做判断；明细排行按需点开。上次同步：{{ pulledLabel }}
          <template v-if="report?.primaryDay"> · 指标日 {{ report.primaryDay }}</template>
        </p>
        <p v-if="progress" class="progress">{{ progress }}</p>
      </div>
      <div class="toolbar-actions">
        <el-button type="primary" plain :loading="rebuilding" :disabled="busy" @click="rebuildLocal">
          基于本地重算
        </el-button>
        <el-button type="primary" :loading="loading" :disabled="!ready || busy" @click="syncNow">
          重新拉取并分析
        </el-button>
        <el-button :loading="pushing" :disabled="!report || busy" @click="sendReport">
          发送到飞书
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

    <div v-if="report" class="report-body">
      <section class="kpi-grid">
        <div class="kpi card">
          <span>收入</span>
          <strong>${{ money(report.totals.revenue) }}</strong>
        </div>
        <div class="kpi card">
          <span>访问</span>
          <strong>{{ int(report.totals.visits) }}</strong>
        </div>
        <div class="kpi card">
          <span>转化</span>
          <strong>{{ int(report.totals.conversion) }}</strong>
        </div>
        <div class="kpi card kpi-warn">
          <span>待换漏斗 / 弱 offer</span>
          <strong>{{ replaceCount }} / {{ weakOfferCount }}</strong>
        </div>
      </section>

      <section class="card insights">
        <div class="section-head">
          <h3>重点结论</h3>
          <span class="meta">对齐 {{ report.matchedOfferCount }}/{{ report.offerCount }} · 漏斗 {{ report.funnelCount }}</span>
        </div>
        <ol v-if="topInsights.length">
          <li v-for="(line, index) in topInsights" :key="index">{{ line }}</li>
        </ol>
        <el-empty v-else description="暂无结论" :image-size="48" />
      </section>

      <section class="card">
        <div class="section-head">
          <h3>换文建议</h3>
          <div class="section-actions">
            <span class="meta">先看漏斗，再按需展开 offer</span>
            <el-button
              type="primary"
              size="small"
              :disabled="!weakOfferCount"
              @click="
                router.push({
                  name: 'offerSeed',
                  query: { import: 'replace-advice' },
                })
              "
            >
              一键去创编（{{ weakOfferCount }}）
            </el-button>
          </div>
        </div>
        <p class="hint">
          有流量但收入/RPM/转化明显弱于同国家中位。点「一键去创编」会导入这些 offer，并用当前词库（现美妆 4
          词）随机分配 → 你再点开始创编 / 预览 / 替换。
        </p>

        <el-table
          v-if="report.funnelReplaceSummaries?.length"
          :data="report.funnelReplaceSummaries"
          size="small"
          stripe
          max-height="280"
        >
          <el-table-column prop="funnelName" label="漏斗" min-width="140" />
          <el-table-column prop="partnerName" label="合作方" width="110">
            <template #default="{ row }">{{ row.partnerName || '—' }}</template>
          </el-table-column>
          <el-table-column label="弱offer" width="80" align="right">
            <template #default="{ row }">{{ row.weakOfferCount }}</template>
          </el-table-column>
          <el-table-column label="当前品类" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.currentCategories.join('、') }}</template>
          </el-table-column>
          <el-table-column label="建议换成" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              <strong>{{ row.suggestCategories.join('、') || '—' }}</strong>
            </template>
          </el-table-column>
          <el-table-column label="原因" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.sampleReasons.join('；') }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无待换漏斗" :image-size="56" />

        <div class="offer-toggle">
          <el-button text type="primary" @click="showOfferAdvice = !showOfferAdvice">
            {{ showOfferAdvice ? '收起 offer 明细' : `展开 offer 明细（${weakOfferCount}）` }}
          </el-button>
        </div>

        <el-table
          v-if="showOfferAdvice && report.replaceAdvice?.length"
          :data="report.replaceAdvice"
          size="small"
          stripe
          max-height="320"
          class="offer-table"
        >
          <el-table-column prop="severity" label="级别" width="70">
            <template #default="{ row }">
              <span :class="row.severity === 'high' ? 'sev-high' : 'sev-mid'">{{ row.severity }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="funnelName" label="漏斗" min-width="120" />
          <el-table-column prop="geo" label="国家" width="70">
            <template #default="{ row }">{{ row.geo || '默认' }}</template>
          </el-table-column>
          <el-table-column prop="currentCategory" label="当前品类" min-width="110" />
          <el-table-column label="建议品类" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.suggestCategories.map((item) => item.categoryName).join('、') }}
            </template>
          </el-table-column>
          <el-table-column label="访问" width="70" align="right">
            <template #default="{ row }">{{ int(row.visits) }}</template>
          </el-table-column>
          <el-table-column label="收入" width="80" align="right">
            <template #default="{ row }">${{ money(row.revenue) }}</template>
          </el-table-column>
          <el-table-column label="原因" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.reasons.join('；') }}</template>
          </el-table-column>
          <el-table-column prop="offerName" label="offer" min-width="150" show-overflow-tooltip />
        </el-table>
      </section>

      <section class="card rank-card">
        <div class="section-head">
          <h3>维度排行 · {{ rankTitle }}</h3>
          <span class="meta">同一时间只看一类，方便你自己做判断</span>
        </div>
        <el-radio-group v-model="rankTab" size="small" class="rank-tabs">
          <el-radio-button value="partner">合作方</el-radio-button>
          <el-radio-button value="url">链接</el-radio-button>
          <el-radio-button value="geo">国家</el-radio-button>
          <el-radio-button value="category">品类</el-radio-button>
          <el-radio-button value="funnel">漏斗</el-radio-button>
          <el-radio-button value="offer">Offer Top20</el-radio-button>
        </el-radio-group>

        <el-table
          v-if="rankTab !== 'funnel' && rankTab !== 'offer'"
          :data="rankRows"
          size="small"
          stripe
          max-height="360"
        >
          <el-table-column prop="key" :label="rankTitle" min-width="140" />
          <el-table-column label="收入" width="90" align="right">
            <template #default="{ row }">${{ money(row.revenue) }}</template>
          </el-table-column>
          <el-table-column label="访问" width="80" align="right">
            <template #default="{ row }">{{ int(row.visits) }}</template>
          </el-table-column>
          <el-table-column label="转化" width="70" align="right">
            <template #default="{ row }">{{ int(row.conversion) }}</template>
          </el-table-column>
          <el-table-column label="漏点" width="80" align="right">
            <template #default="{ row }">{{ int(row.funnelClicks) }}</template>
          </el-table-column>
          <el-table-column label="CTR" width="70" align="right">
            <template #default="{ row }">{{ money(row.funnelCtrAvg) }}</template>
          </el-table-column>
        </el-table>

        <el-table
          v-else-if="rankTab === 'funnel'"
          :data="report.funnelRank"
          size="small"
          stripe
          max-height="360"
        >
          <el-table-column prop="funnelName" label="漏斗" min-width="140" />
          <el-table-column prop="partnerName" label="合作方" width="110">
            <template #default="{ row }">{{ row.partnerName || '—' }}</template>
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
          <el-table-column label="漏点" width="80" align="right">
            <template #default="{ row }">{{ int(row.funnelClicks) }}</template>
          </el-table-column>
          <el-table-column label="对齐" width="80" align="right">
            <template #default="{ row }">{{ row.matchedStats }}/{{ row.offerCount }}</template>
          </el-table-column>
        </el-table>

        <el-table v-else :data="report.topOffers" size="small" stripe max-height="360">
          <el-table-column prop="funnelName" label="漏斗" min-width="120" />
          <el-table-column prop="geo" label="国家" width="70">
            <template #default="{ row }">{{ row.geo || '默认' }}</template>
          </el-table-column>
          <el-table-column prop="categoryName" label="品类" min-width="110">
            <template #default="{ row }">{{ row.categoryName || '—' }}</template>
          </el-table-column>
          <el-table-column prop="offerName" label="offer" min-width="180" show-overflow-tooltip />
          <el-table-column label="收入" width="90" align="right">
            <template #default="{ row }">${{ money(row.revenue) }}</template>
          </el-table-column>
          <el-table-column label="访问" width="80" align="right">
            <template #default="{ row }">{{ int(row.visits) }}</template>
          </el-table-column>
          <el-table-column label="转化" width="70" align="right">
            <template #default="{ row }">{{ int(row.conversion) }}</template>
          </el-table-column>
          <el-table-column label="RPM" width="70" align="right">
            <template #default="{ row }">{{ money(row.funnelRpm) }}</template>
          </el-table-column>
        </el-table>
      </section>
    </div>

    <el-empty v-else description="还没有本地报告，可点「重新拉取并分析」或先用漏斗总览的本地数据重算" />
  </div>
</template>

<style scoped>
.ops-center {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
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
.hint,
.meta {
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

.report-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 12px;
  padding-bottom: 8px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
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

.kpi-warn strong {
  color: #b45309;
}

.section-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 10px;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.insights ol {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
  color: #1f2937;
  font-size: 14px;
  line-height: 1.55;
}

.hint {
  margin-bottom: 10px;
  font-size: 12px;
}

.offer-toggle {
  margin-top: 8px;
}

.offer-table {
  margin-top: 8px;
}

.sev-high {
  color: #b91c1c;
  font-weight: 650;
}

.sev-mid {
  color: #b45309;
  font-weight: 600;
}

.rank-card {
  display: grid;
  gap: 10px;
}

.rank-tabs {
  margin-bottom: 4px;
}

@media (max-width: 1100px) {
  .kpi-grid {
    grid-template-columns: 1fr 1fr;
  }

  .toolbar,
  .section-head {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
