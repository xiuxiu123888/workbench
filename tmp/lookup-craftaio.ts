import fs from 'node:fs'

const articleId = '432481640004'
const host = 'craftaio.com'

const drafts = JSON.parse(fs.readFileSync('data/ops-center/funnel-offer-drafts.json', 'utf8')) as {
  jobs?: Array<Record<string, unknown>>
}
const jobs = Array.isArray(drafts.jobs) ? drafts.jobs : []

let replaceRecords: Array<Record<string, unknown>> = []
if (fs.existsSync('data/ops-center/offer-replace-log.json')) {
  const log = JSON.parse(fs.readFileSync('data/ops-center/offer-replace-log.json', 'utf8')) as {
    records?: Array<Record<string, unknown>>
  }
  replaceRecords = Array.isArray(log.records) ? log.records : []
}

const groups = JSON.parse(fs.readFileSync('data/ops-center/raw/groups.json', 'utf8')) as Array<{
  funnelId: string
  funnelName: string
  groupId: string
  groupName: string
  offerList?: Array<{
    offerId?: string
    offerName?: string
    resultUrl?: string
    url?: string
  }>
}>

const draftHits = jobs.filter((job) => {
  const aid = String(job.articleId || '')
  const newUrl = String(job.newLandingUrl || '')
  const oldUrl = String(job.oldLandingUrl || '')
  return (
    aid === articleId ||
    newUrl.includes(`/detail/${articleId}`) ||
    newUrl.includes(host) ||
    oldUrl.includes(host)
  )
})

const replaceHits = replaceRecords.filter((rec) => {
  const aid = String(rec.articleId || '')
  const resultUrl = String(rec.resultUrl || '')
  const newUrl = String(rec.newUrl || '')
  const oldUrl = String(rec.oldUrl || '')
  return (
    aid === articleId ||
    resultUrl.includes(`/detail/${articleId}`) ||
    resultUrl.includes(host) ||
    newUrl.includes(host) ||
    oldUrl.includes(host)
  )
})

const groupHits: Array<Record<string, string>> = []
for (const group of groups) {
  for (const offer of group.offerList || []) {
    const landing = String(offer.resultUrl || offer.url || '')
    if (landing.includes(host) || landing.includes(`/detail/${articleId}`)) {
      groupHits.push({
        funnelName: group.funnelName,
        funnelId: group.funnelId,
        groupName: group.groupName,
        offerId: String(offer.offerId || ''),
        offerName: String(offer.offerName || ''),
        landing: landing.slice(0, 180),
      })
    }
  }
}

const exactDraft = draftHits.filter(
  (job) =>
    String(job.articleId || '') === articleId ||
    String(job.newLandingUrl || '').includes(`/detail/${articleId}`),
)
const exactReplace = replaceHits.filter(
  (rec) =>
    String(rec.articleId || '') === articleId ||
    String(rec.resultUrl || '').includes(`/detail/${articleId}`) ||
    String(rec.newUrl || '').includes(`/detail/${articleId}`),
)

console.log(
  JSON.stringify(
    {
      articleId,
      host,
      exactDraft: exactDraft.map((j) => ({
        funnelName: j.funnelName,
        funnelId: j.funnelId,
        offerId: j.offerId,
        offerName: j.offerName,
        groupName: j.groupName,
        channelId: j.channelId,
        seed: j.seedKeyword,
        status: j.status,
        newLandingUrl: j.newLandingUrl,
      })),
      exactReplace: exactReplace.map((j) => ({
        funnelName: j.funnelName,
        funnelId: j.funnelId,
        offerId: j.offerId,
        offerName: j.offerName,
        ref: j.ref,
        resultUrl: j.resultUrl,
      })),
      hostDrafts: draftHits.map((j) => ({
        funnelName: j.funnelName,
        offerName: j.offerName,
        offerId: j.offerId,
        articleId: j.articleId,
        seed: j.seedKeyword,
      })),
      hostGroups: groupHits,
    },
    null,
    2,
  ),
)
