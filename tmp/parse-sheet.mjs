import fs from 'fs'
import path from 'path'

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
      const attrs = cellMatch[3] || cellMatch[7] || ''
      const body = cellMatch[4] || ''
      let value = null
      const is = body.match(/<is><t[^>]*>([\s\S]*?)<\/t><\/is>/)
      const v = body.match(/<v>([\s\S]*?)<\/v>/)
      if (is) value = decode(is[1])
      else if (v) value = decode(v[1])
      if (attrs.includes('t="inlineStr"') && !value) {
        const t = body.match(/<t[^>]*>([\s\S]*?)<\/t>/)
        if (t) value = decode(t[1])
      }
      cells[col] = value
    }
    rows.push(cells)
  }
  return rows
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

const sheet1 = parseSheet('tmp/xlsx-extract/xl/worksheets/sheet1.xml')
const sheet2 = parseSheet('tmp/xlsx-extract/xl/worksheets/sheet2.xml')
console.log('sheet1 rows', sheet1.length)
console.log(JSON.stringify(sheet1.slice(0, 15), null, 2))
console.log('sheet2 rows', sheet2.length)
console.log(JSON.stringify(sheet2.slice(0, 10), null, 2))

const header = sheet1[0] || {}
const keys = Object.keys(header).sort()
console.log('header', header)

const data = sheet1.slice(1).filter((r) => Object.values(r).some((v) => v != null && String(v).trim()))
const records = data.map((r) => ({
  a: r.A ?? null,
  b: r.B ?? null,
  c: r.C ?? null,
  d: r.D ?? null,
  e: r.E ?? null,
  f: r.F ?? null,
}))
console.log('data count', records.length)
console.log(JSON.stringify(records, null, 2))

const cats = [...new Set(records.map((r) => r.b || r.a).filter(Boolean))]
console.log('possible cats', cats)
