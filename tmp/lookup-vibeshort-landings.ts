import fs from 'node:fs'

const urls = [
  'https://insurance-consulting-nearby.com/detail/466649922273?ref=cars+with+0+apr&channel=14944&hit={hit}&rType=2&partner=VibeShort&subid1=14944&subid2=466649922273',
  'https://degreesuccesstips.com/detail/532151653678?ref=cars+with+0+finance&channel=8003729354&hit={hit}&rType=2&partner=VibeShort&subid1=8003729354&subid2=532151653678',
]

function parse(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    articleId: (u.pathname.match(/\/detail\/(\d+)/) || [])[1] || '',
    channel: u.searchParams.get('channel') || '',
    ref: String(u.searchParams.get('ref') || '')
      .replace(/\+/g, ' ')
      .trim(),
  }
}

const targets = urls.map(parse)
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
    sourceChannelId?: string
  }>
}>

for (const t of targets) {
  const draftExact = jobs.filter((job) => {
    const articleId = String(job.articleId || '')
    const channelId = String(job.channelId || '')
    const newUrl = String(job.newLandingUrl || '')
    return (
      (articleId === t.articleId || newUrl.includes(`/detail/${t.articleId}`)) &&
      (channelId === t.channel || newUrl.includes(`channel=${t.channel}`))
    )
  })
  const draftByChannel = jobs.filter((job) => String(job.channelId || '') === t.channel)
  const draftByArticle = jobs.filter(
    (job) =>
      String(job.articleId || '') === t.articleId ||
      String(job.newLandingUrl || '').includes(`/detail/${t.articleId}`),
  )
  const replaceExact = replaceRecords.filter((rec) => {
    const articleId = String(rec.articleId || '')
    const channelId = String(rec.channelId || '')
    const resultUrl = String(rec.resultUrl || '')
    return (
      (articleId === t.articleId || resultUrl.includes(`/detail/${t.articleId}`)) &&
      (channelId === t.channel || resultUrl.includes(`channel=${t.channel}`))
    )
  })

  const groupByChannel: Array<{
    funnelName: string
    funnelId: string
    groupName: string
    offerId: string
    offerName: string
  }> = []
  for (const group of groups) {
    for (const offer of group.offerList || []) {
      const landing = String(offer.resultUrl || offer.url || '')
      let channel = ''
      try {
        channel = new URL(landing).searchParams.get('channel') || ''
      } catch {
        channel = String(offer.sourceChannelId || '')
      }
      if (channel === t.channel) {
        groupByChannel.push({
          funnelName: group.funnelName,
          funnelId: group.funnelId,
          groupName: group.groupName,
          offerId: String(offer.offerId || ''),
          offerName: String(offer.offerName || ''),
        })
      }
    }
  }

  const primary =
    draftExact[0] || replaceExact[0] || draftByChannel[0] || draftByArticle[0] || groupByChannel[0]

  console.log(
    JSON.stringify(
      {
        ref: t.ref,
        articleId: t.articleId,
        channel: t.channel,
        host: t.host,
        primary: primary
          ? {
              funnelName: String(primary.funnelName || ''),
              funnelId: String(primary.funnelId || ''),
              offerId: String(primary.offerId || ''),
              offerName: String(primary.offerName || ''),
              groupName: String((primary as { groupName?: string }).groupName || ''),
              seed: String(
                (primary as { seedKeyword?: string }).seedKeyword ||
                  (primary as { ref?: string }).ref ||
                  '',
              ),
            }
          : null,
        exactDrafts: draftExact.map((j) => ({
          funnelName: j.funnelName,
          offerName: j.offerName,
          offerId: j.offerId,
          seed: j.seedKeyword,
        })),
        byChannelDrafts: draftByChannel.map((j) => ({
          funnelName: j.funnelName,
          offerName: j.offerName,
          offerId: j.offerId,
          seed: j.seedKeyword,
          articleId: j.articleId,
        })),
        groupByChannel,
      },
      null,
      2,
    ),
  )
}
