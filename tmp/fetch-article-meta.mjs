import fs from 'fs'
import path from 'path'

const envText = fs.readFileSync('.env.local', 'utf8')
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    }),
)

const token = env.VITE_ARTICLE_TOKEN
const bases = [
  'https://adesmobi.com/admin/back',
  'http://adesmobi.com/admin/back',
  String(env.VITE_ARTICLE_API_TARGET || '').replace(/\/$/, ''),
  'https://adesmobi.com/creator-platform/back',
  'http://adesmobi.com/creator-platform/back',
].filter(Boolean)

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text.slice(0, 300)
  }
  return { ok: res.ok, status: res.status, body }
}

const needed = [
  'GLP-1 / 糖尿病',
  '医疗·偏头痛',
  '医疗·呼吸与睡眠',
  '医疗·皮肤',
  '医疗·肾脏与泌尿',
  '医疗·自身免疫',
  '心理健康 / 成瘾',
  '心血管 / 抗凝',
  '牙科',
  '眼科 / 视力',
  '肿瘤 / 生物制剂',
  '诊断 / 急诊',
  '骨科 / 关节',
]

function normalize(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[·•]/g, '/')
    .replace(/\s+/g, '')
}

function scoreMatch(want, item) {
  const w = normalize(want)
  const name = normalize(item.name)
  const alias = normalize(item.alias)
  if (!w) return 0
  if (name === w || alias === w) return 100
  if (name.includes(w) || w.includes(name) || alias.includes(w) || w.includes(alias)) return 80
  // soft token overlap
  const tokens = w.split(/[\/／]/).filter(Boolean)
  let hit = 0
  for (const t of tokens) {
    if ((name && name.includes(t)) || (alias && alias.includes(t))) hit += 1
  }
  if (hit && tokens.length) return 40 + Math.round((hit / tokens.length) * 30)
  return 0
}

const result = {
  fetchedAt: new Date().toISOString(),
  triedBases: [],
  categoriesUrl: null,
  sitesUrl: null,
  categoryCount: 0,
  siteCount: 0,
  categoryMatches: [],
  unmatchedCategories: [],
  siteSample: [],
}

let categories = null
let sites = null

for (const base of bases) {
  const catUrl = `${base}/article/allCategoryNew`
  const siteUrl = `${base}/site/getAll`
  const cat = await fetchJson(catUrl)
  result.triedBases.push({ base, categoryStatus: cat.status, siteProbe: 'pending' })
  console.log('try category', catUrl, cat.status, typeof cat.body === 'object' ? cat.body?.code ?? cat.body?.msg : cat.body)
  if (cat.ok && cat.body && typeof cat.body === 'object') {
    const data = cat.body.data ?? cat.body
    if (Array.isArray(data) && data.length) {
      categories = data
      result.categoriesUrl = catUrl
      const site = await fetchJson(siteUrl)
      result.triedBases[result.triedBases.length - 1].siteProbe = site.status
      console.log('try site', siteUrl, site.status, typeof site.body === 'object' ? site.body?.code ?? site.body?.msg : site.body)
      if (site.ok && site.body && typeof site.body === 'object') {
        const siteData = site.body.data ?? site.body
        if (Array.isArray(siteData)) {
          sites = siteData
          result.sitesUrl = siteUrl
          break
        }
      }
    }
  }
}

if (!categories) {
  console.error('failed to fetch categories')
  fs.writeFileSync('tmp/article-meta-fetch.json', JSON.stringify(result, null, 2))
  process.exit(1)
}

result.categoryCount = categories.length
result.siteCount = sites?.length || 0

for (const want of needed) {
  const ranked = categories
    .map((item) => ({ item, score: scoreMatch(want, item) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best) {
    result.unmatchedCategories.push(want)
    result.categoryMatches.push({
      domainCategory: want,
      categoryId: null,
      matchedName: null,
      matchedAlias: null,
      score: 0,
      candidates: [],
    })
    continue
  }
  result.categoryMatches.push({
    domainCategory: want,
    categoryId: best.item.id,
    matchedName: best.item.name ?? null,
    matchedAlias: best.item.alias ?? null,
    parentId: best.item.parentId ?? null,
    score: best.score,
    candidates: ranked.slice(0, 5).map((x) => ({
      id: x.item.id,
      name: x.item.name,
      alias: x.item.alias,
      parentId: x.item.parentId,
      score: x.score,
    })),
  })
}

result.siteSample = (sites || []).slice(0, 5).map((s) => ({
  id: s.id,
  siteName: s.siteName,
  siteUrl: s.siteUrl,
  accountId: s.accountId,
  isPass: s.isPass,
}))

fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync('tmp/article-categories-raw.json', JSON.stringify(categories, null, 2))
fs.writeFileSync('tmp/article-sites-raw.json', JSON.stringify(sites || [], null, 2))
fs.writeFileSync('tmp/article-meta-fetch.json', JSON.stringify(result, null, 2))

// patch plan if exists
const planPath = 'tmp/medical-seo-offer-plan.json'
if (fs.existsSync(planPath)) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  plan.blockers = plan.blockers || {}
  plan.blockers.categoryIdsNeeded = result.categoryMatches.map((m) => ({
    domainCategory: m.domainCategory,
    categoryId: m.categoryId,
    matchedName: m.matchedName,
    matchedAlias: m.matchedAlias,
    score: m.score,
  }))
  plan.blockers.categoryMatchSource = {
    categoriesUrl: result.categoriesUrl,
    sitesUrl: result.sitesUrl,
    categoryCount: result.categoryCount,
    siteCount: result.siteCount,
    unmatchedCategories: result.unmatchedCategories,
  }
  plan.metaResolved = {
    fetchedAt: result.fetchedAt,
    categoriesUrl: result.categoriesUrl,
    sitesUrl: result.sitesUrl,
    note: 'siteId 按每个 offer 旧落地链域名在 sites 里反查，不在此写死',
  }
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2))
}

console.log(
  JSON.stringify(
    {
      categoriesUrl: result.categoriesUrl,
      sitesUrl: result.sitesUrl,
      categoryCount: result.categoryCount,
      siteCount: result.siteCount,
      unmatchedCategories: result.unmatchedCategories,
      matches: result.categoryMatches.map((m) => ({
        domainCategory: m.domainCategory,
        categoryId: m.categoryId,
        matchedName: m.matchedName,
        score: m.score,
      })),
    },
    null,
    2,
  ),
)
