/**
 * 拉取白名单漏斗落地文的关键词日报（subid2DailyStat），反查文章品类后落盘。
 *
 * 默认：上海时区「今天」（当天创编/换文可反复跑，拿截至当前的数据）
 *
 * 用法：
 *   npm run seeds:harvest
 *   npm run seeds:harvest -- 2026-11-13
 *   npm run seeds:harvest -- --day=2026-11-14 --write-lexicon
 *
 * 产出：
 *   data/ops-center/keyword-harvest/{day}.json  （种子词日报页读取）
 *   data/ops-center/keyword-harvest/index.json
 *   docs/reports/seed-keyword-daily-{day}.md
 *   可选：--write-lexicon 把「已挂类目的好词」合并进 seed-lexicon
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CategoryOption } from '../src/api/article'
import { FUNNEL_BROWSE_ALLOWLIST } from '../src/domain/funnelBrowseAllowlist'
import {
  enrichHarvestWithCategories,
  harvestKeywordsFromDaily,
  mergeHarvestIntoLexiconByCategory,
  type HarvestKeywordRow,
} from '../src/domain/keywordHarvest'
import { normalizeSeedLexicon, type SeedLexiconFile } from '../src/domain/offerSeedLexicon'
import { shanghaiDay } from '../src/domain/opsCenterTime'
import type { Subid2DailyStatDay } from '../src/domain/report'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return
  for (const raw of fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env) || process.env[key] === '') {
      process.env[key] = value
    }
  }
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`缺少 ${name}，请写在 .env.local`)
  return value
}

function parseArgs(argv: string[]) {
  let day = ''
  let writeLexicon = false
  const positionals: string[] = []
  for (const arg of argv) {
    if (arg === '--write-lexicon') {
      writeLexicon = true
      continue
    }
    if (arg.startsWith('--day=')) {
      day = arg.slice('--day='.length).trim()
      continue
    }
    if (arg === '--day') continue
    if (!arg.startsWith('-')) positionals.push(arg)
  }
  if (!day && positionals[0] && /^\d{4}-\d{2}-\d{2}$/.test(positionals[0])) {
    day = positionals[0]
  }
  if (!day) day = shanghaiDay()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`日期格式错误: ${day}`)
  }
  return { day, writeLexicon }
}

function refArticleId(url: string): string {
  const m = String(url || '').match(/\/detail\/(\d+)/)
  return m?.[1] || ''
}

function funnelFromOfferName(name: string): string {
  const n = String(name || '')
  const hit = FUNNEL_BROWSE_ALLOWLIST.find((f) => n.toLowerCase().startsWith(f.toLowerCase() + '-'))
  return hit || ''
}

function listMetricDays(): string[] {
  const dir = path.join(ROOT, 'data', 'ops-center', 'metrics')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .filter((day) => fs.existsSync(path.join(dir, day, 'all.json')))
    .sort((a, b) => b.localeCompare(a))
}

/** 白名单 offer 的落地文章 id：优先用目标日 metrics，没有则退到最近有 all.json 的一天 */
function collectWhitelistArticleIds(statDay: string): { ids: string[]; metricsDay: string } {
  const days = listMetricDays()
  const metricsDay = days.includes(statDay) ? statDay : days[0]
  if (!metricsDay) {
    throw new Error('data/ops-center/metrics 下没有 all.json，请先同步漏斗指标')
  }
  const metricsPath = path.join(ROOT, 'data', 'ops-center', 'metrics', metricsDay, 'all.json')
  const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8')) as { statsList?: any[] }
  const allow = new Set(FUNNEL_BROWSE_ALLOWLIST.map((x) => x.toLowerCase()))
  const articleIds = new Set<string>()
  for (const item of metrics.statsList || []) {
    const funnel = funnelFromOfferName(String(item.name || ''))
    if (!funnel || !allow.has(funnel.toLowerCase())) continue
    if (/default/i.test(String(item.name || ''))) continue
    const id = refArticleId(String(item.url || ''))
    if (id) articleIds.add(id)
  }
  return { ids: [...articleIds], metricsDay }
}

