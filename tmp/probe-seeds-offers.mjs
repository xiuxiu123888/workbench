import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { execSync } from 'child_process'

const require = createRequire(import.meta.url)

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk('data/ops-center').filter((f) => f.endsWith('.json'))
const hit = []
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8')
  if (t.includes('landingUrl') || t.includes('offerList') || t.includes('"offers"')) {
    hit.push(f)
  }
}
console.log('hits', hit.slice(0, 30), 'count', hit.length)

const rawDir = 'data/ops-center/raw'
const groupFile = fs.readdirSync(rawDir).find((x) => x.startsWith('group-'))
const g = JSON.parse(fs.readFileSync(path.join(rawDir, groupFile), 'utf8'))
console.log('group keys', Object.keys(g))
console.log('group sample', JSON.stringify(g).slice(0, 2500))

// parse xlsx via unzip + shared strings if possible
const xlsxPath = 'data/医疗SEO新词63条_2026-11-09.xlsx'
try {
  execSync(`tar -xf "${xlsxPath}" -C tmp/xlsx-extract`, { stdio: 'inherit' })
} catch {
  fs.mkdirSync('tmp/xlsx-extract', { recursive: true })
  try {
    execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${path.resolve(xlsxPath)}' -DestinationPath '${path.resolve('tmp/xlsx-extract')}' -Force"`, {
      stdio: 'inherit',
    })
  } catch (e) {
    console.error('extract failed', e.message)
  }
}
