import fs from 'fs'
import path from 'path'

const funnelIdArg = process.argv[2] || ''
if (!funnelIdArg) {
  console.error('用法: node tmp/resume-funnel-generate.mjs <funnelId>')
  process.exit(1)
}

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

const token = env.VITE_ARTICLE_TOKEN
const misToken = env.VITE_MIS_TOKEN
const misClientId = env.VITE_MIS_CLIENT_ID
const misBase = String(env.VITE_MIS_API_TARGET || 'https://surging-system.top/prod-api').replace(/\/$/, '')
const articleBase = 'https://adesmobi.com/admin/back'
const agentBase = String(env.VITE_ARTICLE_AGENT_TARGET || 'https://adesmobi.com').replace(/\/$/, '')
const siteHostIndex = JSON.parse(fs.readFileSync('tmp/site-host-index.json', 'utf8'))
const categoryLookup = JSON.parse(fs.readFileSync('tmp/category-id-lookup.json', 'utf8'))

function platformUserFromToken(jwt) {
  try {
    const payload = jwt.split('.')[1]
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return { userId: String(json.userId ?? '1'), userName: String(json.username || json.sub || 'admin') }
  } catch {
    return { userId: '1', userName: 'admin' }
  }
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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
      const is = body.match(/<is><t[^>]*>([\s\S]*?)<\/t><\/is>/)
      const v = body.match(/<v>([\s\S]*?)<\/v>/)
      let value = null
      if (is) value = decode(is[1])
      else if (v) value = decode(v[1])
      cells[col] = value
    }
    rows.push(cells)
  }
  return rows
}

function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function articleIdFromUrl(url) {
  const m = String(url || '').match(/\/detail\/(\d+)/)
  return m?.[1] || ''
}

function preserveHitPlaceholder(url) {
  return String(url || '').replace(/([?&])hit=%7Bhit%7D/gi, '$1hit={hit}')
}

function buildOfferLandingUrl(oldLandingUrl, channelId, newArticleId, seedKeyword) {
  const u = new URL(oldLandingUrl)
  const articleId = String(newArticleId)
  const channel = String(channelId)
  u.pathname = u.pathname.replace(/\/detail\/\d+/, `/detail/${articleId}`)
  u.searchParams.set('subid1', channel)
  u.searchParams.set('subid2', articleId)
  const ref = String(seedKeyword || '').trim()
  if (ref) u.searchParams.set('ref', ref)
  return preserveHitPlaceholder(u.toString())
}

function isTerminal(status) {
  return ['success', 'partial_success', 'failed'].includes(String(status || ''))
}