async function fetchDailyStat(input: {
  base: string
  token: string
  articleIds: string[]
  day: string
  keywordLimit: number
}): Promise<Subid2DailyStatDay[]> {
  const res = await fetch(`${input.base.replace(/\/$/, '')}/forwardRecord/subid2DailyStat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      subid2List: input.articleIds,
      startDate: input.day,
      endDate: input.day,
      keywordLimit: input.keywordLimit,
    }),
  })
  const json = (await res.json().catch(() => null)) as {
    code?: number
    msg?: string
    data?: Subid2DailyStatDay[] | null
  } | null
  if (!res.ok || (json?.code != null && json.code !== 200 && json.code !== 0)) {
    throw new Error(json?.msg || `HTTP ${res.status}`)
  }
  return Array.isArray(json?.data) ? json!.data! : []
}

async function resolveArticleCategories(
  base: string,
  token: string,
  articleIds: string[],
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {}
  for (let i = 0; i < articleIds.length; i += 1) {
    const id = articleIds[i]
    if (i % 40 === 0) {
      process.stderr.write(`detail ${i + 1}/${articleIds.length}\n`)
    }
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/article/detail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id }),
      })
      const json = (await res.json()) as { data?: { articleCategoryId?: unknown } }
      const cat = Number(json?.data?.articleCategoryId)
      out[id] = Number.isFinite(cat) && cat > 0 ? cat : null
    } catch {
      out[id] = null
    }
  }
  return out
}

async function loadCategories(base: string, token: string): Promise<CategoryOption[]> {
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/article/allCategoryNew`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await res.json()) as { data?: CategoryOption[] | null }
    return Array.isArray(json?.data) ? json.data! : []
  } catch {
    return []
  }
}

function writeReportMd(day: string, report: {
  articleCount: number
  goodCount: number
  watchCount: number
  failedChunks: number
  goodWithCategory?: number
  good: HarvestKeywordRow[]
  watch: HarvestKeywordRow[]
}) {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  const esc = (s: string) => s.replace(/\|/g, '\\|')
  const row = (r: HarvestKeywordRow, i: number) =>
    `| ${i + 1} | ${esc(r.keyword)} | ${esc(r.categoryKey || '—')} | ${r.categoryId ?? '—'} | ${r.termClicks} | ${r.adClicks} | ${pct(r.adRate)} | ${r.articleCount} |`
  const goodSet = new Set(report.good.map((g) => g.keyword.toLowerCase()))
  const watch = report.watch.filter((w) => !goodSet.has(w.keyword.toLowerCase())).slice(0, 40)
  const md = [
    `# 种子词日报 · ${day}`,
    '',
    '> 来源：白名单文章 × `subid2DailyStat`；类目来自 `article/detail.articleCategoryId`',
    '',
    '## 概览',
    '',
    `| 项 | 值 |`,
    `|---|---|`,
    `| 统计日 | ${day} |`,
    `| 文章数 | ${report.articleCount} |`,
    `| 好词 | ${report.goodCount}（已挂类目 ${report.goodWithCategory ?? 0}） |`,
    `| 观察池 | ${report.watchCount} |`,
    `| 失败分片 | ${report.failedChunks} |`,
    '',
    '## 好词榜',
    '',
    '| # | 关键词 | 品类 | categoryId | 词点击 | 广告点击 | 二跳率 | 文章数 |',
    '|---:|---|---|---:|---:|---:|---:|---:|',
    ...report.good.map(row),
    '',
    '## 观察池（节选）',
    '',
    '| # | 关键词 | 品类 | categoryId | 词点击 | 广告点击 | 二跳率 | 文章数 |',
    '|---:|---|---|---:|---:|---:|---:|---:|',
    ...watch.map(row),
    '',
  ].join('\n')
  const outDir = path.join(ROOT, 'docs', 'reports')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `seed-keyword-daily-${day}.md`), md)
}

