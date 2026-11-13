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
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 500) }
  }
  if (!res.ok) {
    throw new Error(`publish ${taskId}/${itemId} ${res.status}: ${JSON.stringify(body).slice(0, 500)}`)
  }
  return body
}

const runPath = 'tmp/first-funnel-generate-run.json'
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'))
run.publishStartedAt = new Date().toISOString()

const concurrency = 3
let cursor = 0
const queue = run.tasks

async function worker() {
  while (cursor < queue.length) {
    const index = cursor++
    const task = queue[index]
    if (!task.taskId || task.itemId == null) {
      task.publishStatus = 'skipped'
      task.publishError = '缺少 taskId/itemId'
      continue
    }
    if (task.newArticleId) {
      task.publishStatus = 'already_has_article_id'
      continue
    }
    try {
      console.log(`[${task.taskIndex}/${queue.length}] publish ${task.offerName} item=${task.itemId}`)
      const body = await publishItem(task.taskId, task.itemId)
      const articleId =
        body.article_id != null && String(body.article_id).trim() !== ''
          ? String(body.article_id).trim()
          : body.articleId != null && String(body.articleId).trim() !== ''
            ? String(body.articleId).trim()
            : null
      task.publishRaw = body
      if (!articleId) {
        task.publishStatus = 'failed'
        task.publishError = `未返回 article_id: ${JSON.stringify(body).slice(0, 300)}`
        console.error(`[${task.taskIndex}] no article_id`, task.publishError)
        continue
      }
      task.newArticleId = articleId
      task.newLandingUrl = rewriteOfferUrl(task.oldLandingUrl, task.channelId, articleId)
      task.status = 'published'
      task.publishStatus = 'success'
      task.publishError = null
      task.note = `已发布 article_id=${articleId}`
      task.publishedAt = new Date().toISOString()
    } catch (error) {
      task.publishStatus = 'failed'
      task.publishError = error instanceof Error ? error.message : String(error)
      console.error(`[${task.taskIndex}] fail`, task.publishError)
    }
    fs.writeFileSync(runPath, JSON.stringify(run, null, 2))
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()))

run.publishFinishedAt = new Date().toISOString()
run.publishSummary = {
  total: run.tasks.length,
  success: run.tasks.filter((t) => t.publishStatus === 'success' || t.status === 'published').length,
  failed: run.tasks.filter((t) => t.publishStatus === 'failed').length,
  withLandingUrl: run.tasks.filter((t) => t.newLandingUrl).length,
}
fs.writeFileSync(runPath, JSON.stringify(run, null, 2))

console.log(
  JSON.stringify(
    {
      publishSummary: run.publishSummary,
      sample: run.tasks
        .filter((t) => t.newLandingUrl)
        .slice(0, 3)
        .map((t) => ({
          offerName: t.offerName,
          newArticleId: t.newArticleId,
          newLandingUrl: t.newLandingUrl,
        })),
      failed: run.tasks
        .filter((t) => t.publishStatus === 'failed')
        .map((t) => ({ offerName: t.offerName, error: t.publishError })),
    },
    null,
    2,
  ),
)
