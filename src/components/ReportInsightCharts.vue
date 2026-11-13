<script setup lang="ts">
import { computed } from 'vue'
import type {
  ArticleContributionRow,
  CountryContributionRow,
  GrowingArticleRow,
  ReplaceCandidateRow,
} from '../domain/reportInsights'

const props = defineProps<{
  growing: GrowingArticleRow[]
  replace: ReplaceCandidateRow[]
  countries: CountryContributionRow[]
  contributions: ArticleContributionRow[]
}>()

function shortId(id: string): string {
  const text = String(id || '')
  return text.length > 10 ? `${text.slice(0, 4)}…${text.slice(-4)}` : text
}

function barRows<T extends { label: string; value: number; meta?: string; tone?: 'up' | 'down' | 'warn' | 'neutral' }>(
  items: T[],
): Array<T & { width: number }> {
  const max = Math.max(0, ...items.map((item) => Math.abs(item.value)))
  return items.map((item) => ({
    ...item,
    width: max > 0 ? Math.max(4, (Math.abs(item.value) / max) * 100) : 0,
  }))
}

const growingBars = computed(() =>
  barRows(
    props.growing.map((row) => ({
      label: shortId(row.articleId),
      value: row.adClicksDelta || row.pageViewsDelta,
      meta: `广点 ${row.adClicksDelta > 0 ? '+' : ''}${row.adClicksDelta} · 曝光 ${row.pageViewsDelta > 0 ? '+' : ''}${row.pageViewsDelta}${row.countryCode ? ` · ${row.countryCode}` : ''}`,
      tone: 'up' as const,
      title: row.articleId,
    })),
  ),
)

const contributionBars = computed(() =>
  barRows(
    props.contributions.map((row) => ({
      label: shortId(row.articleId),
      value: row.adClicks,
      meta: `广点 ${row.adClicks}${row.adShare != null ? `（${(row.adShare * 100).toFixed(1)}%）` : ''}${row.countryCode ? ` · ${row.countryCode}` : ''}`,
      tone: 'neutral' as const,
      title: row.articleId,
    })),
  ),
)

const countryBars = computed(() =>
  barRows(
    props.countries.map((row) => ({
      label: row.countryCode,
      value: row.adClicks || row.pageViews,
      meta: `广点 ${row.adClicks} · 曝光 ${row.pageViews} · ${row.articleCount} 篇`,
      tone: 'neutral' as const,
      title: row.countryCode,
    })),
  ),
)

const replaceBars = computed(() =>
  barRows(
    props.replace.map((row) => ({
      label: shortId(row.articleId),
      value: Math.max(1, 20 - Math.min(20, row.pageViews)),
      meta: `${row.reason} · 曝光 ${row.pageViews} / 广点 ${row.adClicks}${row.countryCode ? ` · ${row.countryCode}` : ''}`,
      tone: 'warn' as const,
      title: row.articleId,
    })),
  ),
)
</script>

<template>
  <div class="charts">
    <p class="note">
      收入仍看下方渠道表。这里用图看：谁在涨、谁该换、国家贡献、文章点击贡献。自动换文尚未接入。
    </p>
    <div class="grid">
      <section class="card">
        <h4>增长文章</h4>
        <p v-if="growingBars.length === 0" class="empty">暂无相对前一日上涨的文章</p>
        <ul v-else class="bars">
          <li v-for="row in growingBars" :key="`g-${row.title}`">
            <div class="head">
              <strong :title="row.title">{{ row.label }}</strong>
              <span>{{ row.meta }}</span>
            </div>
            <div class="track" aria-hidden="true">
              <i class="fill up" :style="{ width: `${row.width}%` }" />
            </div>
          </li>
        </ul>
      </section>

      <section class="card">
        <h4>建议换掉</h4>
        <p v-if="replaceBars.length === 0" class="empty">按当前规则暂无建议</p>
        <ul v-else class="bars">
          <li v-for="row in replaceBars" :key="`r-${row.title}`">
            <div class="head">
              <strong :title="row.title">{{ row.label }}</strong>
              <span>{{ row.meta }}</span>
            </div>
            <div class="track" aria-hidden="true">
              <i class="fill warn" :style="{ width: `${row.width}%` }" />
            </div>
          </li>
        </ul>
      </section>

      <section class="card">
        <h4>国家贡献（最近一天）</h4>
        <p v-if="countryBars.length === 0" class="empty">没有国家数据</p>
        <ul v-else class="bars">
          <li v-for="row in countryBars" :key="`c-${row.label}`">
            <div class="head">
              <strong>{{ row.label }}</strong>
              <span>{{ row.meta }}</span>
            </div>
            <div class="track" aria-hidden="true">
              <i class="fill blue" :style="{ width: `${row.width}%` }" />
            </div>
          </li>
        </ul>
      </section>

      <section class="card">
        <h4>文章点击贡献（最近一天）</h4>
        <p v-if="contributionBars.length === 0" class="empty">没有文章点击</p>
        <ul v-else class="bars">
          <li v-for="row in contributionBars" :key="`a-${row.title}`">
            <div class="head">
              <strong :title="row.title">{{ row.label }}</strong>
              <span>{{ row.meta }}</span>
            </div>
            <div class="track" aria-hidden="true">
              <i class="fill blue" :style="{ width: `${row.width}%` }" />
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.charts {
  margin-top: 16px;
}

.note,
.empty {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.note {
  margin-bottom: 10px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 960px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.card {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
}

.card h4 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 650;
}

.bars {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.head {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}

.head strong {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.head span {
  color: var(--muted);
  font-size: 11px;
  text-align: right;
}

.track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: #eef2f7;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 999px;
}

.fill.up {
  background: #3ba55d;
}

.fill.warn {
  background: #d9480f;
}

.fill.blue {
  background: var(--blue);
}
</style>
