import fs from 'fs'

const allowList = [
  'Blinkdrama-sign-v01',
  'Blinkdrama-v01',
  'Blinkdrama-v02',
  'Blinkdrama-v03',
  'Blinkdrama-v04',
  'reader-v01',
  'reader-v02',
  'cd-reader-pb-v01',
  'cd-reader-banner-v01',
  'moboreels-v01',
  'moboreels-v02',
  'moboreels-v03',
  'moboreels-v04',
  'Vibeshort-V01',
  'Vibeshort-v02',
  'Vibeshort-V03',
  'Vibeshort-V04',
  'Vibeshort-V05',
  'Vibeshort-sign-v01',
  'ShortMax-v03',
  'ShortMax-v04',
  'ShortMax-v05',
  'ShortMax-v06',
  'ShortMax-v11',
  'storyreel-v01',
  'storyreel-v02',
  'storyreel-v03',
  'storyreel-v04',
  'storyreel-v05',
  'storyreel-sign-v01',
].map((s) => s.toLowerCase())
const allow = new Set(allowList)

const report = JSON.parse(fs.readFileSync('data/ops-center/report.json', 'utf8'))
const lexicon = JSON.parse(fs.readFileSync('data/ops-center/seed-lexicon/by-category.json', 'utf8'))

const alias = {
  自身免疫: '医疗·自身免疫',
  '医疗·泌尿外科': '医疗·肾脏与泌尿',
}

function lexiconKey(name) {
  const n = String(name || '').trim()
  if (!n) return null
  if (lexicon.categories.some((c) => c.categoryKey === n)) return n
  if (alias[n] && lexicon.categories.some((c) => c.categoryKey === alias[n])) return alias[n]
  const short = n.replace(/^医疗·/, '')
  const hit = lexicon.categories.find(
    (c) => c.categoryKey === short || c.categoryKey.includes(short) || short.includes(c.categoryKey.replace(/^医疗·/, '')),
  )
  return hit?.categoryKey || null
}

function pickKeywords(catName, n = 5) {
  const key = lexiconKey(catName)
  if (!key) return { lexiconKey: null, keywords: [] }
  const cat = lexicon.categories.find((c) => c.categoryKey === key)
  const seeds = (cat?.seeds || []).filter((s) => String(s.regionId || 'US').toUpperCase() === 'US')
  return { lexiconKey: key, keywords: seeds.slice(0, n).map((s) => s.keyword) }
}

const summaries = (report.funnelReplaceSummaries || [])
  .filter((r) => allow.has(String(r.funnelName || '').toLowerCase()))
  .sort(
    (a, b) =>
      b.highSeverityCount - a.highSeverityCount ||
      b.weakOfferCount - a.weakOfferCount ||
      b.visits - a.visits,
  )

const advice = (report.replaceAdvice || []).filter((r) =>
  allow.has(String(r.funnelName || '').toLowerCase()),
)

const funnels = summaries.map((s) => {
  const weak = advice
    .filter((a) => a.funnelId === s.funnelId)
    .sort(
      (a, b) =>
        Number(b.severity === 'high') - Number(a.severity === 'high') || b.visits - a.visits,
    )
    .slice(0, 8)
    .map((a) => ({
      offerName: a.offerName,
      offerId: a.offerId,
      geo: a.geo,
      currentCategory: a.currentCategory,
      severity: a.severity,
      visits: Math.round(a.visits),
      revenue: Number(Number(a.revenue).toFixed(2)),
      reasons: (a.reasons || []).slice(0, 2),
      suggestCategories: (a.suggestCategories || []).slice(0, 3).map((c) => c.categoryName),
    }))

  const suggest = (s.suggestCategories || []).map((name) => {
    const kw = pickKeywords(name, 5)
    return { categoryName: name, lexiconKey: kw.lexiconKey, keywords: kw.keywords }
  })

  return {
    funnelId: s.funnelId,
    funnelName: s.funnelName,
    weakOfferCount: s.weakOfferCount,
    highSeverityCount: s.highSeverityCount,
    visits: Math.round(s.visits),
    revenue: Number(Number(s.revenue).toFixed(2)),
    currentCategories: s.currentCategories || [],
    sampleReasons: (s.sampleReasons || []).slice(0, 3),
    suggest,
    weakOffers: weak,
  }
})

const out = {
  title: '白名单漏斗换文分析',
  primaryDay: report.primaryDay,
  generatedAt: new Date().toISOString(),
  summary: {
    pendingFunnels: funnels.length,
    weakOffers: advice.length,
    highSeverity: advice.filter((a) => a.severity === 'high').length,
  },
  funnels,
}

fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync('tmp/whitelist-funnel-replace-share.json', JSON.stringify(out, null, 2))

const lines = []
lines.push(`【白名单漏斗换文建议】指标日 ${report.primaryDay}`)
lines.push(
  `待换漏斗 ${funnels.length} · 弱 offer ${advice.length}（高优 ${out.summary.highSeverity}）`,
)
lines.push('')
for (const [i, f] of funnels.entries()) {
  lines.push(
    `${i + 1}. ${f.funnelName} · 弱offer ${f.weakOfferCount} · 访问 ${f.visits} · 收入 $${f.revenue}`,
  )
  lines.push(`   当前品：${f.currentCategories.join('、') || '—'}`)
  lines.push(`   建议品：${f.suggest.map((s) => s.categoryName).join('、') || '—'}`)
  for (const s of f.suggest) {
    if (s.keywords.length) {
      lines.push(`   · ${s.categoryName} 推荐词：${s.keywords.slice(0, 3).join(' / ')}`)
    } else {
      lines.push(`   · ${s.categoryName}：词库暂无对应词`)
    }
  }
  if (f.sampleReasons[0]) lines.push(`   原因：${f.sampleReasons[0]}`)
  lines.push('')
}
fs.writeFileSync('tmp/whitelist-funnel-replace-share.txt', lines.join('\n'), 'utf8')

console.log(
  JSON.stringify(
    {
      wrote: ['tmp/whitelist-funnel-replace-share.json', 'tmp/whitelist-funnel-replace-share.txt'],
      ...out.summary,
      top: funnels.slice(0, 8).map((f) => ({
        name: f.funnelName,
        weak: f.weakOfferCount,
        suggest: f.suggest.map((s) => s.categoryName),
      })),
    },
    null,
    2,
  ),
)
