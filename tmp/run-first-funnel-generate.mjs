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
const articleBase = 'https://adesmobi.com/admin/back'
const agentBase = String(env.VITE_ARTICLE_AGENT_TARGET || 'https://adesmobi.com').replace(/\/$/, '')

function platformUserFromToken(jwt) {
  try {
    const payload = jwt.split('.')[1]
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return {
      userId: String(json.userId ?? '1'),
      userName: String(json.username || json.sub || 'admin'),
    }
  } catch {
    return { userId: '1', userName: 'admin' }
  }
}

async function articleGet(path) {
  const res = await fetch(`${articleBase}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const body = await res.json()
  if (!res.ok || (body.code != null && Number(body.code) !== 200)) {
    throw new Error(`article ${path} failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
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
    throw new Error(`article detail ${id} failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
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
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 500) }
  }
  if (!res.ok) {
    throw new Error(`create job ${res.status}: ${JSON.stringify(body).slice(0, 500)}`)
  }
  return body
}

function rewriteOfferUrl(oldUrl, channelId, newArticleId) {
  const u = new URL(oldUrl)
  u.pathname = u.pathname.replace(/\/detail\/\d+/, `/detail/${newArticleId}`)
  u.searchParams.set('subid1', String(channelId))
  u.searchParams.set('subid2', String(newArticleId))
  return u.toString()
}

const plan = JSON.parse(fs.readFileSync('tmp/first-funnel-dry-run.json', 'utf8'))
const user = platformUserFromToken(token)
const languages = await articleGet('/lang/getAll')
const english = (languages || []).find((item) => String(item.langCode || '').toLowerCase() === 'en')
const fallbackLangId = english ? Number(english.id) : Number(languages?.[0]?.id)
if (!Number.isFinite(fallbackLangId) || fallbackLangId <= 0) {
  throw new Error('无法解析 language_id')
}

const stamp = Date.now()
const run = {
  title: '第一个漏斗产文执行',
  startedAt: new Date().toISOString(),
  funnel: plan.funnel,
  generateArticles: true,
  publish: false,
  user,
  languageFallbackId: fallbackLangId,
  tasks: [],
  summary: { total: 0, created: 0, failed: 0 },
}

const concurrency = 3
const queue = [...plan.tasks]
let cursor = 0

async function worker() {
  while (cursor < queue.length) {
    const index = cursor++
    const task = queue[index]
    const row = {
      ...task,
      status: 'creating',
      languageId: null,
      taskId: null,
      createError: null,
      createdAt: null,
    }
    try {
      let languageId = fallbackLangId
      if (task.oldArticleId) {
        try {
          const detail = await articleDetail(task.oldArticleId)
          const langId = Number(detail.langId)
          if (Number.isFinite(langId) && langId > 0) languageId = langId
        } catch {
          /* keep fallback */
        }
      }
      row.languageId = languageId
      const idempotencyKey = `funnel1-${plan.funnel.funnelId}-${task.offerId}-${stamp}`
      const payload = {
        intent_keyword: task.seed.intentKeyword,
        category_id: Number(task.seed.categoryId),
        language_id: languageId,
        region_id: task.seed.regionId || 'US',
        user: {
          user_id: user.userId,
          user_name: user.userName,
        },
        targets: [
          {
            domain: task.host,
            site_id: task.siteId,
            account_id: task.accountId,
          },
        ],
        mode: 'auto',
        callback_url: null,
        options: {
          out_show: false,
          generate_author: true,
          publish: false,
          articles_per_domain: 1,
        },
      }
      console.log(`[${task.taskIndex}/${queue.length}] create ${task.offerName} · ${task.seed.keyword}`)
      const created = await createJob(payload, idempotencyKey)
      row.taskId = String(created.task_id || created.taskId || '').trim() || null
      row.status = row.taskId ? 'running' : 'failed'
      row.createError = row.taskId ? null : '未返回 task_id'
      row.createdAt = new Date().toISOString()
      row.rawCreate = {
        task_id: created.task_id,
        status: created.status,
      }
      if (row.taskId) run.summary.created += 1
      else run.summary.failed += 1
    } catch (error) {
      row.status = 'failed'
      row.createError = error instanceof Error ? error.message : String(error)
      run.summary.failed += 1
      console.error(`[${task.taskIndex}] fail`, row.createError)
    }
    run.tasks[index] = row
    run.summary.total = run.tasks.filter(Boolean).length
    fs.writeFileSync('tmp/first-funnel-generate-run.json', JSON.stringify(run, null, 2))
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()))

run.finishedCreateAt = new Date().toISOString()
run.generateArticles = true
fs.writeFileSync('tmp/first-funnel-generate-run.json', JSON.stringify(run, null, 2))

// mark dry-run as superseded
plan.generateArticles = true
plan.generateStartedAt = run.startedAt
plan.generateRunFile = 'tmp/first-funnel-generate-run.json'
fs.writeFileSync('tmp/first-funnel-dry-run.json', JSON.stringify(plan, null, 2))

console.log(
  JSON.stringify(
    {
      wrote: 'tmp/first-funnel-generate-run.json',
      summary: run.summary,
      sampleTaskIds: run.tasks.filter((t) => t?.taskId).slice(0, 5).map((t) => t.taskId),
    },
    null,
    2,
  ),
)
