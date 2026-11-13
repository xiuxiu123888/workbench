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
      const attrs = cellMatch[3] || cellMatch[7] || ''
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

function rewriteOfferUrl(oldUrl, channelId, newArticleId) {
  const u = new URL(oldUrl)
  u.pathname = u.pathname.replace(/\/detail\/\d+/, `/detail/${newArticleId}`)
  u.searchParams.set('subid1', String(channelId))
  u.searchParams.set('subid2', String(newArticleId))
  return u.toString()
}

const sheetRows = parseSheet('tmp/xlsx-extract/xl/worksheets/sheet1.xml')
const seeds = []
for (const r of sheetRows.slice(1)) {
  const keyword = String(r.B || '').trim()
  const domainCategory = String(r.D || '').trim()
  if (!keyword || !domainCategory) continue
  if (keyword.startsWith('▶')) continue
  seeds.push({
    keyword,
    country: String(r.C || '').trim() || 'US',
    domainCategory,
    template: String(r.F || '').trim() || null,
    status: String(r.I || '').trim() || null,
    intentKeyword: keyword,
    ref: keyword,
    categoryId: null,
  })
}

const categoriesNeeded = [...new Set(seeds.map((s) => s.domainCategory))].sort()

const rawDir = 'data/ops-center/raw'
const groupFiles = fs.readdirSync(rawDir).filter((f) => f.startsWith('group-') && f.endsWith('.json'))
const offers = []
for (const f of groupFiles) {
  const payload = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8'))
  const g = payload.data || payload
  for (const o of g.offerList || []) {
    offers.push({
      funnelId: g.funnelId,
      funnelName: g.funnelName,
      partnerName: g.partnerName || null,
      groupId: g.groupId,
      groupName: g.groupName,
      geo: g.geo || null,
      offerId: o.offerId,
      offerName: o.offerName,
      categoryName: o.categoryName || null,
      channelId: o.channelId || null,
      weight: o.weight ?? null,
    })
  }
}

const flat = JSON.parse(fs.readFileSync('data/ops-center/metrics/2026-11-11/all.json', 'utf8'))
const byChannel = new Map()
const byName = new Map()
for (const row of flat.statsList || []) {
  const url = String(row.url || '').trim()
  if (!url) continue
  const channel = (() => {
    try {
      return new URL(url).searchParams.get('channel') || ''
    } catch {
      return ''
    }
  })()
  const item = {
    flatId: row.id,
    flatName: row.name,
    url,
    articleId: articleIdFromUrl(url),
    channelFromUrl: channel,
  }
  if (channel) {
    const list = byChannel.get(channel) || []
    list.push(item)
    byChannel.set(channel, list)
  }
  byName.set(String(row.name || ''), item)
}

let withUrl = 0
let withoutUrl = 0
const geoCount = new Map()
const joined = offers.map((o) => {
  const hit =
    (o.channelId && byChannel.get(String(o.channelId))?.[0]) ||
    byName.get(o.offerName) ||
    null
  if (hit?.url) withUrl += 1
  else withoutUrl += 1
  const geo = o.geo || '（空）'
  geoCount.set(geo, (geoCount.get(geo) || 0) + 1)
  return {
    ...o,
    landingUrl: hit?.url || null,
    oldArticleId: hit?.articleId || null,
  }
})

const withUrlOffers = joined.filter((o) => o.landingUrl && o.channelId && o.oldArticleId)
const usOffers = withUrlOffers.filter((o) => String(o.geo || '').toUpperCase() === 'US')

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(20261111)
const targetPool = usOffers.length ? usOffers : withUrlOffers
const sampleSize = Math.min(20, targetPool.length)
const sampleOffers = [...targetPool].sort(() => rng() - 0.5).slice(0, sampleSize)

