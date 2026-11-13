import fs from 'fs'

const categories = JSON.parse(fs.readFileSync('tmp/article-categories-raw.json', 'utf8'))
const sites = JSON.parse(fs.readFileSync('tmp/article-sites-raw.json', 'utf8'))

const mapping = [
  {
    domainCategory: 'GLP-1 / 糖尿病',
    categoryId: 6305,
    matchedName: 'GLP-1 / 糖尿病',
    confidence: 'exact',
  },
  {
    domainCategory: '心理健康 / 成瘾',
    categoryId: 6314,
    matchedName: '心理健康 / 成瘾',
    confidence: 'exact',
  },
  {
    domainCategory: '心血管 / 抗凝',
    categoryId: 6307,
    matchedName: '心血管 / 抗凝',
    confidence: 'exact',
  },
  {
    domainCategory: '牙科',
    categoryId: 5342,
    matchedName: '牙科',
    confidence: 'exact',
  },
  {
    domainCategory: '眼科 / 视力',
    categoryId: 6311,
    matchedName: '眼科 / 视力',
    confidence: 'exact',
  },
  {
    domainCategory: '肿瘤 / 生物制剂',
    categoryId: 6308,
    matchedName: '肿瘤 / 生物制剂',
    confidence: 'exact',
  },
  {
    domainCategory: '诊断 / 急诊',
    categoryId: 6316,
    matchedName: '诊断 / 急诊',
    confidence: 'exact',
  },
  {
    domainCategory: '骨科 / 关节',
    categoryId: 6310,
    matchedName: '骨科 / 关节',
    confidence: 'exact',
  },
  {
    domainCategory: '医疗·肾脏与泌尿',
    categoryId: 6333,
    matchedName: '医疗·泌尿外科',
    confidence: 'proposed',
    note: '表中无同名；建议用 医疗·泌尿外科',
    alternatives: [{ id: 6333, name: '医疗·泌尿外科' }],
  },
  {
    domainCategory: '医疗·皮肤',
    categoryId: null,
    matchedName: null,
    confidence: 'missing',
    note: '无同名类目，请指定',
    alternatives: [
      { id: 5063, name: '皮肤管理与护理' },
      { id: 5903, name: '皮肤美容' },
      { id: 5166, name: '激光皮肤治疗' },
      { id: 5027, name: '医疗健康' },
    ],
  },
  {
    domainCategory: '医疗·偏头痛',
    categoryId: null,
    matchedName: null,
    confidence: 'missing',
    note: '无同名类目，请指定或新建',
    alternatives: [
      { id: 5027, name: '医疗健康' },
      { id: 5843, name: '医药研发（父级，含一批新医疗词类目）' },
    ],
  },
  {
    domainCategory: '医疗·呼吸与睡眠',
    categoryId: null,
    matchedName: null,
    confidence: 'missing',
    note: '无同名类目；睡眠侧有近似',
    alternatives: [
      { id: 5024, name: '睡眠健康' },
      { id: 6276, name: '睡眠和健康评估' },
      { id: 5027, name: '医疗健康' },
    ],
  },
  {
    domainCategory: '医疗·自身免疫',
    categoryId: null,
    matchedName: null,
    confidence: 'missing',
    note: '无同名类目；有免疫炎症近似',
    alternatives: [
      { id: 5112, name: '免疫炎症疾病靶向治疗' },
      { id: 5027, name: '医疗健康' },
      { id: 5843, name: '医药研发' },
    ],
  },
]

const byHost = {}
for (const site of sites) {
  const raw = String(site.siteUrl || site.siteName || '').trim()
  if (!raw) continue
  let host = raw
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    host = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase()
  }
  if (!host) continue
  if (!byHost[host]) {
    byHost[host] = {
      siteId: site.id,
      accountId: site.accountId,
      siteName: site.siteName,
      siteUrl: site.siteUrl,
      isPass: site.isPass,
    }
  }
}

const out = {
  fetchedAt: new Date().toISOString(),
  sources: {
    categoriesUrl: 'https://adesmobi.com/admin/back/article/allCategoryNew',
    sitesUrl: 'https://adesmobi.com/admin/back/site/getAll',
    categoryCount: categories.length,
    siteCount: sites.length,
    uniqueHosts: Object.keys(byHost).length,
  },
  categoryIdMap: mapping,
  exactCount: mapping.filter((m) => m.confidence === 'exact').length,
  proposedCount: mapping.filter((m) => m.confidence === 'proposed').length,
  missingCount: mapping.filter((m) => m.confidence === 'missing').length,
  siblingsUnder医药研发: categories
    .filter((c) => String(c.parentId) === '5843')
    .map((c) => ({ id: c.id, name: c.name, alias: c.alias })),
  siteHostIndexSample: Object.entries(byHost)
    .slice(0, 10)
    .map(([host, info]) => ({ host, ...info })),
}

fs.writeFileSync('tmp/category-id-map.json', JSON.stringify(out, null, 2))
fs.writeFileSync('tmp/site-host-index.json', JSON.stringify(byHost, null, 2))

const planPath = 'tmp/medical-seo-offer-plan.json'
if (fs.existsSync(planPath)) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  plan.blockers = plan.blockers || {}
  plan.blockers.categoryIdsNeeded = mapping
  plan.blockers.categoryMatchSource = out.sources
  plan.metaResolved = {
    fetchedAt: out.fetchedAt,
    categoriesUrl: out.sources.categoriesUrl,
    sitesUrl: out.sources.sitesUrl,
    siteHostIndexFile: 'tmp/site-host-index.json',
    note: 'siteId 按 offer 旧落地链 host 在 site-host-index 反查',
  }
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2))
}

console.log(
  JSON.stringify(
    {
      exact: mapping.filter((m) => m.confidence === 'exact'),
      proposed: mapping.filter((m) => m.confidence === 'proposed'),
      missing: mapping.filter((m) => m.confidence === 'missing'),
      siteCount: sites.length,
      hostCount: Object.keys(byHost).length,
    },
    null,
    2,
  ),
)
