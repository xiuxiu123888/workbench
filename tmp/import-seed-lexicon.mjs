/**
 * 从 tmp/xlsx-extract 种子表导入到 data/ops-center/seed-lexicon/（可提交）
 * 用法: node tmp/import-seed-lexicon.mjs
 */
import fs from 'fs'
import path from 'path'

const sheetPath = 'tmp/xlsx-extract/xl/worksheets/sheet1.xml'
const lookupPath = 'tmp/category-id-lookup.json'
const outLexicon = 'data/ops-center/seed-lexicon/by-category.json'
const outMeta = 'data/ops-center/seed-lexicon/meta.json'

function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parseSheet(file) {
  const xml = fs.readFileSync(file, 'utf8')
  const rows = []
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch
  while ((rowMatch = rowRe.exec(xml))) {
    const rowXml = rowMatch[1]
    const cells = {}
    const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>|<c r="([A-Z]+)(\d+)"([^>]*)\/>/g
    let cellMatch
    while ((cellMatch = cellRe.exec(rowXml))) {
      const col = cellMatch[1] || cellMatch[5]
      const body = cellMatch[4] || ''
      let value = null
      const is = body.match(/<is><t[^>]*>([\s\S]*?)<\/t><\/is>/)
      const v = body.match(/<v>([\s\S]*?)<\/v>/)
      if (is) value = decode(is[1])
      else if (v) value = decode(v[1])
      cells[col] = value
    }
    rows.push(cells)
  }
  return rows
}

if (!fs.existsSync(sheetPath)) {
  console.error(`缺少 ${sheetPath}，请先解压种子表到 tmp/xlsx-extract`)
  process.exit(1)
}

const lookup = fs.existsSync(lookupPath)
  ? JSON.parse(fs.readFileSync(lookupPath, 'utf8'))
  : {}

const byKey = new Map()
const sheetRows = parseSheet(sheetPath)
for (const r of sheetRows.slice(1)) {
  const keyword = String(r.B || '').trim()
  const domainCategory = String(r.D || '').trim()
  if (!keyword || !domainCategory || keyword.startsWith('▶')) continue
  const regionRaw = String(r.C || '').trim() || 'US'
  const regionId = regionRaw === 'VN' ? 'VI' : regionRaw
  const categoryId = lookup[domainCategory] ?? null
  const existing = byKey.get(domainCategory) || {
    categoryKey: domainCategory,
    categoryId,
    seeds: [],
    seen: new Set(),
  }
  if (existing.categoryId == null && categoryId != null) {
    existing.categoryId = categoryId
  }
  const key = `${regionId.toLowerCase()}::${keyword.toLowerCase()}`
  if (existing.seen.has(key)) continue
  existing.seen.add(key)
  existing.seeds.push({
    keyword,
    intentKeyword: keyword,
    ref: keyword,
    regionId,
  })
  byKey.set(domainCategory, existing)
}

const updatedAt = new Date().toISOString()
const categories = [...byKey.values()].map(({ seen, ...rest }) => rest)
const lexicon = { updatedAt, categories }

fs.mkdirSync(path.dirname(outLexicon), { recursive: true })
fs.writeFileSync(outLexicon, JSON.stringify(lexicon, null, 2), 'utf8')
fs.writeFileSync(
  outMeta,
  JSON.stringify(
    {
      updatedAt,
      source: sheetPath,
      categoryCount: categories.length,
      seedCount: categories.reduce((sum, row) => sum + row.seeds.length, 0),
    },
    null,
    2,
  ),
  'utf8',
)

console.log(
  JSON.stringify(
    {
      wrote: [outLexicon, outMeta],
      categoryCount: categories.length,
      seedCount: categories.reduce((sum, row) => sum + row.seeds.length, 0),
    },
    null,
    2,
  ),
)