async function main() {
  loadEnvFile(path.join(ROOT, '.env.local'))
  loadEnvFile(path.join(ROOT, '.env'))
  const { day, writeLexicon } = parseArgs(process.argv.slice(2))
  const today = shanghaiDay()
  const isLiveToday = day === today

  const token = requireEnv('VITE_ARTICLE_TOKEN')
  const base = requireEnv('VITE_ARTICLE_API_TARGET')

  const { ids, metricsDay } = collectWhitelistArticleIds(day)
  console.log(
    JSON.stringify(
      {
        day,
        today,
        isLiveToday,
        metricsDayUsedForArticleIds: metricsDay,
        articleCount: ids.length,
        writeLexicon,
      },
      null,
      2,
    ),
  )
  if (ids.length === 0) {
    throw new Error('白名单下没有解析到文章 id')
  }

  // 当天未跑完：门槛略放宽，便于中途创编
  const goodOpts = isLiveToday
    ? { minTermClicks: 10, minAdClicks: 1, minAdRate: 0.05, limit: 100 }
    : { minTermClicks: 30, minAdClicks: 3, minAdRate: 0.08, limit: 80 }
  const watchOpts = isLiveToday
    ? { minTermClicks: 20, minAdClicks: 1, minAdRate: 0.02, limit: 150 }
    : { minTermClicks: 50, minAdClicks: 1, minAdRate: 0.03, limit: 120 }

  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40))

  const dayRows: Subid2DailyStatDay[] = []
  let failedChunks = 0
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]
    process.stderr.write(`stat chunk ${i + 1}/${chunks.length} size=${chunk.length}\n`)
    try {
      dayRows.push(
        ...(await fetchDailyStat({
          base,
          token,
          articleIds: chunk,
          day,
          keywordLimit: 30,
        })),
      )
    } catch (error) {
      failedChunks += 1
      process.stderr.write(`chunk failed: ${error instanceof Error ? error.message : String(error)}\n`)
      for (const id of chunk) {
        try {
          dayRows.push(
            ...(await fetchDailyStat({
              base,
              token,
              articleIds: [id],
              day,
              keywordLimit: 30,
            })),
          )
        } catch {
          // skip
        }
      }
    }
  }

  let good = harvestKeywordsFromDaily(dayRows, goodOpts)
  let watch = harvestKeywordsFromDaily(dayRows, watchOpts)

  const needIds = new Set<string>()
  for (const row of [...good, ...watch]) {
    for (const id of row.articleIds) needIds.add(id)
  }
  process.stderr.write(`resolve articleCategoryId for ${needIds.size} articles\n`)
  const articleCategoryById = await resolveArticleCategories(base, token, [...needIds])
  const categories = await loadCategories(base, token)
  good = enrichHarvestWithCategories(good, articleCategoryById, categories)
  watch = enrichHarvestWithCategories(watch, articleCategoryById, categories)

  const categorized = (rows: HarvestKeywordRow[]) =>
    rows.filter((r) => r.categoryId != null && r.categoryId > 0).length

  const report = {
    day,
    pulledAt: new Date().toISOString(),
    isLiveToday,
    metricsDayUsedForArticleIds: metricsDay,
    articleCount: ids.length,
    failedChunks,
    goodCount: good.length,
    watchCount: watch.length,
    goodWithCategory: categorized(good),
    watchWithCategory: categorized(watch),
    thresholds: { good: goodOpts, watch: watchOpts },
    good,
    watch,
  }

  const harvestDir = path.join(ROOT, 'data', 'ops-center', 'keyword-harvest')
  fs.mkdirSync(harvestDir, { recursive: true })
  fs.writeFileSync(path.join(harvestDir, `${day}.json`), JSON.stringify(report, null, 2))
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'tmp', `keyword-harvest-${day}.json`), JSON.stringify(report, null, 2))

  const indexPath = path.join(harvestDir, 'index.json')
  const prevIndex = fs.existsSync(indexPath)
    ? (JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { days?: string[] })
    : { days: [] }
  const daySet = new Set([...(prevIndex.days || []), day])
  fs.writeFileSync(
    indexPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        days: [...daySet].sort((a, b) => b.localeCompare(a)),
      },
      null,
      2,
    ),
  )

  writeReportMd(day, report)

  let lexiconWritten = 0
  if (writeLexicon) {
    const lexiconPath = path.join(ROOT, 'data', 'ops-center', 'seed-lexicon', 'by-category.json')
    const prev = normalizeSeedLexicon(
      fs.existsSync(lexiconPath)
        ? (JSON.parse(fs.readFileSync(lexiconPath, 'utf8')) as Partial<SeedLexiconFile>)
        : undefined,
    )
    const withCat = good.filter((r) => r.categoryId != null && r.categoryId > 0)
    const next = mergeHarvestIntoLexiconByCategory(prev, withCat, 'US')
    fs.writeFileSync(lexiconPath, JSON.stringify(next, null, 2))
    fs.writeFileSync(
      path.join(ROOT, 'data', 'ops-center', 'seed-lexicon', 'meta.json'),
      JSON.stringify(
        {
          updatedAt: next.updatedAt,
          categoryCount: next.categories.length,
          seedCount: next.categories.reduce((s, c) => s + c.seeds.length, 0),
          harvestDay: day,
        },
        null,
        2,
      ),
    )
    lexiconWritten = withCat.length
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        day,
        isLiveToday,
        goodCount: good.length,
        goodWithCategory: categorized(good),
        lexiconWritten,
        viewInApp: '/seed-keyword-daily',
        files: [
          `data/ops-center/keyword-harvest/${day}.json`,
          `docs/reports/seed-keyword-daily-${day}.md`,
        ],
        top: good.slice(0, 10).map((r) => ({
          keyword: r.keyword,
          categoryId: r.categoryId,
          categoryKey: r.categoryKey,
          adClicks: r.adClicks,
        })),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
