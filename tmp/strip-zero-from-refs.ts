import fs from 'node:fs'

const path = 'data/ops-center/funnel-offer-drafts.json'
const data = JSON.parse(fs.readFileSync(path, 'utf8')) as {
  updatedAt?: string
  source?: string
  count?: number
  jobs?: Array<Record<string, unknown>>
}
const jobs = Array.isArray(data.jobs) ? data.jobs : []

function stripZeroFromRefText(text: string): string {
  return text
    .replace(/0%/gi, '')
    .replace(/0/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s+%|%\s+$/g, '%')
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
    return `${url}${url.includes('?') ? '&' : '?'}ref=${encoded}`
  }
}

let changed = 0
const samples: Array<Record<string, string>> = []

for (const job of jobs) {
  const seed = String(job.seedKeyword || '')
  const newUrl = String(job.newLandingUrl || '')
  let touched = false
  let beforeRef = ''

  if (seed.includes('0')) {
    const next = stripZeroFromRefText(seed)
    if (next && next !== seed) {
      job.seedKeyword = next
      touched = true
    }
  }

  if (newUrl.includes('ref=')) {
    try {
      const u = new URL(newUrl)
      const ref = u.searchParams.get('ref') || ''
      beforeRef = ref
      if (ref.includes('0')) {
        const nextRef = stripZeroFromRefText(ref)
        if (nextRef && nextRef !== ref) {
          job.newLandingUrl = updateUrlRef(newUrl, nextRef)
          if (!job.seedKeyword || String(job.seedKeyword).includes('0')) {
            job.seedKeyword = nextRef
          }
          touched = true
        }
      }
    } catch {
      // ignore bad urls
    }
  }

  if (touched) {
    // 抬高 updatedAt，确保刷新合并时磁盘版本压过浏览器 localStorage
    job.updatedAt = new Date().toISOString()
    changed += 1
    if (samples.length < 30) {
      samples.push({
        funnelName: String(job.funnelName || ''),
        offerName: String(job.offerName || ''),
        beforeSeed: seed,
        afterSeed: String(job.seedKeyword || ''),
        beforeRef,
        afterUrl: String(job.newLandingUrl || ''),
      })
    }
  }
}

data.updatedAt = new Date().toISOString()
data.source = `${data.source || 'funnel-offer-drafts'} + strip-0-from-ref`
data.count = jobs.length
fs.writeFileSync(path, JSON.stringify(data, null, 2))

const pub = 'public/funnel-offer-drafts.json'
if (fs.existsSync(pub)) {
  fs.writeFileSync(pub, JSON.stringify(data, null, 2))
}

console.log(JSON.stringify({ changed, sampleCount: samples.length, samples }, null, 2))
