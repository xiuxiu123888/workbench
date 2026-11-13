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
const articleBase = 'https://adesmobi.com/admin/back'
const agentBase = String(env.VITE_ARTICLE_AGENT_TARGET || 'https://adesmobi.com').replace(/\/$/, '')
const siteHostIndex = JSON.parse(fs.readFileSync('tmp/site-host-index.json', 'utf8'))

function platformUserFromToken(jwt) {
  try {
    const payload = jwt.split('.')[1]
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return { userId: String(json.userId ?? '1'), userName: String(json.username || json.sub || 'admin') }
  } catch {
    return { userId: '1', userName: 'admin' }
  }
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

async function articleGet(path) {
  const res = await fetch(`${articleBase}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const body = await res.json()
  if (!res.ok || (body.code != null && Number(body.code) !== 200)) {
    throw new Error(`article ${path} failed`)
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

const runPath = 'tmp/first-funnel-generate-run.json'
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'))
const wrongIds = new Set((run.urlMismatches || []).filter((m) => m.publishedOnWrongSite).map((m) => m.offerId))
const targets = run.tasks.filter((t) => wrongIds.has(t.offerId))
if (targets.length === 0) throw new Error('没有需要重跑的错站 offer')

const user = platformUserFromToken(token)
const languages = await articleGet('/lang/getAll')
const english = (languages || []).find((item) => String(item.langCode || '').toLowerCase() === 'en')
const fallbackLangId = english ? Number(english.id) : Number(languages?.[0]?.id)
const stamp = Date.now()

const regen = {
  startedAt: new Date().toISOString(),
  reason: 'wrong_site_from_channel_match',
  count: targets.length,
  items: [],
}

for (const [index, oldTask] of targets.entries()) {
  const item = {
    offerId: oldTask.offerId,
    offerName: oldTask.offerName,
    previousTaskId: oldTask.taskId,
    previousArticleId: oldTask.newArticleId || null,
    previousHost: oldTask.host || null,
  }
  try {
    console.log(`[${index + 1}/${targets.length}] getById ${oldTask.offerName}`)
    const detail = await getOfferById(oldTask.offerId)
    const oldLandingUrl = String(detail.resultUrl || detail.url || '').trim()
    if (!oldLandingUrl) throw new Error('getById 无 resultUrl/url')
    const host = hostFromUrl(oldLandingUrl)
    const site = siteHostIndex[host]
    if (!site?.siteId || site.accountId == null) throw new Error(`站点未解析: ${host}`)
    const channelId = String(oldTask.channelId || new URL(oldLandingUrl).searchParams.get('channel') || '').trim()
    if (!channelId) throw new Error('无 channelId')

    let languageId = fallbackLangId
    const oldArticleId = articleIdFromUrl(oldLandingUrl) || String(detail.articleId || '').trim()
    if (oldArticleId) {
      try {
        const article = await articleDetail(oldArticleId)
        const langId = Number(article.langId)
        if (Number.isFinite(langId) && langId > 0) languageId = langId
      } catch {
        /* keep fallback */
      }
    }

    const seed = oldTask.seed
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
    const idempotencyKey = `funnel1-regen-${oldTask.offerId}-${stamp}`
    console.log(`[${index + 1}/${targets.length}] create on ${host} · ${seed.keyword}`)
    const created = await createJob(payload, idempotencyKey)
    const taskId = String(created.task_id || '').trim()
    if (!taskId) throw new Error('未返回 task_id')

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
    console.log(`[${index + 1}/${targets.length}] publish item ${result.id}`)
    const published = await publishItem(taskId, result.id)
    const hit =
      (published.results || []).find((r) => String(r.id) === String(result.id)) ||
      (published.results || []).find((r) => r.article_id != null) ||
      result
    const newArticleId =
      hit.article_id != null && String(hit.article_id).trim() !== ''
        ? String(hit.article_id).trim()
        : null
    if (!newArticleId) throw new Error('publish 后无 article_id')

    const newLandingUrl = buildOfferLandingUrl(oldLandingUrl, channelId, newArticleId, seed.keyword)
    const patch = {
      oldLandingUrl,
      oldArticleId: articleIdFromUrl(oldLandingUrl),
      host,
      siteId: site.siteId,
      accountId: site.accountId,
      siteName: site.siteName,
      siteResolved: true,
      taskId,
      itemId: result.id,
      newArticleId,
      newLandingUrl,
      status: 'published',
      publishStatus: 'success',
      note: `已按 getById 纠正域名重产 article_id=${newArticleId}`,
      regeneratedAt: new Date().toISOString(),
      previousWrongHost: item.previousHost,
      previousWrongArticleId: item.previousArticleId,
    }
    const idx = run.tasks.findIndex((t) => t.offerId === oldTask.offerId)
    run.tasks[idx] = { ...run.tasks[idx], ...patch }
    item.status = 'success'
    item.taskId = taskId
    item.newArticleId = newArticleId
    item.host = host
    item.newLandingUrl = newLandingUrl
    console.log(`[${index + 1}/${targets.length}] ok ${host} → ${newArticleId}`)
  } catch (error) {
    item.status = 'failed'
    item.error = error instanceof Error ? error.message : String(error)
    console.error(`[${index + 1}/${targets.length}] fail`, item.error)
  }
  regen.items.push(item)
  fs.writeFileSync(runPath, JSON.stringify(run, null, 2))
}

run.regenWrongSite = regen
run.regenWrongSiteFinishedAt = new Date().toISOString()
fs.writeFileSync(runPath, JSON.stringify(run, null, 2))

const funnelId = run.funnel.funnelId
const jobs = run.tasks
  .filter((t) => t.taskId && t.itemId != null)
  .map((t) => ({
    key: `${funnelId}:${t.offerId}`,
    funnelId,
    funnelName: run.funnel.funnelName,
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
    articleId: t.newArticleId || undefined,
    status: 'ready',
    note: t.note || '',
    updatedAt: new Date().toISOString(),
    newLandingUrl: t.newLandingUrl || null,
  }))
const payload = {
  updatedAt: new Date().toISOString(),
  source: 'tmp/first-funnel-generate-run.json',
  count: jobs.length,
  jobs,
}
fs.writeFileSync('data/ops-center/funnel-offer-drafts.json', JSON.stringify(payload, null, 2))
fs.writeFileSync('public/funnel-offer-drafts.json', JSON.stringify(payload, null, 2))
fs.writeFileSync('tmp/first-funnel-regen-wrong-site.json', JSON.stringify(regen, null, 2))

console.log(
  JSON.stringify(
    {
      success: regen.items.filter((i) => i.status === 'success').length,
      failed: regen.items.filter((i) => i.status === 'failed').length,
      items: regen.items,
    },
    null,
    2,
  ),
)
