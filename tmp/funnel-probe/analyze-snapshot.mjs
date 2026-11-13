import fs from 'fs'

const groups = JSON.parse(fs.readFileSync('tmp/funnel-probe/snapshot/groups.json', 'utf8'))
const details = JSON.parse(fs.readFileSync('tmp/funnel-probe/snapshot/details.json', 'utf8'))
const list = JSON.parse(fs.readFileSync('tmp/funnel-probe/snapshot/list.json', 'utf8')).data || []

const offers = []
for (const g of groups) {
  for (const o of g.offerList || []) {
    offers.push({
      ...o,
      groupId: g.groupId,
      groupName: g.groupName,
      geo: g.geo,
      routing: g.routing,
      yesterdayRpm: g.yesterdayRpm,
      yesterdayRev: g.yesterdayRev,
      yesterdayRpmTrend: g.yesterdayRpmTrend,
      yesterdayRevTrend: g.yesterdayRevTrend,
      funnelId: g.funnelId,
      funnelName: g.funnelName,
      partnerName: g.partnerName,
      urlName: g.urlName,
      platform: g.platform,
    })
  }
}

function sum(arr, key) {
  return arr.reduce((n, x) => n + (Number(x[key]) || 0), 0)
}

function groupBy(arr, keyFn) {
  const m = new Map()
  for (const item of arr) {
    const k = keyFn(item) || '(empty)'
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(item)
  }
  return m
}

function rank(map, metricFn, limit = 15) {
  return [...map.entries()]
    .map(([k, rows]) => ({ key: k, ...metricFn(rows), count: rows.length }))
    .sort((a, b) => (b.rev || 0) - (a.rev || 0) || (b.rpm || 0) - (a.rpm || 0))
    .slice(0, limit)
}

const partnerRank = rank(groupBy(offers, (o) => o.partnerName), (rows) => ({
  todayRev: sum(rows, 'todayRev'),
  todayRpmAvg: rows.length ? sum(rows, 'todayRpm') / rows.length : 0,
  rev: sum(rows, 'todayRev'),
  rpm: rows.length ? sum(rows, 'todayRpm') / rows.length : 0,
}))

const urlRank = rank(groupBy(offers, (o) => o.urlName), (rows) => ({
  todayRev: sum(rows, 'todayRev'),
  todayRpmAvg: rows.length ? sum(rows, 'todayRpm') / rows.length : 0,
  rev: sum(rows, 'todayRev'),
  rpm: rows.length ? sum(rows, 'todayRpm') / rows.length : 0,
}))

const geoRank = rank(groupBy(offers, (o) => o.geo || o.countryCode), (rows) => ({
  todayRev: sum(rows, 'todayRev'),
  todayRpmAvg: rows.length ? sum(rows, 'todayRpm') / rows.length : 0,
  rev: sum(rows, 'todayRev'),
  rpm: rows.length ? sum(rows, 'todayRpm') / rows.length : 0,
}))

const categoryRank = rank(groupBy(offers, (o) => o.categoryName), (rows) => ({
  todayRev: sum(rows, 'todayRev'),
  todayRpmAvg: rows.length ? sum(rows, 'todayRpm') / rows.length : 0,
  rev: sum(rows, 'todayRev'),
  rpm: rows.length ? sum(rows, 'todayRpm') / rows.length : 0,
}))

const funnelRank = rank(groupBy(groups, (g) => `${g.funnelName}|${g.funnelId}`), (rows) => ({
  todayRev: sum(rows.flatMap((g) => g.offerList || []), 'todayRev'),
  yRev: sum(rows, 'yesterdayRev'),
  yRpm: rows.length ? sum(rows, 'yesterdayRpm') / rows.length : 0,
  rev: sum(rows.flatMap((g) => g.offerList || []), 'todayRev') + sum(rows, 'yesterdayRev'),
  rpm: rows.length ? sum(rows, 'yesterdayRpm') / rows.length : 0,
  groups: rows.length,
}))

const topOffers = [...offers]
  .sort((a, b) => (b.todayRev || 0) - (a.todayRev || 0) || (b.todayRpm || 0) - (a.todayRpm || 0))
  .slice(0, 20)
  .map((o) => ({
    funnelName: o.funnelName,
    partnerName: o.partnerName,
    urlName: o.urlName,
    geo: o.geo,
    categoryName: o.categoryName,
    offerName: o.offerName,
    channelId: o.channelId,
    afsSource: o.afsSource,
    weight: o.weight,
    todayRpm: o.todayRpm,
    todayRev: o.todayRev,
  }))

const nonzeroToday = offers.filter((o) => (o.todayRev || 0) > 0 || (o.todayRpm || 0) > 0)
const nonzeroYday = groups.filter((g) => (g.yesterdayRev || 0) > 0 || (g.yesterdayRpm || 0) > 0)

const geos = [...new Set(groups.map((g) => g.geo).filter(Boolean))].sort()
const categories = [...new Set(offers.map((o) => o.categoryName).filter(Boolean))].sort()
const partners = [...new Set(list.map((f) => f.partnerName).filter(Boolean))].sort()
const urls = [...new Set(list.map((f) => f.urlName).filter(Boolean))].sort()

const report = {
  pulledAt: new Date().toISOString(),
  funnelCount: list.length,
  detailCount: details.length,
  groupCount: groups.length,
  offerCount: offers.length,
  geos,
  categories,
  partners,
  urls,
  nonzeroTodayOffers: nonzeroToday.length,
  nonzeroYdayGroups: nonzeroYday.length,
  totals: {
    todayRev: sum(offers, 'todayRev'),
    todayRpmSum: sum(offers, 'todayRpm'),
    yesterdayRev: sum(groups, 'yesterdayRev'),
    yesterdayRpmSum: sum(groups, 'yesterdayRpm'),
  },
  partnerRank,
  urlRank,
  geoRank,
  categoryRank,
  funnelRank: funnelRank.slice(0, 20),
  topOffers,
  sampleGroupKeys: Object.keys(groups[0] || {}),
  sampleOfferKeys: Object.keys((groups[0]?.offerList || [])[0] || {}),
}

fs.writeFileSync('tmp/funnel-probe/analysis-report.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  funnelCount: report.funnelCount,
  groupCount: report.groupCount,
  offerCount: report.offerCount,
  geos: report.geos.length,
  categories: report.categories.length,
  partners: report.partners.length,
  urls: report.urls.length,
  nonzeroTodayOffers: report.nonzeroTodayOffers,
  nonzeroYdayGroups: report.nonzeroYdayGroups,
  totals: report.totals,
  topPartners: partnerRank.slice(0, 8),
  topUrls: urlRank.slice(0, 8),
  topGeos: geoRank.slice(0, 10),
  topCategories: categoryRank.slice(0, 12),
  topOffers: topOffers.slice(0, 8),
}, null, 2))
