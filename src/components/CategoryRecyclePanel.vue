<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { listChannelRevenue } from '../api/report'
import { errorMessage } from '../api/http'
import { channelFromUrl } from '../domain/campaignForm'
import {
  articleIdFromUrl,
  articleLinks,
  formatMoney,
  revenueByCountryCode,
  sourceFromAccountName,
} from '../domain/report'

const props = defineProps<{
  siteLabel: string
  urls: string[]
  countryCodes: Record<string, string>
  accountSource: string
  accountName: string
}>()

const range = ref<[Date, Date] | null>(defaultRange())
const loading = ref(false)
const progress = ref('')
const rows = ref<Array<{ countryCode: string; revenue: number; channels: number }>>([])
const totalRevenue = computed(() => rows.value.reduce((sum, row) => sum + row.revenue, 0))

const articles = computed(() =>
  props.urls
    .map((url) => {
      const articleId = articleIdFromUrl(url)
      const channelId = channelFromUrl(url)
      return {
        url,
        articleId,
        channelId,
        countryCode: articleId ? props.countryCodes[articleId] || '' : '',
      }
    })
    .filter((item) => item.articleId),
)

const channelIds = computed(() =>
  [...new Set(articleLinks(props.urls).map((link) => link.channelId).filter(Boolean))],
)

function defaultRange(): [Date, Date] {
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - 1)
  return [start, end]
}

function formatDay(value: Date): string {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function load() {
  if (!props.siteLabel) {
    ElMessage.warning('先在左侧选中一条运营配置')
    return
  }
  if (!range.value?.[0] || !range.value[1]) {
    ElMessage.error('请选择日期范围')
    return
  }
  const start = formatDay(range.value[0])
  const end = formatDay(range.value[1])
  const channels = channelIds.value
  if (channels.length === 0) {
    ElMessage.error('当前配置没有渠道 ID（链接里需要 channel）')
    return
  }

  const source = props.accountSource.trim() || sourceFromAccountName(props.accountName)
  loading.value = true
  progress.value = ''
  rows.value = []
  const countryTotals = new Map<string, { revenue: number; channels: Set<string> }>()
  const warnings: string[] = []
  try {
    for (const [index, channelId] of channels.entries()) {
      progress.value = `拉收入 ${index + 1}/${channels.length} · ${channelId}`
      try {
        const raw = await listChannelRevenue({
          customChannelId: channelId,
          source: source || undefined,
          start,
          end,
        })
        const byCountry = revenueByCountryCode(raw)
        for (const [country, amount] of byCountry) {
          const current = countryTotals.get(country) ?? { revenue: 0, channels: new Set<string>() }
          current.revenue += amount
          current.channels.add(channelId)
          countryTotals.set(country, current)
        }
        if (byCountry.size === 0 && raw.length > 0) {
          warnings.push(`渠道 ${channelId} 有数据但没有国家码`)
        }
      } catch (error) {
        warnings.push(`渠道 ${channelId} ${errorMessage(error)}`)
      }
    }
    rows.value = [...countryTotals.entries()]
      .map(([countryCode, value]) => ({
        countryCode,
        revenue: value.revenue,
        channels: value.channels.size,
      }))
      .sort((a, b) => b.revenue - a.revenue || a.countryCode.localeCompare(b.countryCode))
    if (rows.value.length === 0) {
      ElMessage.warning(warnings[0] || '这段日期没有国家收入')
    } else if (warnings.length) {
      ElMessage.warning(`已汇总 ${rows.value.length} 个国家；另有 ${warnings.length} 条告警`)
    } else {
      ElMessage.success(`已按国家汇总 ${rows.value.length} 行`)
    }
  } finally {
    loading.value = false
    progress.value = ''
  }
}
</script>

<template>
  <div class="recycle">
    <header class="hero">
      <div>
        <p class="eyebrow">回收</p>
        <h3>本站文章 · 各国收入</h3>
        <p class="hint">
          绑定左侧当前运营配置：用站上推荐文章的渠道 ID 拉 `/report/afsData/list`，看这批文章实际跑出来的各国收入。
        </p>
      </div>
      <div class="hero-actions">
        <el-date-picker
          v-model="range"
          type="daterange"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          :disabled="loading"
        />
        <el-button type="primary" :loading="loading" @click="load">查询</el-button>
      </div>
    </header>

    <section class="panel">
      <div class="meta" v-if="siteLabel">
        <strong>{{ siteLabel }}</strong>
        <span v-if="accountName">账户 {{ accountName }}</span>
        <span>{{ articles.length }} 篇文章</span>
        <span>{{ channelIds.length }} 个渠道</span>
        <span v-if="rows.length">合计 ${{ formatMoney(totalRevenue) }}</span>
      </div>
      <p v-else class="empty">先在左侧选中一条运营配置。</p>
      <p v-if="progress" class="progress">{{ progress }}</p>

      <div v-if="channelIds.length" class="channels">
        <span v-for="id in channelIds" :key="id" class="chip">{{ id }}</span>
      </div>

      <el-table v-if="rows.length" :data="rows" size="small" empty-text="暂无数据">
        <el-table-column prop="countryCode" label="国家" width="100" />
        <el-table-column label="收入 ($)" min-width="140" align="right">
          <template #default="{ row }">{{ formatMoney(row.revenue) }}</template>
        </el-table-column>
        <el-table-column prop="channels" label="命中渠道数" width="110" align="right" />
      </el-table>
      <p v-else-if="!loading && siteLabel" class="empty">选择日期后查询，按国家汇总本站渠道收入。</p>
    </section>

    <section v-if="articles.length" class="panel muted">
      <h4>当前配置文章</h4>
      <el-table :data="articles" size="small">
        <el-table-column label="文章 ID" min-width="120">
          <template #default="{ row }"><span class="id">{{ row.articleId }}</span></template>
        </el-table-column>
        <el-table-column label="配置国家" width="90" align="center">
          <template #default="{ row }">{{ row.countryCode || '—' }}</template>
        </el-table-column>
        <el-table-column label="渠道" min-width="120">
          <template #default="{ row }"><span class="id">{{ row.channelId || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="链接" min-width="220">
          <template #default="{ row }"><span class="url">{{ row.url }}</span></template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.recycle {
  display: grid;
  gap: 16px;
}

.hero {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-end;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: linear-gradient(180deg, #fff 0%, #f7f9fc 100%);
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
  font-size: 20px;
  font-weight: 700;
}

h4 {
  margin-bottom: 10px;
  font-size: 14px;
}

.hint,
.meta,
.progress,
.empty {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.panel {
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #fff;
}

.panel.muted {
  background: #fbfcfe;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin: 0 0 12px;
}

.meta strong {
  color: var(--ink);
}

.channels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.chip {
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #f8fafc;
  font-family: var(--mono);
  font-size: 12px;
}

.id,
.url {
  font-family: var(--mono);
  font-size: 12px;
}

.url {
  color: var(--muted);
  word-break: break-all;
}

@media (max-width: 800px) {
  .hero {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
