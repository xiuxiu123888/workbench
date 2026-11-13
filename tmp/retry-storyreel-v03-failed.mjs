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

const token = env.VITE_ARTICLE_TOKEN
const misToken = env.VITE_MIS_TOKEN
const misClientId = env.VITE_MIS_CLIENT_ID
const misBase = String(env.VITE_MIS_API_TARGET || 'https://surging-system.top/prod-api').replace(/\/$/, '')
const agentBase = String(env.VITE_ARTICLE_AGENT_TARGET || 'https://adesmobi.com').replace(/\/$/, '')

const funnelId = '3wxMhS6zF2m4'
const funnelName = 'storyreel-v03'
const offerId = '3wxLRGTJ2I7S'
const runPath = 'tmp/funnel-3wxMhS6zF2m4-generate-run.json'
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'))
const failed = run.tasks.find((t) => t.offerId === offerId)
if (!failed) throw new Error('run 里找不到失败 offer')

function platformUserFromToken(jwt) {
  try {
    const payload = jwt.split('.')[1]
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return { userId: String(json.userId ?? '1'), userName: String(json.username || json.sub || 'admin') }
  } catch {
    return { userId: '1', userName: 'admin' }
  }
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

async function publishItem(taskId, itemId) {
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
  const body = await res.json()
  if (!res.ok) throw new Error(`publish ${taskId}/${itemId} ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return body
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
    const payload = {
      updatedAt: new Date().toISOString(),
      source: 'retry-storyreel-v03-failed',
      count: jobs.length,
      jobs,
    }
    fs.writeFileSync(file, JSON.stringify(payload, null, 2))
  }
}

const user = platformUserFromToken(token)
const host = failed.host
const seed = failed.seed
const channelId = failed.channelId
const oldLandingUrl = failed.oldLandingUrl
const languageId = failed.languageId || 1

console.log('check original job', failed.taskId)
let detailJob = null
try {
  detailJob = await getJob(failed.taskId)
  console.log('original status', detailJob.status, detailJob.error_message || '')
} catch (error) {
  console.log('original getJob failed', error instanceof Error ? error.message : error)
}

let taskId = failed.taskId
let result = detailJob ? pickSuccess(detailJob.results, host) : null

if (!result || String(detailJob?.status) === 'failed') {
  const payload = {
    intent_keyword: seed.intentKeyword,
    category_id: Number(seed.categoryId),
    language_id: languageId,
    region_id: seed.regionId || 'US',
    user: { user_id: user.userId, user_name: user.userName },
    targets: [{ domain: host, site_id: failed.siteId, account_id: failed.accountId }],
    mode: 'auto',
    callback_url: null,
    options: {
      out_show: false,
      generate_author: true,
      publish: false,
      articles_per_domain: 1,
    },
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

failed.status = 'published'
failed.taskId = taskId
failed.itemId = result.id
failed.newArticleId = newArticleId
failed.newLandingUrl = newLandingUrl
failed.note = `已发布 article_id=${newArticleId}（重试）`
delete failed.error
run.summary.success = (run.tasks || []).filter((t) => t.status === 'published').length
run.summary.failed = (run.tasks || []).filter((t) => t.status === 'failed').length
run.retriedAt = now
fs.writeFileSync(runPath, JSON.stringify(run, null, 2))

const draft = {
  key: `${funnelId}:${offerId}`,
  funnelId,
  funnelName,
  offerId,
  offerName: failed.offerName,
  groupId: failed.groupId,
  groupName: failed.groupName,
  oldLandingUrl,
  channelId,
  categoryName: seed.domainCategory || null,
  seedKeyword: seed.keyword,
  taskId,
  itemId: result.id,
  articleId: newArticleId,
  status: 'ready',
  note: `已发布 article_id=${newArticleId}（重试）`,
  updatedAt: now,
  newLandingUrl,
}
upsertDraft(draft)

console.log(
  JSON.stringify(
    {
      offerName: failed.offerName,
      taskId,
      articleId: newArticleId,
      newLandingUrl,
      storyreelDrafts: JSON.parse(fs.readFileSync('data/ops-center/funnel-offer-drafts.json', 'utf8')).jobs.filter(
        (j) => j.funnelId === funnelId,
      ).length,
    },
    null,
    2,
  ),
)
