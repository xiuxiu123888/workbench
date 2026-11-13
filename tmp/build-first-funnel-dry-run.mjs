import fs from 'fs'
import path from 'path'

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
      let value = null
      const is = body.match(/<is><t[^>]*>([\s\S]*?)<\/t><\/is>/)
      const v = body.match(/<v>([\s\S]*?)<\/v>/)
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

function articleIdFromUrl(url) {
  const text = String(url || '').trim()
  const matched = text.match(/\/detail\/(\d+)/)
  if (matched?.[1]) return matched[1]
  try {
    const last = new URL(text).pathname.split('/').filter(Boolean).pop() ?? ''
    return /^\d+$/.test(last) ? last : ''
  } catch {
    return ''
  }
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function rewriteOfferUrl(oldUrl, channelId, newArticleId) {
  const u = new URL(oldUrl)
  u.pathname = u.pathname.replace(/\/detail\/\d+/, `/detail/${newArticleId}`)
  u.searchParams.set('subid1', String(channelId))
  u.searchParams.set('subid2', String(newArticleId))
  return u.toString()
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const report = JSON.parse(fs.readFileSync('data/ops-center/report.json', 'utf8'))
const first = (report.funnelRank || report.funnels || [])[0]
if (!first?.funnelId) {
  throw new Error('report.json 没有 funnelRank[0]')
}

const categoryLookup = JSON.parse(fs.readFileSync('tmp/category-id-lookup.json', 'utf8'))
const siteHostIndex = JSON.parse(fs.readFileSync('tmp/site-host-index.json', 'utf8'))

const sheetRows = parseSheet('tmp/xlsx-extract/xl/worksheets/sheet1.xml')
const seeds = []
for (const r of sheetRows.slice(1)) {
  const keyword = String(r.B || '').trim()
  const domainCategory = String(r.D || '').trim()
  if (!keyword || !domainCategory || keyword.startsWith('▶')) continue
  seeds.push({
    keyword,
    country: String(r.C || '').trim() || 'US',
    domainCategory,
    categoryId: categoryLookup[domainCategory] ?? null,
    intentKeyword: keyword,
    ref: keyword,
  })
}

const flat = JSON.parse(fs.readFileSync('data/ops-center/metrics/2026-11-11/all.json', 'utf8'))
const byOfferId = new Map()
const byName = new Map()
for (const row of flat.statsList || []) {
  const url = String(row.url || '').trim()
  if (!url) continue
  const item = {
    flatId: row.id,
    flatName: row.name,
    url,
    articleId: articleIdFromUrl(url),
  }
  byOfferId.set(String(row.id), item)
  if (row.name) {
    byName.set(String(row.name), item)
  }
}

const rawDir = 'data/ops-center/raw'
const groupFiles = fs.readdirSync(rawDir).filter((f) => f.startsWith('group-') && f.endsWith('.json'))
const offers = []
for (const f of groupFiles) {
  const payload = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8'))
  const g = payload.data || payload
  if (String(g.funnelId) !== String(first.funnelId)) continue
  for (const o of g.offerList || []) {
    const hit = byOfferId.get(String(o.offerId)) || byName.get(String(o.offerName)) || null
    const landingUrl = hit?.url || null
    const host = landingUrl ? hostFromUrl(landingUrl) : ''
    const site = host ? siteHostIndex[host] || null : null
    offers.push({
      funnelId: g.funnelId,
      funnelName: g.funnelName,
      partnerName: g.partnerName || null,
      groupId: g.groupId,
      groupName: g.groupName,
      geo: g.geo || null,
      offerId: o.offerId,
      offerName: o.offerName,
      offerCategoryName: o.categoryName || null,
      channelId: o.channelId || null,
      weight: o.weight ?? null,
      landingUrl,
      oldArticleId: hit?.articleId || null,
      host: host || null,
      siteId: site?.siteId ?? null,
      accountId: site?.accountId ?? null,
      siteName: site?.siteName ?? null,
    })
  }
}

const rng = mulberry32(20261111)
const eligibleAll = offers.filter((o) => o.landingUrl && o.channelId && o.oldArticleId)
const eligibleUs = eligibleAll.filter((o) => String(o.geo || '').toUpperCase() === 'US')
const targetPool = eligibleUs.length ? eligibleUs : eligibleAll
const skipped = offers.filter((o) => !targetPool.some((t) => t.offerId === o.offerId))

const tasks = targetPool.map((offer, index) => {
  const seed = seeds[Math.floor(rng() * seeds.length)]
  const placeholderArticleId = `PENDING_ARTICLE_${index + 1}`
  return {
    taskIndex: index + 1,
    status: 'planned_no_generate',
    offerId: offer.offerId,
    offerName: offer.offerName,
    groupId: offer.groupId,
    groupName: offer.groupName,
    geo: offer.geo,
    channelId: offer.channelId,
    oldLandingUrl: offer.landingUrl,
    oldArticleId: offer.oldArticleId,
    host: offer.host,
    siteId: offer.siteId,
    accountId: offer.accountId,
    siteName: offer.siteName,
    siteResolved: offer.siteId != null && offer.accountId != null,
    seed: {
      keyword: seed.keyword,
      intentKeyword: seed.keyword,
      ref: seed.keyword,
      domainCategory: seed.domainCategory,
      categoryId: seed.categoryId,
      regionId: seed.country === 'VN' ? 'VI' : seed.country,
    },
    articleJobPreview: {
      publish: false,
      articlesPerDomain: 1,
      willCreate: false,
      note: '本轮只出计划，不调用 article-jobs',
      targets: offer.siteId
        ? [{ domain: offer.host, site_id: offer.siteId, account_id: offer.accountId }]
        : [],
    },
    newLandingUrlExample: rewriteOfferUrl(offer.landingUrl, offer.channelId, placeholderArticleId),
    urlRewriteRule: {
      replaceArticleIdInPath: true,
      setSubid1: 'channelId',
      setSubid2: 'newArticleId',
      keepOtherQueryParams: true,
      overwriteRefWithKeyword: false,
    },
  }
})

const unresolvedSite = tasks.filter((t) => !t.siteResolved)
const missingCategory = tasks.filter((t) => t.seed.categoryId == null)

const plan = {
  title: '第一个漏斗干跑计划（不产文）',
  createdAt: new Date().toISOString(),
  generateArticles: false,
  funnel: {
    funnelId: first.funnelId,
    funnelName: first.funnelName,
    partnerName: first.partnerName || null,
    revenue: first.revenue ?? null,
    offerCountReport: first.offerCount ?? null,
    groupCountReport: first.groupCount ?? null,
  },
  inventory: {
    offersInFunnel: offers.length,
    eligibleWithUrl: eligibleAll.length,
    eligibleUs: eligibleUs.length,
    targetPool: targetPool.length,
    targetPoolMode: eligibleUs.length ? 'geo_US_with_url' : 'all_with_url',
    skipped: skipped.length,
    unresolvedSite: unresolvedSite.length,
    missingCategory: missingCategory.length,
    seedCount: seeds.length,
  },
  tasks,
  skippedOffers: skipped.map((o) => ({
    offerId: o.offerId,
    offerName: o.offerName,
    groupId: o.groupId,
    geo: o.geo,
    reason: !o.landingUrl
      ? 'no_landing_url'
      : !o.channelId
        ? 'no_channel_id'
        : !o.oldArticleId
          ? 'no_old_article_id'
          : eligibleUs.length && String(o.geo || '').toUpperCase() !== 'US'
            ? 'geo_not_US'
            : 'unknown',
  })),
}

fs.writeFileSync('tmp/first-funnel-dry-run.json', JSON.stringify(plan, null, 2))
console.log(
  JSON.stringify(
    {
      wrote: 'tmp/first-funnel-dry-run.json',
      funnelId: first.funnelId,
      funnelName: first.funnelName,
      inventory: plan.inventory,
      sample: tasks.slice(0, 3).map((t) => ({
        offerName: t.offerName,
        keyword: t.seed.keyword,
        categoryId: t.seed.categoryId,
        siteId: t.siteId,
        oldLandingUrl: t.oldLandingUrl,
        newLandingUrlExample: t.newLandingUrlExample,
      })),
    },
    null,
    2,
  ),
)
