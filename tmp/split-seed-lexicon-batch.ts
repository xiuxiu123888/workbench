import fs from 'node:fs'
import path from 'node:path'

type Seed = {
  keyword: string
  intentKeyword: string
  ref: string
  regionId: string
}

type Cat = {
  categoryKey: string
  categoryId: number
  seeds: Seed[]
}

function seed(keyword: string, regionId = 'US'): Seed {
  return { keyword, intentKeyword: keyword, ref: keyword, regionId }
}

const root = process.cwd()
const lexiconPath = path.join(root, 'data/ops-center/seed-lexicon/by-category.json')
const current = JSON.parse(fs.readFileSync(lexiconPath, 'utf8')) as {
  updatedAt?: string
  categories: Cat[]
}

const newKeywords = new Set([
  'long acting buprenorphine',
  'Buprenorphine everything you need to know',
  'brixadi market trends',
  'buprenorphine induction protocol',
  'new ways to treat cancer',
  'latest trends and advancements in oncology',
  'treatments modalities of cancer',
  'new cancer drugs',
])

const medical63: Cat[] = current.categories.map((cat) => ({
  ...cat,
  seeds: cat.seeds.filter((row) => !newKeywords.has(row.keyword)),
}))
const medicalSeedCount = medical63.reduce((sum, cat) => sum + cat.seeds.length, 0)

fs.writeFileSync(
  path.join(root, 'data/ops-center/seed-lexicon/by-category.medical-63.json'),
  JSON.stringify(
    {
      updatedAt: '2026-11-12T06:38:57.058Z',
      categories: medical63,
    },
    null,
    2,
  ),
  'utf8',
)

/** 今天要跑的新词批次：与旧 63 条隔离 */
const batchCategories: Cat[] = [
  {
    categoryKey: 'SUV',
    categoryId: 5338,
    seeds: [
      seed('best phev lease'),
      seed('best suv incentives right now'),
      seed('suv that hold their value'),
      seed('best suvs for 2027'),
      seed('best suv to buy right now'),
      seed('best suv leases right now'),
      seed('jeep wagoneers'),
      seed('best jeep model'),
      seed('new jeep suv'),
      seed('new jeep wagoneer'),
    ],
  },
  {
    categoryKey: '消费电子',
    categoryId: 5876,
    seeds: [
      seed('gadgets for wellness'),
      seed('innovative gadgets'),
      seed('new gadgets'),
      seed('buy gadgets online'),
    ],
  },
  {
    categoryKey: '宠物产品',
    categoryId: 5884,
    seeds: [
      seed('clorox everclean'),
      seed('best cat litter to keep smell down'),
      seed('best cat litter reddit'),
      seed('best non smelling cat litter'),
    ],
  },
  {
    categoryKey: '注射除皱',
    categoryId: 5591,
    seeds: [
      seed('wowcher botox', 'GB'),
      seed('botox dysport and xeomin injectable near me'),
      seed('botox vs dysport units'),
      seed('botox vs dysport for brow lift'),
      seed('replacement for botox'),
      seed('fillers near me'),
    ],
  },
  {
    categoryKey: '面部提拉',
    categoryId: 5162,
    seeds: [
      seed('voluma face lift'),
      seed('new skincare treatments'),
      seed('best wedding skincare products'),
      seed('jeuveau botox head to head'),
      seed('best non surgical facelift'),
      seed('fraxel vs botox'),
    ],
  },
  {
    categoryKey: '肿瘤 / 生物制剂',
    categoryId: 6308,
    seeds: [
      seed('new ways to treat cancer'),
      seed('latest trends and advancements in oncology'),
      seed('treatments modalities of cancer'),
      seed('new cancer drugs'),
    ],
  },
  {
    categoryKey: '新能源汽车',
    categoryId: 5246,
    seeds: [
      seed('new hummers'),
      seed('gm hybrid vehicles'),
      seed('Chevrolet hybrid vehicles'),
      seed('gm hybrid suv'),
    ],
  },
  {
    categoryKey: '汽车金融',
    categoryId: 5868,
    seeds: [
      seed('hyundai 0 financing'),
      seed('cars for sale 0% finance'),
      seed('cars with 0 finance'),
      seed('cars with 0 apr'),
    ],
  },
  {
    categoryKey: '心理健康 / 成瘾',
    categoryId: 6314,
    seeds: [
      seed('long acting buprenorphine'),
      seed('Buprenorphine everything you need to know'),
      seed('brixadi market trends'),
      seed('buprenorphine induction protocol'),
    ],
  },
]

const batchSeedCount = batchCategories.reduce((sum, cat) => sum + cat.seeds.length, 0)
const updatedAt = new Date().toISOString()

fs.writeFileSync(
  lexiconPath,
  JSON.stringify({ updatedAt, categories: batchCategories }, null, 2),
  'utf8',
)
fs.writeFileSync(
  path.join(root, 'data/ops-center/seed-lexicon/meta.json'),
  JSON.stringify(
    {
      updatedAt,
      source: 'tmp/seed-keywords-near-original.txt (batch only, not mixed with medical-63)',
      categoryCount: batchCategories.length,
      seedCount: batchSeedCount,
      archivedMedical63: 'seed-lexicon/by-category.medical-63.json',
      archivedMedical63SeedCount: medicalSeedCount,
    },
    null,
    2,
  ),
  'utf8',
)

console.log(
  JSON.stringify(
    {
      medical63SeedCount: medicalSeedCount,
      batchSeedCount,
      batchCategories: batchCategories.map((c) => ({
        categoryKey: c.categoryKey,
        categoryId: c.categoryId,
        seedCount: c.seeds.length,
      })),
    },
    null,
    2,
  ),
)
