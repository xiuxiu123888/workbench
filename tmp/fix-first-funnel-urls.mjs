import fs from 'fs'
import path from 'path'

function articleIdFromUrl(url) {
  const matched = String(url || '').match(/\/detail\/(\d+)/)
  return matched?.[1] || ''
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function preserveHitPlaceholder(url) {
  return String(url || '').replace(/([?&])hit=%7Bhit%7D/gi, '$1hit={hit}')
}

function buildOfferLandingUrl(oldLandingUrl, channelId, newArticleId, seedKeyword) {
  const oldUrl = String(oldLandingUrl || '').trim()
  const articleId = String(newArticleId || '').trim()
  const channel = String(channelId || '').trim()
  const ref = String(seedKeyword || '').trim()
  if (!oldUrl || !articleId || !channel) return null
  const u = new URL(oldUrl)
  u.pathname = u.pathname.replace(/\/detail\/\d+/, `/detail/${articleId}`)
  u.searchParams.set('subid1', channel)
  u.searchParams.set('subid2', articleId)
  if (ref) u.searchParams.set('ref', ref)
  return preserveHitPlaceholder(u.toString())
}

const flat = JSON.parse(fs.readFileSync('data/ops-center/metrics/2026-11-11/all.json', 'utf8'))
const byId = new Map()
const byName = new Map()
for (const row of flat.statsList || []) {
  byId.set(String(row.id), row)
  byName.set(String(row.name || ''), row)
}

const siteHostIndex = JSON.parse(fs.readFileSync('tmp/site-host-index.json', 'utf8'))
const run = JSON.parse(fs.readFileSync('tmp/first-funnel-generate-run.json', 'utf8'))

const mismatches = []
for (const task of run.tasks) {
  const stats = byId.get(String(task.offerId)) || byName.get(String(task.offerName)) || null
  const correctUrl = stats?.url ? String(stats.url).trim() : null
  const previousUrl = task.oldLandingUrl
  const correctHost = correctUrl ? hostFromUrl(correctUrl) : null
  const previousHost = previousUrl ? hostFromUrl(previousUrl) : null
  const site = correctHost ? siteHostIndex[correctHost] || null : null

  const changed = correctUrl && previousUrl && correctUrl !== previousUrl
  if (changed) {
    mismatches.push({
      offerId: task.offerId,
      offerName: task.offerName,
      previousUrl,
      correctUrl,
      previousHost,
      correctHost,
      previousSiteId: task.siteId,
      correctSiteId: site?.siteId ?? null,
      publishedArticleId: task.newArticleId || null,
      publishedOnWrongSite: previousHost !== correctHost,
    })
  }

  if (correctUrl) {
    task.oldLandingUrl = correctUrl
    task.oldArticleId = articleIdFromUrl(correctUrl)
    task.host = correctHost
    if (site) {
      task.siteId = site.siteId
      task.accountId = site.accountId
      task.siteName = site.siteName
      task.siteResolved = true
    } else {
      task.siteResolved = false
    }
    if (task.newArticleId) {
      task.newLandingUrl = buildOfferLandingUrl(
        correctUrl,
        task.channelId,
        task.newArticleId,
        task.seed?.keyword || '',
      )
      task.note = `已按 offerId 纠正旧链；新链基于正确域名重拼（article 仍是当时发到 ${previousHost || '未知站'} 的）`
    }
  }
}

run.urlMatchFixedAt = new Date().toISOString()
run.urlMismatchCount = mismatches.length
run.urlMismatches = mismatches
fs.writeFileSync('tmp/first-funnel-generate-run.json', JSON.stringify(run, null, 2))

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

console.log(
  JSON.stringify(
    {
      mismatchCount: mismatches.length,
      wrongSiteCount: mismatches.filter((m) => m.publishedOnWrongSite).length,
      sample: mismatches.slice(0, 5),
      fixedExample: jobs.find((j) => j.offerId === '3sF8IOP57Geg'),
    },
    null,
    2,
  ),
)
