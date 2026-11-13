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
const agentBase = String(env.VITE_ARTICLE_AGENT_TARGET || 'https://adesmobi.com').replace(/\/$/, '')

const targets = [
  'tmp/funnel-3w0aPitAgGtJ-generate-run.json',
  'tmp/funnel-3p89AEQQqtiQ-generate-run.json',
]

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
  if (channel && !u.searchParams.get('channel')) u.searchParams.set('channel', channel)
  const ref = String(seedKeyword || '').trim()
  if (ref) u.searchParams.set('ref', ref)
  return preserveHitPlaceholder(u.toString())
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
        {
          updatedAt: new Date().toISOString(),
          source: 'retry-publish-502',
          count: jobs.length,
          jobs,
        },
        null,
        2,
      ),
    )
  }
}

const results = []
for (const file of targets) {
  if (!fs.existsSync(file)) continue
  const run = JSON.parse(fs.readFileSync(file, 'utf8'))
  const funnelId = run.funnel.funnelId
  const funnelName = run.funnel.funnelName
  for (const task of run.tasks || []) {
    if (task.status !== 'failed' || !/502/.test(String(task.error || ''))) continue
    const taskId = String(task.taskId || '').trim()
    if (!taskId) continue
    const m = String(task.error || '').match(/\/(\d+)\s+502/)
    let itemId = m?.[1] || task.itemId
    console.log(`retry ${funnelName} ${task.offerName} ${taskId}`)
    const detail = await getJob(taskId)
    if (!itemId) {
      const hit = (detail.results || []).find((r) => String(r.status || '').toLowerCase() === 'success')
      itemId = hit?.id
    }
    if (!itemId) throw new Error(`无 itemId: ${task.offerName}`)

    // 若已有 article_id，直接用，不必再 publish
    const existing =
      (detail.results || []).find((r) => String(r.id) === String(itemId)) ||
      (detail.results || []).find((r) => r.article_id != null)
    let newArticleId =
      existing?.article_id != null && String(existing.article_id).trim() !== ''
        ? String(existing.article_id).trim()
        : null

    if (!newArticleId) {
      const published = await publishItem(taskId, itemId)
      const hit =
        (published.results || []).find((r) => String(r.id) === String(itemId)) ||
        (published.results || []).find((r) => r.article_id != null) ||
        existing
      newArticleId =
        hit?.article_id != null && String(hit.article_id).trim() !== '' ? String(hit.article_id).trim() : null
    }
    if (!newArticleId) throw new Error(`仍无 article_id: ${task.offerName}`)

    const newLandingUrl = buildOfferLandingUrl(
      task.oldLandingUrl,
      task.channelId,
      newArticleId,
      task.seed?.keyword,
    )
    const now = new Date().toISOString()
    Object.assign(task, {
      status: 'published',
      itemId,
      newArticleId,
      newLandingUrl,
      note: `已发布 article_id=${newArticleId}（502 补发）`,
    })
    delete task.error
    run.summary.success = run.tasks.filter((t) => t.status === 'published').length
    run.summary.failed = run.tasks.filter((t) => t.status === 'failed').length
    run.retriedAt = now
    fs.writeFileSync(file, JSON.stringify(run, null, 2))

    upsertDraft({
      key: `${funnelId}:${task.offerId}`,
      funnelId,
      funnelName,
      offerId: task.offerId,
      offerName: task.offerName,
      groupId: task.groupId,
      groupName: task.groupName,
      oldLandingUrl: task.oldLandingUrl || null,
      channelId: task.channelId || null,
      categoryName: task.seed?.domainCategory || null,
      seedKeyword: task.seed?.keyword || '',
      taskId,
      itemId,
      articleId: newArticleId,
      status: 'ready',
      note: `已发布 article_id=${newArticleId}（502 补发）`,
      updatedAt: now,
      newLandingUrl,
    })

    results.push({ funnelName, offerName: task.offerName, articleId: newArticleId, newLandingUrl })
    console.log('  ok', newArticleId)
  }
}

console.log(JSON.stringify({ fixed: results.length, results }, null, 2))
