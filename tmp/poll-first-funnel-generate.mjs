import fs from 'fs'

const envText = fs.readFileSync('.env.local', 'utf8')
const env = Object.fromEntries(
  envText
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

function rewriteOfferUrl(oldUrl, channelId, newArticleId) {
  const u = new URL(oldUrl)
  u.pathname = u.pathname.replace(/\/detail\/\d+/, `/detail/${newArticleId}`)
  u.searchParams.set('subid1', String(channelId))
  u.searchParams.set('subid2', String(newArticleId))
  return u.toString()
}

function isTerminal(status) {
  return ['success', 'partial_success', 'failed'].includes(String(status || ''))
}

function bareDomain(input) {
  const text = String(input || '').trim()
  if (!text) return ''
  try {
    const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`
    return new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return text.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase()
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

async function getJob(taskId) {
  const res = await fetch(`${agentBase}/api/v1/admin/article-jobs/${encodeURIComponent(taskId)}`, {
    headers: { 'X-Platform-Token': token, Accept: 'application/json' },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`poll ${taskId} ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return body
}

const runPath = 'tmp/first-funnel-generate-run.json'
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'))
const maxRounds = 120
const intervalMs = 8000

for (let round = 1; round <= maxRounds; round++) {
  const pending = run.tasks.filter((t) => t.taskId && (t.status === 'running' || t.status === 'creating'))
  if (pending.length === 0) break

  console.log(`round ${round}: polling ${pending.length} running jobs`)
  for (const task of pending) {
    try {
      const detail = await getJob(task.taskId)
      task.pollStatus = detail.status
      task.progress = detail.progress || null
      if (!isTerminal(detail.status)) {
        task.status = 'running'
        task.note = detail.progress
          ? `生成中 ${detail.progress.success}/${detail.progress.total}`
          : `状态 ${detail.status}`
        continue
      }
      if (String(detail.status) === 'failed') {
        task.status = 'failed'
        task.note = detail.error_message || '生成失败'
        task.createError = task.note
        continue
      }
      const result = pickSuccess(detail.results, task.host)
      if (!result) {
        task.status = 'failed'
        task.note = detail.error_message || '生成结束但没有成功草稿'
        continue
      }
      const articleId =
        result.article_id == null || String(result.article_id).trim() === ''
          ? null
          : String(result.article_id).trim()
      task.itemId = result.id
      task.newArticleId = articleId
      task.status = articleId ? 'ready' : 'ready_draft_only'
      task.note = articleId ? `草稿完成 article_id=${articleId}` : '草稿完成（尚无 article_id）'
      if (articleId) {
        task.newLandingUrl = rewriteOfferUrl(task.oldLandingUrl, task.channelId, articleId)
      }
    } catch (error) {
      task.note = `轮询暂时失败：${error instanceof Error ? error.message : String(error)}`
    }
  }

  run.summary = {
    total: run.tasks.length,
    created: run.tasks.filter((t) => t.taskId).length,
    running: run.tasks.filter((t) => t.status === 'running').length,
    ready: run.tasks.filter((t) => t.status === 'ready' || t.status === 'ready_draft_only').length,
    failed: run.tasks.filter((t) => t.status === 'failed').length,
  }
  run.lastPolledAt = new Date().toISOString()
  fs.writeFileSync(runPath, JSON.stringify(run, null, 2))

  if (run.summary.running === 0) break
  await new Promise((r) => setTimeout(r, intervalMs))
}

run.finishedPollAt = new Date().toISOString()
fs.writeFileSync(runPath, JSON.stringify(run, null, 2))
console.log(JSON.stringify({ summary: run.summary, finishedPollAt: run.finishedPollAt }, null, 2))
