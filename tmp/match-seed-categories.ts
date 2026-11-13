import fs from 'node:fs'

type Cat = {
  id?: number | string
  categoryId?: number | string
  name?: string
  categoryName?: string
  alias?: string
  parentId?: number | string | null
  parent_id?: number | string | null
}

const raw = JSON.parse(fs.readFileSync('tmp/article-categories-raw.json', 'utf8'))
const list: Cat[] = Array.isArray(raw)
  ? raw
  : Array.isArray(raw?.data)
    ? raw.data
    : Array.isArray(raw?.list)
      ? raw.list
      : Array.isArray(raw?.categories)
        ? raw.categories
        : []

function text(c: Cat): string {
  return `${c.name || ''} ${c.categoryName || ''} ${c.alias || ''}`.toLowerCase()
}

function idOf(c: Cat): string {
  return String(c.id ?? c.categoryId ?? '')
}

const queries: Record<string, string[]> = {
  'SUV/PHEV租赁': ['suv', 'phev', 'lease', 'car', 'auto', 'vehicle', 'truck', '汽车', '车'],
  Gadgets: ['gadget', 'wellness', 'device', 'electronics', '智能', '数码', '电子'],
  猫砂: ['cat', 'litter', 'pet', '猫', '宠物'],
  医美注射: ['botox', 'dysport', 'xeomin', 'filler', 'injectable', 'aesthetic', 'cosmetic', '医美', '肉毒', '玻尿酸', '皮肤'],
  抗衰焕肤: ['skincare', 'facelift', 'fraxel', 'voluma', 'jeuveau', '美容', '抗衰', '护肤'],
  肿瘤: ['cancer', 'oncology', 'tumor', '肿瘤', '癌'],
  'GM混动': ['hybrid', 'chevrolet', 'gm', 'hummer', '混动'],
  '0利率购车': ['finance', 'financing', 'apr', 'loan', '汽车金融', '贷款'],
  Jeep: ['jeep', 'wagoneer'],
  丁丙诺啡成瘾: ['buprenorphine', 'brixadi', 'addiction', 'opioid', '成瘾', '戒毒', '物质'],
}

const hits: Record<string, Array<{ id: string; name: string; alias: string; score: number }>> = {}

for (const [group, terms] of Object.entries(queries)) {
  const scored = list
    .map((c) => {
      const t = text(c)
      let score = 0
      for (const term of terms) {
        if (t.includes(term.toLowerCase())) score += term.length >= 4 ? 2 : 1
      }
      return {
        id: idOf(c),
        name: String(c.name || c.categoryName || ''),
        alias: String(c.alias || ''),
        score,
      }
    })
    .filter((row) => row.score > 0 && row.name)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 12)
  hits[group] = scored
}

// also dump current seed lexicon categories present in raw
const seedKeys = [
  'GLP-1 / 糖尿病',
  '心理健康 / 成瘾',
  '心血管 / 抗凝',
  '牙科',
  '眼科 / 视力',
  '肿瘤 / 生物制剂',
  '诊断 / 急诊',
  '骨科 / 关节',
  '医疗·肾脏与泌尿',
  '医疗·皮肤',
  '医疗·偏头痛',
  '医疗·呼吸与睡眠',
  '医疗·自身免疫',
]

const seedPresence = seedKeys.map((key) => {
  const found = list.find((c) => String(c.name || c.categoryName || '').trim() === key)
  return { key, found: Boolean(found), id: found ? idOf(found) : null }
})

console.log(
  JSON.stringify(
    {
      total: list.length,
      sampleKeys: list[0] ? Object.keys(list[0]) : [],
      sample: list[0],
      seedPresence,
      hits,
    },
    null,
    2,
  ),
)
