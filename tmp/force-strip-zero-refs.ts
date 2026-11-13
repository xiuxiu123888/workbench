import fs from 'node:fs'

const path = 'data/ops-center/funnel-offer-drafts.json'
const data = JSON.parse(fs.readFileSync(path, 'utf8')) as {
  updatedAt?: string
  source?: string
  count?: number
  jobs?: Array<Record<string, unknown>>
}
const jobs = Array.isArray(data.jobs) ? data.jobs : []
const now = new Date().toISOString()

function stripZeroFromRefText(text: string): string {
  return text
    .replace(/0%/gi, '')
    .replace(/0/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+%/g, '%')
    .replace(/%\s+/g, '%')
    .trim()
}

function updateUrlRef(url: string, newRef: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('ref', newRef)
    return u.toString().replace(/%7Bhit%7D/gi, '{hit}')
  } catch {
    const encoded = encodeURIComponent(newRef).replace(/%20/g, '+')
    if (/([?&])ref=/.test(url)) {
      return url.replace(/([?&])ref=[^&]*/, `$1ref=${encoded}`)
    }
    return url
  }
}

function readRef(url: string): string {
  try {
    return new URL(url).searchParams.get('ref') || ''
  } catch {
    return ''
  }
}

let changed = 0
const samples: string[] = []

for (const job of jobs) {
  const seed = String(job.seedKeyword || '')
  const newUrl = String(job.newLandingUrl || '')
  const ref = readRef(newUrl)
  const dirty = seed.includes('0') || ref.includes('0')
  if (!dirty) continue

  const nextSeed = stripZeroFromRefText(seed.includes('0') ? seed : ref)
  job.seedKeyword = nextSeed
  if (newUrl) {
    job.newLandingUrl = updateUrlRef(newUrl, nextSeed)
  }
  job.updatedAt = now
  changed += 1
  samples.push(`${job.funnelName} | ${seed || ref} -> ${nextSeed}`)
}

// 已清理过的融资词也抬 updatedAt，压过浏览器里还带着 0 的旧缓存
for (const job of jobs) {
  const seed = String(job.seedKeyword || '')
  if (
    /^(hyundai financing|cars with apr|cars with finance|cars for sale finance)$/i.test(seed.trim())
  ) {
    job.updatedAt = now
    changed += 1
  }
}

data.updatedAt = now
data.source = `${data.source || 'funnel-offer-drafts'} + force-strip-0-ref@${now}`
data.count = jobs.length
fs.writeFileSync(path, JSON.stringify(data, null, 2))
if (fs.existsSync('public/funnel-offer-drafts.json')) {
  fs.writeFileSync('public/funnel-offer-drafts.json', JSON.stringify(data, null, 2))
}

const left = jobs.filter((job) => {
  const seed = String(job.seedKeyword || '')
  const ref = readRef(String(job.newLandingUrl || ''))
  return seed.includes('0') || ref.includes('0')
}).length

console.log(JSON.stringify({ changed, left, samples }, null, 2))
