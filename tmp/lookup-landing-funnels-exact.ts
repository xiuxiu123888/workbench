import fs from 'node:fs'

const urls = [
  'https://algo-cash.com/detail/221412270182?ref=clorox+everclean&channel=12152&hit={hit}&rType=2&partner=Blinkdrama&subid1=12152&subid2=221412270182',
  'https://degreesuccesstips.com/detail/260559976094?ref=cars+with+0+apr&channel=2092927125&hit={hit}&rType=2&partner=Blinkdrama&subid1=2092927125&subid2=260559976094',
  'https://funfillgames.com/detail/126389073303?ref=cars+with+0+finance&channel=8412824288&hit={hit}&rType=2&partner=Blinkdrama&subid1=8412824288&subid2=126389073303',
  'https://mpbus.com/detail/520034953200?ref=cars+for+sale+0%25+finance&channel=7227122706&hit={hit}&rType=2&partner=Blinkdrama&subid1=7227122706&subid2=520034953200',
  'https://whirlwindarcade.com/detail/843927117121?ref=cars+with+0+finance&channel=5602828114&hit={hit}&rType=2&partner=Blinkdrama&subid1=5602828114&subid2=843927117121',
  'https://beauty-center-nearby.com/detail/203008532777?ref=hyundai+0+financing&channel=13434&hit={hit}&rType=2&partner=Blinkdrama&subid1=13434&subid2=203008532777',
]

function parse(url: string) {
  const u = new URL(url)
  return {
    url,
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

const report = targets.map((t) => {
  const draftExact = jobs.filter((job) => {
    const articleId = String(job.articleId || '')
    const channelId = String(job.channelId || '')
    const newUrl = String(job.newLandingUrl || '')
    return (
      (articleId === t.articleId || newUrl.includes(`/detail/${t.articleId}`)) &&
      (channelId === t.channel || newUrl.includes(`channel=${t.channel}`))
    )
  })

  const draftByArticle = jobs.filter((job) => {
    const articleId = String(job.articleId || '')
    const newUrl = String(job.newLandingUrl || '')
    return articleId === t.articleId || newUrl.includes(`/detail/${t.articleId}`)
  })

  const draftByChannel = jobs.filter((job) => String(job.channelId || '') === t.channel)

  const replaceExact = replaceRecords.filter((rec) => {
    const articleId = String(rec.articleId || '')
    const channelId = String(rec.channelId || '')
    const resultUrl = String(rec.resultUrl || '')
    return (
      (articleId === t.articleId || resultUrl.includes(`/detail/${t.articleId}`)) &&
      (channelId === t.channel || resultUrl.includes(`channel=${t.channel}`))
    )
  })

  const groupByChannel = [] as Array<{
    funnelName: string
    funnelId: string
    groupName: string
    offerId: string
    offerName: string
    channelId: string
  }>
  for (const group of groups) {
    for (const offer of group.offerList || []) {
      const landing = String(offer.resultUrl || offer.url || '')
      let channel = ''
      try {
        channel = new URL(landing).searchParams.get('channel') || ''
      } catch {
        channel = String(offer.sourceChannelId || '')
      }
      if (channel !== t.channel) continue
      groupByChannel.push({
        funnelName: group.funnelName,
        funnelId: group.funnelId,
        groupName: group.groupName,
        offerId: String(offer.offerId || ''),
        offerName: String(offer.offerName || ''),
        channelId: channel,
      })
    }
  }

  const primary =
    draftExact[0] ||
    replaceExact[0] ||
    draftByChannel[0] ||
    draftByArticle[0] ||
    groupByChannel[0] ||
    null

  return {
    ref: t.ref,
    articleId: t.articleId,
    channel: t.channel,
    host: t.host,
    primaryFunnel: primary
      ? {
          funnelName: String(primary.funnelName || ''),
          funnelId: String(primary.funnelId || ''),
          offerId: String(primary.offerId || ''),
          offerName: String(primary.offerName || ''),
          groupName: String((primary as { groupName?: string }).groupName || ''),
          seed: String((primary as { seedKeyword?: string; ref?: string }).seedKeyword || (primary as { ref?: string }).ref || ''),
        }
      : null,
    exactDrafts: draftExact.map((j) => ({
      funnelName: j.funnelName,
      funnelId: j.funnelId,
      offerId: j.offerId,
      offerName: j.offerName,
      seed: j.seedKeyword,
      status: j.status,
    })),
    exactReplace: replaceExact.map((j) => ({
      funnelName: j.funnelName,
      funnelId: j.funnelId,
      offerId: j.offerId,
      offerName: j.offerName,
      ref: j.ref,
    })),
    channelOffersInGroups: groupByChannel,
  }
})

fs.writeFileSync('tmp/lookup-landing-funnels-exact.json', JSON.stringify(report, null, 2))
for (const row of report) {
  const p = row.primaryFunnel
  console.log(
    [
      row.ref,
      `article=${row.articleId}`,
      `channel=${row.channel}`,
      p
        ? `漏斗=${p.funnelName} | offer=${p.offerName} (${p.offerId}) | seed=${p.seed || '—'}`
        : '未找到',
      `exactDraft=${row.exactDrafts.length}`,
      `channelGroupHits=${row.channelOffersInGroups.length}`,
    ].join(' || '),
  )
  if (row.channelOffersInGroups.length) {
    for (const g of row.channelOffersInGroups) {
      console.log(`  - ${g.funnelName} / ${g.groupName} / ${g.offerName}`)
    }
  }
}
