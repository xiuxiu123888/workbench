import fs from 'node:fs'

const day = process.argv[2] || '2026-11-13'
const j = JSON.parse(fs.readFileSync(`tmp/keyword-harvest-${day}.json`, 'utf8')) as {
  articleCount: number
  goodCount: number
  watchCount: number
  failedChunks: number
  good: Array<{
    keyword: string
    termClicks: number
    adClicks: number
    adRate: number
    articleCount: number
    score: number
  }>
  watch: Array<{
    keyword: string
    termClicks: number
    adClicks: number
    adRate: number
    articleCount: number
    score: number
  }>
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const esc = (s: string) => s.replace(/\|/g, '\\|')
const row = (
  r: {
    keyword: string
    termClicks: number
    adClicks: number
    adRate: number
    articleCount: number
    score: number
  },
  i: number,
) =>
  `| ${i + 1} | ${esc(r.keyword)} | ${r.termClicks} | ${r.adClicks} | ${pct(r.adRate)} | ${r.articleCount} | ${r.score.toFixed(0)} |`

const good = j.good || []
const goodSet = new Set(good.map((g) => g.keyword.toLowerCase()))
const watch = (j.watch || []).filter((w) => !goodSet.has(w.keyword.toLowerCase())).slice(0, 40)

const md = [
  `# 种子词日报 · ${day}`,
  '',
  '> 数据来源：白名单漏斗落地文 × `POST /forwardRecord/subid2DailyStat`（keywordLimit=30）  ',
  '> 好词门槛：词点≥30 · 广告点≥3 · 广告/词点≥8%',
  '',
  '## 概览',
  '',
  '| 项 | 值 |',
  '|---|---|',
  `| 统计日 | ${day} |`,
  `| 白名单文章数 | ${j.articleCount} |`,
  `| 好词入库数 | ${j.goodCount}（品类「换文供种」） |`,
  `| 观察池（宽松） | ${j.watchCount} |`,
  `| 失败分片 | ${j.failedChunks} |`,
  '',
  `## 好词榜（已入库，共 ${good.length}）`,
  '',
  '| # | 关键词 | 词点击 | 广告点击 | 二跳率 | 覆盖文章 | 综合分 |',
  '|---:|---|---:|---:|---:|---:|---:|',
  ...good.map(row),
  '',
  '## 使用建议',
  '',
  '- 优先用 **广告点击高 + 二跳率高** 的词做换文供种（榜单前 20）。',
  '- 美妆/提拉可看：`Voluma face lift`、`Botox Vs Dysport Units`、`Non Surgical Facial Rejuvenation`、`Beauty Products that Work`、`Best Non-surgical Facelift`。',
  '- 医疗/肿瘤可看：`Buprenorphine Everything You Need to Know`、`New Ways to Treat Cancer`；`Latest Trends...` 文内好，挂 offer ref 时需单独验证。',
  '- 创编入口：Offer 创编 → 词库品类 **换文供种**。',
  '',
  '## 观察池（未入库，相对宽松，已去掉好词重复）',
  '',
  '| # | 关键词 | 词点击 | 广告点击 | 二跳率 | 覆盖文章 | 综合分 |',
  '|---:|---|---:|---:|---:|---:|---:|',
  ...watch.map(row),
  '',
  '---',
  '',
  `*生成自 \`tmp/keyword-harvest-${day}.json\`*`,
  '',
].join('\n')

fs.mkdirSync('docs/reports', { recursive: true })
const out = `docs/reports/seed-keyword-daily-${day}.md`
fs.writeFileSync(out, md)
console.log(out)
console.log(`lines=${md.split('\n').length} good=${good.length} watch=${watch.length}`)
