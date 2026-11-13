import fs from 'fs'

function preserveHitPlaceholder(url) {
  return String(url || '').replace(/([?&])hit=%7Bhit%7D/gi, '$1hit={hit}')
}

function fixObjectUrls(obj) {
  if (!obj || typeof obj !== 'object') return 0
  let n = 0
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && /hit=%7Bhit%7D/i.test(value)) {
      const next = preserveHitPlaceholder(value)
      if (next !== value) {
        obj[key] = next
        n += 1
      }
    } else if (Array.isArray(value)) {
      for (const item of value) n += fixObjectUrls(item)
    } else if (value && typeof value === 'object') {
      n += fixObjectUrls(value)
    }
  }
  return n
}

const targets = [
  'data/ops-center/funnel-offer-drafts.json',
  'public/funnel-offer-drafts.json',
  'data/ops-center/offer-replace-log.json',
  ...fs.readdirSync('tmp').filter((f) => f.endsWith('-generate-run.json')).map((f) => `tmp/${f}`),
]

const summary = []
for (const file of targets) {
  if (!fs.existsSync(file)) continue
  const raw = fs.readFileSync(file, 'utf8')
  if (!/%7Bhit%7D/i.test(raw)) {
    summary.push({ file, changed: 0 })
    continue
  }
  const data = JSON.parse(raw)
  const changed = fixObjectUrls(data)
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  summary.push({ file, changed })
}

console.log(JSON.stringify({ fixedFiles: summary.filter((s) => s.changed > 0), totalChanged: summary.reduce((a, s) => a + s.changed, 0) }, null, 2))
