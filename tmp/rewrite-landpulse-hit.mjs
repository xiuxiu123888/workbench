import fs from 'fs'

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    }),
)

const misToken = env.VITE_MIS_TOKEN
const misClientId = env.VITE_MIS_CLIENT_ID
const misBase = String(env.VITE_MIS_API_TARGET || 'https://surging-system.top/prod-api').replace(/\/$/, '')

function preserveHitPlaceholder(url) {
  return String(url || '').replace(/([?&])hit=%7Bhit%7D/gi, '$1hit={hit}')
}

async function getOfferById(offerId) {
  const res = await fetch(`${misBase}/landpulse/offer/getById?offerId=${encodeURIComponent(offerId)}`, {
    headers: {
      Authorization: `Bearer ${misToken}`,
      ClientID: misClientId,
      Accept: 'application/json',
    },
  })
  const body = await res.json()
  if (!res.ok || body.code !== 200) {
    throw new Error(`getById ${offerId} failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
  }
  return body.data
}

async function updateOffer(payload) {
  const res = await fetch(`${misBase}/landpulse/offer/update`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${misToken}`,
      ClientID: misClientId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const body = await res.json()
  if (!res.ok || body.code !== 200) {
    throw new Error(`update ${payload.offerId} failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
  }
  return body
}

const logPath = 'data/ops-center/offer-replace-log.json'
const draftsPath = 'data/ops-center/funnel-offer-drafts.json'
const publicDraftsPath = 'public/funnel-offer-drafts.json'

const log = JSON.parse(fs.readFileSync(logPath, 'utf8'))
const drafts = JSON.parse(fs.readFileSync(draftsPath, 'utf8'))
const byOffer = new Map((drafts.jobs || []).map((j) => [j.offerId, j]))

const targets = (log.records || []).filter((r) => r.ok && r.offerId && r.resultUrl)
console.log(`check landpulse resultUrl hit placeholder: ${targets.length}`)

const results = []
let updated = 0
let alreadyOk = 0
for (let i = 0; i < targets.length; i += 1) {
  const row = targets[i]
  const draft = byOffer.get(row.offerId)
  const preferred = preserveHitPlaceholder(String(draft?.newLandingUrl || row.resultUrl || ''))
  try {
    const detail = await getOfferById(row.offerId)
    const remoteResult = String(detail.resultUrl || '')
    if (!/hit=%7Bhit%7D/i.test(remoteResult)) {
      alreadyOk += 1
      row.resultUrl = preserveHitPlaceholder(remoteResult || preferred)
      results.push({ offerId: row.offerId, offerName: row.offerName, ok: true, skipped: true })
      if ((i + 1) % 50 === 0) console.log(`[${i + 1}/${targets.length}] checked… updated=${updated} ok=${alreadyOk}`)
      continue
    }
    const fixedResultUrl = preferred.includes('hit={hit}') ? preferred : preserveHitPlaceholder(remoteResult)
    await updateOffer({
      offerId: detail.offerId || row.offerId,
      offerCategoryId: detail.offerCategoryId ?? null,
      offerName: String(detail.offerName || '').trim() || row.offerId,
      url: detail.url ?? null,
      offerSourceId: detail.offerSourceId ?? null,
      campaignId: detail.campaignId ?? null,
      resultUrl: fixedResultUrl,
    })
    row.resultUrl = fixedResultUrl
    if (draft) {
      draft.newLandingUrl = fixedResultUrl
      draft.updatedAt = new Date().toISOString()
    }
    updated += 1
    results.push({ offerId: row.offerId, offerName: row.offerName, ok: true, resultUrl: fixedResultUrl })
    console.log(`[${i + 1}/${targets.length}] updated ${row.offerName}`)
  } catch (error) {
    results.push({
      offerId: row.offerId,
      offerName: row.offerName,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    console.error(`[${i + 1}/${targets.length}] fail ${row.offerName}`, error instanceof Error ? error.message : error)
  }
  if ((i + 1) % 20 === 0) {
    log.updatedAt = new Date().toISOString()
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2))
    drafts.updatedAt = new Date().toISOString()
    fs.writeFileSync(draftsPath, JSON.stringify(drafts, null, 2))
    fs.writeFileSync(publicDraftsPath, JSON.stringify(drafts, null, 2))
  }
}

log.updatedAt = new Date().toISOString()
fs.writeFileSync(logPath, JSON.stringify(log, null, 2))
drafts.updatedAt = new Date().toISOString()
fs.writeFileSync(draftsPath, JSON.stringify(drafts, null, 2))
fs.writeFileSync(publicDraftsPath, JSON.stringify(drafts, null, 2))

const outPath = `tmp/rewrite-landpulse-hit-${Date.now()}.json`
const failed = results.filter((r) => !r.ok)
fs.writeFileSync(
  outPath,
  JSON.stringify({ total: targets.length, updated, alreadyOk, failed: failed.length, results }, null, 2),
)
console.log(JSON.stringify({ outPath, updated, alreadyOk, failed: failed.length }, null, 2))