const sampleTasks = sampleOffers.map((offer, index) => {
  const seed = seeds[Math.floor(rng() * seeds.length)]
  const placeholderArticleId = `NEW_ARTICLE_${index + 1}`
  return {
    taskIndex: index + 1,
    offerId: offer.offerId,
    offerName: offer.offerName,
    funnelId: offer.funnelId,
    funnelName: offer.funnelName,
    groupId: offer.groupId,
    groupName: offer.groupName,
    geo: offer.geo,
    channelId: offer.channelId,
    oldLandingUrl: offer.landingUrl,
    oldArticleId: offer.oldArticleId,
    seed: {
      keyword: seed.keyword,
      intentKeyword: seed.keyword,
      ref: seed.keyword,
      domainCategory: seed.domainCategory,
      categoryId: null,
      countryFromSeed: seed.country,
      regionIdForJob: seed.country === 'VN' ? 'VI' : seed.country,
    },
    articleJob: {
      publish: false,
      articlesPerDomain: 1,
      languageHint: 'en (from old article or EN fallback)',
      targetFromOldUrl: true,
    },
    newLandingUrlExample: rewriteOfferUrl(offer.landingUrl, offer.channelId, placeholderArticleId),
    urlRewriteRule: {
      keepHostAndPathBase: true,
      replaceArticleIdInPath: true,
      setSubid1: 'channelId',
      setSubid2: 'newArticleId',
      keepOtherQueryParams: true,
      overwriteRefWithKeyword: false,
    },
  }
})

const plan = {
  title: '医疗SEO新词 → 随机挂 offer 产文换链（审阅稿）',
  understanding: {
    goal: '用 Excel 63 条医疗种子词随机给现有漏斗 offer 产文，并把新链接写回对应 offer（当前先产出任务与新 URL；RuoYi 写入接口仍待确认）',
    inventory: {
      funnels: 77,
      groups: groupFiles.length,
      offersTotal: offers.length,
      offersWithLandingUrl: withUrl,
      offersWithoutLandingUrl: withoutUrl,
      offersReadyForRewrite: withUrlOffers.length,
      usOffersReady: usOffers.length,
      matchedFlatStatsRows: flat.count,
    },
    seedSource: {
      file: 'data/医疗SEO新词63条_2026-11-09.xlsx',
      sheet: '医疗新词63条',
      keywordCount: seeds.length,
      allSeedCountries: [...new Set(seeds.map((s) => s.country))],
      domainCategories: categoriesNeeded,
    },
    rulesIHeard: [
      '种子词 intentKeyword = 表中关键词',
      'ref = 同一关键词',
      '编排 category 对齐表中「领域分类」，categoryId 向你要',
      '新链接 = 现有 offer.url 改文章 ID，并设 subid1=渠道ID、subid2=新文章ID',
      '文章随机生成后挂进 offer',
    ],
    assumptionsNeedingConfirm: [
      '默认只处理「有落地 URL + channelId」的 offer；无 URL 的先跳过',
      '种子表全是 US；若只换 US geo offer，可用池约见 inventory.usOffersReady；若对全部有 URL offer 随机灌词，见 offersReadyForRewrite',
      '随机策略默认：每个目标 offer 从 63 词中有放回抽 1 条（可改为抽样 N 个 offer）',
      'ref 查询参数：按你说「只改文章ID + subid1/subid2」，示例里不强制覆盖旧 ref；若要改成关键词请确认',
      '真正写回 RuoYi offer 仍缺写入 API；本计划先生成 article-job + 新 URL JSON',
    ],
  },
  blockers: {
    categoryIdsNeeded: categoriesNeeded.map((name) => ({ domainCategory: name, categoryId: null })),
    offerWriteApi: 'missing_or_unconfirmed',
  },
  proposedExecution: {
    mode: 'random_seed_per_offer',
    targetPool: usOffers.length ? 'offers_with_url_and_geo_US' : 'offers_with_url',
    publish: false,
    articlesPerDomain: 1,
    concurrencyHint: 4,
    steps: [
      '读取 Excel 63 词 + 领域分类',
      '读取 raw/group-* 全部 offer，并用 flatStats.url 对齐落地链',
      '向你索取领域分类 → categoryId 映射',
      '按确认范围随机抽词，为每个 offer 创建 1 个 article-job（targets 从旧 URL 域名反查 site/account）',
      '轮询完成后，用旧 URL 替换 detail/{id}，写入 subid1/subid2，得到 newLandingUrl',
      '把 offerId → newLandingUrl / articleId / seed 落盘；写入 RuoYi 等你确认接口',
    ],
  },
  geoDistributionTop: [...geoCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
  sampleTasks,
  seeds,
}

fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync('tmp/medical-seo-offer-plan.json', JSON.stringify(plan, null, 2))
console.log(
  JSON.stringify(
    {
      wrote: 'tmp/medical-seo-offer-plan.json',
      keywordCount: seeds.length,
      categoriesNeeded,
      offers: offers.length,
      withUrl,
      ready: withUrlOffers.length,
      usReady: usOffers.length,
      sampleTasks: sampleTasks.length,
    },
    null,
    2,
  ),
)