function bareDomain(input) {
  try {
    const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`
    return new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return String(input || '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./i, '')
      .toLowerCase()
  }
}

function pickSuccess(results, domain) {
  const want = bareDomain(domain)
  for (const item of results || []) {
    if (String(item.status || '').toLowerCase() !== 'success') continue
    if (item.id == null || String(item.id).trim() === '') continue
    if (want && item.domain && bareDomain(item.domain) && bareDomain(item.domain) !== want) continue
    return item
  }
  return null
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

async function articleGet(pathName) {
  const res = await fetch(`${articleBase}${pathName}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const body = await res.json()
  if (!res.ok || (body.code != null && Number(body.code) !== 200)) {
    throw new Error(`article ${pathName} failed`)
  }
  return body.data
}

async function articleDetail(id) {
  const res = await fetch(`${articleBase}/article/detail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id }),
  })
  const body = await res.json()
  if (!res.ok || (body.code != null && Number(body.code) !== 200)) {
    throw new Error(`article detail ${id} failed`)
  }
  return body.data || {}
}

async function createJob(payload, idempotencyKey) {
  const res = await fetch(`${agentBase}/api/v1/admin/article-jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Platform-Token': token,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`create ${res.status}: ${JSON.stringify(body).slice(0, 400)}`)
  return body
}

async function getJob(taskId) {
  const res = await fetch(`${agentBase}/api/v1/admin/article-jobs/${encodeURIComponent(taskId)}`, {
    headers: { 'X-Platform-Token': token, Accept: 'application/json' },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`getJob ${taskId} ${res.status}`)
  return body
}

async function publishItem(taskId, itemId, attempts = 5) {
  let lastErr = null
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(
      `${agentBase}/api/v1/admin/article-jobs/${encodeURIComponent(taskId)}/items/${encodeURIComponent(String(itemId))}/publish`,
      {
        method: 'POST',
        headers: {
          'X-Platform-Token': token,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    )
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text.slice(0, 200) }
    }
    if (res.ok) return body
    lastErr = new Error(`publish ${taskId}/${itemId} ${res.status}: ${text.slice(0, 300)}`)
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      console.log(`  publish retry ${i}/${attempts} after ${res.status}`)
      await new Promise((r) => setTimeout(r, 3000 * i))
      continue
    }
    throw lastErr
  }
  throw lastErr
}

function loadSeeds() {
  const sheetRows = parseSheet('tmp/xlsx-extract/xl/worksheets/sheet1.xml')
  const seeds = []
  for (const r of sheetRows.slice(1)) {
    const keyword = String(r.B || '').trim()
    const domainCategory = String(r.D || '').trim()
    if (!keyword || !domainCategory || keyword.startsWith('▶')) continue
    const categoryId = categoryLookup[domainCategory]
    if (!categoryId) continue
    seeds.push({
      keyword,
      intentKeyword: keyword,
      ref: keyword,
      domainCategory,
      categoryId,
      regionId: String(r.C || '').trim() === 'VN' ? 'VI' : String(r.C || 'US').trim() || 'US',
    })
  }
  return seeds
}

function loadFunnelOffers(funnelId) {
  const rawDir = 'data/ops-center/raw'
  const files = fs.readdirSync(rawDir).filter((f) => f.startsWith('group-'))
  const groups = []
  let funnelName = ''
  for (const f of files) {
    const g = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8')).data || {}
    if (String(g.funnelId) !== String(funnelId)) continue
    funnelName = g.funnelName || funnelName
    for (const o of g.offerList || []) {
      groups.push({
        funnelId: g.funnelId,
        funnelName: g.funnelName,
        groupId: g.groupId,
        groupName: g.groupName,
        geo: g.geo || null,
        offerId: o.offerId,
        offerName: o.offerName,
        channelId: o.channelId || null,
        categoryName: o.categoryName || null,
      })
    }
  }
  if (!groups.length) throw new Error(`漏斗 ${funnelId} 没有 offer`)
  return { funnelId, funnelName: funnelName || funnelId, offers: groups }
}

const seeds = loadSeeds()
const funnel = loadFunnelOffers(funnelIdArg)
// 每次进程启动重新打乱，避免同漏斗反复抽到同一批词
const rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0)
const shuffledSeeds = seeds.slice()
for (let i = shuffledSeeds.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1))
  ;[shuffledSeeds[i], shuffledSeeds[j]] = [shuffledSeeds[j], shuffledSeeds[i]]
}
let seedCursor = 0
const user = platformUserFromToken(token)
const languages = await articleGet('/lang/getAll')
const english = (languages || []).find((item) => String(item.langCode || '').toLowerCase() === 'en')
const fallbackLangId = english ? Number(english.id) : Number(languages?.[0]?.id)
if (!Number.isFinite(fallbackLangId) || fallbackLangId <= 0) throw new Error('无法解析 language_id')

const stamp = Date.now()
const outPath = `tmp/funnel-${funnel.funnelId}-generate-run.json`
let run = {
  title: `${funnel.funnelName} 产文`,
  startedAt: new Date().toISOString(),
  funnel: { funnelId: funnel.funnelId, funnelName: funnel.funnelName },
  sourceOfTruth: 'landpulse/offer/getById',
  seedPoolCount: seeds.length,
  tasks: [],
  summary: { total: funnel.offers.length, success: 0, failed: 0 },
}
if (fs.existsSync(outPath)) {
  run = JSON.parse(fs.readFileSync(outPath, 'utf8'))
  run.seedPoolCount = seeds.length
  run.resumedAt = new Date().toISOString()
  delete run.finishedAt
}

