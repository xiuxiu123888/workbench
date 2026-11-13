import fs from 'fs'
import { spawn } from 'child_process'

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
const agentBase = String(env.VITE_ARTICLE_AGENT_TARGET || 'https://adesmobi.com').replace(/\/$/, '')
const siteHostIndex = JSON.parse(fs.readFileSync('tmp/site-host-index.json', 'utf8'))
const categoryLookup = JSON.parse(fs.readFileSync('tmp/category-id-lookup.json', 'utf8'))

const funnelId = '3zaxNqwFxfnB'
const funnelName = 'reader-v02'
const offerId = '3zavc4CtoOLC'
const runPath = 'tmp/funnel-3zaxNqwFxfnB-generate-run.json'
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'))
const task = run.tasks.find((t) => t.offerId === offerId)
if (!task) throw new Error('找不到失败 offer')

function platformUserFromToken(jwt) {
  try {
    const payload = jwt.split('.')[1]
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return { userId: String(json.userId ?? '1'), userName: String(json.username || json.sub || 'admin') }
  } catch {
    return { userId: '1', userName: 'admin' }
  }
}

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
    let body
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

function upsertDraft(job) {
  for (const file of ['data/ops-center/funnel-offer-drafts.json', 'public/funnel-offer-drafts.json']) {
    let existing = { jobs: [] }
    try {
      existing = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      existing = { jobs: [] }
    }
    const byKey = new Map((existing.jobs || []).map((j) => [j.key, j]))
    byKey.set(job.key, job)
    const jobs = [...byKey.values()].sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
    )
    fs.writeFileSync(
      file,
      JSON.stringify(
        { updatedAt: new Date().toISOString(), source: 'retry-reader-v02-one', count: jobs.length, jobs },
        null,
        2,
      ),
    )
  }
}

const user = platformUserFromToken(token)
const host = task.host
const channelId = task.channelId
const oldLandingUrl = task.oldLandingUrl
let seed = task.seed
const languageId = task.languageId || 1

console.log('check original job', task.taskId)
let detailJob = await getJob(task.taskId)
console.log('original status', detailJob.status)
let taskId = task.taskId
let result = pickSuccess(detailJob.results, host)

if (!result || String(detailJob.status) === 'failed' || String(detailJob.status) === 'running') {
  // 换一个词重试，避开卡住的任务
  const seeds = loadSeeds()
  seed = seeds[Math.floor(Math.random() * seeds.length)]
  const site = siteHostIndex[host]
  if (!site?.siteId || site.accountId == null) throw new Error(`站点未解析: ${host}`)
  const payload = {
    intent_keyword: seed.intentKeyword,
    category_id: Number(seed.categoryId),
    language_id: languageId,
    region_id: seed.regionId || 'US',
    user: { user_id: user.userId, user_name: user.userName },
    targets: [{ domain: host, site_id: site.siteId, account_id: site.accountId }],
    mode: 'auto',
    callback_url: null,
    options: { out_show: false, generate_author: true, publish: false, articles_per_domain: 1 },
  }
  const idempotencyKey = `funnel-${funnelId}-${offerId}-retry-${Date.now()}`
  console.log('create retry on', host, '·', seed.keyword)
  const created = await createJob(payload, idempotencyKey)
  taskId = String(created.task_id || '').trim()
  if (!taskId) throw new Error('未返回 task_id')
  detailJob = created
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
  result = pickSuccess(detailJob.results, host)
}

if (!result) throw new Error('无成功草稿子项')
let newArticleId =
  result.article_id != null && String(result.article_id).trim() !== '' ? String(result.article_id).trim() : null
if (!newArticleId) {
  console.log('publish item', result.id)
  const published = await publishItem(taskId, result.id)
  const hit =
    (published.results || []).find((r) => String(r.id) === String(result.id)) ||
    (published.results || []).find((r) => r.article_id != null) ||
    result
  newArticleId =
    hit.article_id != null && String(hit.article_id).trim() !== '' ? String(hit.article_id).trim() : null
}
if (!newArticleId) throw new Error('publish 后无 article_id')

const newLandingUrl = buildOfferLandingUrl(oldLandingUrl, channelId, newArticleId, seed.keyword)
const now = new Date().toISOString()
Object.assign(task, {
  status: 'published',
  seed,
  taskId,
  itemId: result.id,
  newArticleId,
  newLandingUrl,
  note: `已发布 article_id=${newArticleId}（单条重试）`,
})
delete task.error
run.summary.success = run.tasks.filter((t) => t.status === 'published').length
run.summary.failed = run.tasks.filter((t) => t.status === 'failed').length
run.retriedAt = now
fs.writeFileSync(runPath, JSON.stringify(run, null, 2))
upsertDraft({
  key: `${funnelId}:${offerId}`,
  funnelId,
  funnelName,
  offerId,
  offerName: task.offerName,
  groupId: task.groupId,
  groupName: task.groupName,
  oldLandingUrl,
  channelId,
  categoryName: seed.domainCategory || null,
  seedKeyword: seed.keyword,
  taskId,
  itemId: result.id,
  articleId: newArticleId,
  status: 'ready',
  note: `已发布 article_id=${newArticleId}（单条重试）`,
  updatedAt: now,
  newLandingUrl,
})
console.log(JSON.stringify({ offerName: task.offerName, articleId: newArticleId, summary: run.summary }, null, 2))

console.log('==== moboreels-v02 ====')
await new Promise((resolve, reject) => {
  const child = spawn('node', ['tmp/run-funnel-generate.mjs', '3zb2pKLqQr7e'], {
    stdio: 'inherit',
    shell: true,
  })
  child.on('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`moboreels-v02 exit ${code}`))
  })
})
console.log('SESSION_TWO_COMPLETE exit=0')