const doneIds = new Set(
  (run.tasks || [])
    .filter((t) => t.status === 'published')
    .map((t) => String(t.offerId)),
)
const pendingOffers = funnel.offers.filter((o) => !doneIds.has(String(o.offerId)))
run.summary.total = funnel.offers.length
run.summary.success = (run.tasks || []).filter((t) => t.status === 'published').length
run.summary.failed = (run.tasks || []).filter((t) => t.status === 'failed').length
console.log(
  `resume ${funnel.funnelName}: done=${doneIds.size} pending=${pendingOffers.length} total=${funnel.offers.length}`,
)
if (!pendingOffers.length) {
  run.finishedAt = new Date().toISOString()
  fs.writeFileSync(outPath, JSON.stringify(run, null, 2))
  console.log(JSON.stringify({ wrote: outPath, funnel: run.funnel, summary: run.summary, note: 'nothing to resume' }, null, 2))
  process.exit(0)
}

const usedKeywords = new Set()
for (const [index, offer] of pendingOffers.entries()) {
  const task = {
    taskIndex: (run.tasks?.length || 0) + 1,
    offerId: offer.offerId,
    offerName: offer.offerName,
    groupId: offer.groupId,
    groupName: offer.groupName,
    geo: offer.geo,
    channelId: offer.channelId,
    status: 'pending',
  }
  try {
    console.log(`[${index + 1}/${pendingOffers.length}] getById ${offer.offerName}`)
    const detail = await getOfferById(offer.offerId)
    const oldLandingUrl = String(detail.resultUrl || detail.url || '').trim()
    if (!oldLandingUrl) throw new Error('getById 无 resultUrl/url')
    const host = hostFromUrl(oldLandingUrl)
    const site = siteHostIndex[host]
    if (!site?.siteId || site.accountId == null) throw new Error(`站点未解析: ${host}`)
    const channelId = String(offer.channelId || new URL(oldLandingUrl).searchParams.get('channel') || '').trim()
    if (!channelId) throw new Error('无 channelId')

    let seed = null
    if (seedCursor < shuffledSeeds.length) {
      seed = shuffledSeeds[seedCursor++]
      usedKeywords.add(seed.keyword)
    } else {
      // 词池用尽后允许复用，但仍按本轮打乱顺序轮转
      seed = shuffledSeeds[seedCursor % shuffledSeeds.length]
      seedCursor += 1
      usedKeywords.add(seed.keyword)
    }

    let languageId = fallbackLangId
    const oldArticleId = articleIdFromUrl(oldLandingUrl) || String(detail.articleId || '').trim()
    if (oldArticleId) {
      try {
        const article = await articleDetail(oldArticleId)
        const langId = Number(article.langId)
        if (Number.isFinite(langId) && langId > 0) languageId = langId
      } catch {
        /* keep */
      }
    }

    Object.assign(task, {
      oldLandingUrl,
      oldArticleId: articleIdFromUrl(oldLandingUrl),
      host,
      siteId: site.siteId,
      accountId: site.accountId,
      siteName: site.siteName,
      channelId,
      seed,
      languageId,
    })

    const payload = {
      intent_keyword: seed.intentKeyword,
      category_id: Number(seed.categoryId),
      language_id: languageId,
      region_id: seed.regionId || 'US',
      user: { user_id: user.userId, user_name: user.userName },
      targets: [{ domain: host, site_id: site.siteId, account_id: site.accountId }],
      mode: 'auto',
      callback_url: null,
      options: {
        out_show: false,
        generate_author: true,
        publish: false,
        articles_per_domain: 1,
      },
    }
    const idempotencyKey = `funnel-${funnel.funnelId}-${offer.offerId}-${stamp}`
    console.log(`[${index + 1}/${pendingOffers.length}] create on ${host} · ${seed.keyword}`)
    const created = await createJob(payload, idempotencyKey)
    const taskId = String(created.task_id || '').trim()
    if (!taskId) throw new Error('未返回 task_id')
    task.taskId = taskId

    let detailJob = created
    for (let round = 0; round < 90; round++) {
      detailJob = await getJob(taskId)
      if (isTerminal(detailJob.status)) break
      const p = detailJob.progress
      console.log(`  poll ${round + 1}: ${detailJob.status} ${p ? `${p.success}/${p.total}` : ''}`)
      await new Promise((r) => setTimeout(r, 8000))
    }
    if (!isTerminal(detailJob.status) || String(detailJob.status) === 'failed') {
      throw new Error(detailJob.error_message || `任务未成功: ${detailJob.status}`)
    }
    const result = pickSuccess(detailJob.results, host)
    if (!result) throw new Error('无成功草稿子项')
    console.log(`[${index + 1}/${pendingOffers.length}] publish item ${result.id}`)
    const published = await publishItem(taskId, result.id)
    const hit =
      (published.results || []).find((r) => String(r.id) === String(result.id)) ||
      (published.results || []).find((r) => r.article_id != null) ||
      result
    const newArticleId =
      hit.article_id != null && String(hit.article_id).trim() !== '' ? String(hit.article_id).trim() : null
    if (!newArticleId) throw new Error('publish 后无 article_id')

    task.itemId = result.id
    task.newArticleId = newArticleId
    task.newLandingUrl = buildOfferLandingUrl(oldLandingUrl, channelId, newArticleId, seed.keyword)
    task.status = 'published'
    task.note = `已发布 article_id=${newArticleId}`
    run.summary.success += 1
    console.log(`[${index + 1}/${pendingOffers.length}] ok ${host} → ${newArticleId}`)
  } catch (error) {
    task.status = 'failed'
    task.error = error instanceof Error ? error.message : String(error)
    run.summary.failed += 1
    console.error(`[${index + 1}/${pendingOffers.length}] fail`, task.error)
  }
  run.tasks.push(task)
  fs.writeFileSync(outPath, JSON.stringify(run, null, 2))
}

run.finishedAt = new Date().toISOString()
fs.writeFileSync(outPath, JSON.stringify(run, null, 2))

let existing = { jobs: [] }
try {
  existing = JSON.parse(fs.readFileSync('data/ops-center/funnel-offer-drafts.json', 'utf8'))
} catch {
  existing = { jobs: [] }
}
const byKey = new Map((existing.jobs || []).map((j) => [j.key, j]))
for (const t of run.tasks) {
  if (t.status !== 'published' || !t.newLandingUrl) continue
  const key = `${funnel.funnelId}:${t.offerId}`
  byKey.set(key, {
    key,
    funnelId: funnel.funnelId,
    funnelName: funnel.funnelName,
    offerId: t.offerId,
    offerName: t.offerName,
    groupId: t.groupId,
    groupName: t.groupName,
    oldLandingUrl: t.oldLandingUrl || null,
    channelId: t.channelId || null,
    categoryName: t.seed?.domainCategory || null,
    seedKeyword: t.seed?.keyword || '',
    taskId: t.taskId,
    itemId: t.itemId,
    articleId: t.newArticleId,
    status: 'ready',
    note: t.note || '',
    updatedAt: new Date().toISOString(),
    newLandingUrl: t.newLandingUrl,
  })
}
const payload = {
  updatedAt: new Date().toISOString(),
  source: 'funnel-generate-runs',
  count: byKey.size,
  jobs: [...byKey.values()],
}
fs.writeFileSync('data/ops-center/funnel-offer-drafts.json', JSON.stringify(payload, null, 2))
fs.writeFileSync('public/funnel-offer-drafts.json', JSON.stringify(payload, null, 2))

console.log(
  JSON.stringify(
    {
      wrote: outPath,
      funnel: run.funnel,
      summary: run.summary,
      failed: run.tasks.filter((t) => t.status === 'failed').map((t) => ({ offerName: t.offerName, error: t.error })),
    },
    null,
    2,
  ),
)
