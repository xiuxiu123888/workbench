import fs from 'node:fs'

const urls = [
  'https://algo-cash.com/detail/221412270182?ref=clorox+everclean&channel=12152&hit={hit}&rType=2&partner=Blinkdrama&subid1=12152&subid2=221412270182',
  'https://degreesuccesstips.com/detail/260559976094?ref=cars+with+0+apr&channel=2092927125&hit={hit}&rType=2&partner=Blinkdrama&subid1=2092927125&subid2=260559976094',
  'https://funfillgames.com/detail/126389073303?ref=cars+with+0+finance&channel=8412824288&hit={hit}&rType=2&partner=Blinkdrama&subid1=8412824288&subid2=126389073303',
  'https://mpbus.com/detail/520034953200?ref=cars+for+sale+0%25+finance&channel=7227122706&hit={hit}&rType=2&partner=Blinkdrama&subid1=7227122706&subid2=520034953200',
  'https://whirlwindarcade.com/detail/843927117121?ref=cars+with+0+finance&channel=5602828114&hit={hit}&rType=2&partner=Blinkdrama&subid1=5602828114&subid2=843927117121',
  'https://beauty-center-nearby.com/detail/203008532777?ref=hyundai+0+financing&channel=13434&hit={hit}&rType=2&partner=Blinkdrama&subid1=13434&subid2=203008532777',
]

type Target = {
  url: string
  host: string
  articleId: string
  channel: string
  ref: string
}

function parse(url: string): Target {
  const u = new URL(url)
  const articleId = (u.pathname.match(/\/detail\/(\d+)/) || [])[1] || ''
  return {
    url,
    host: u.hostname,
    articleId,
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

type Row = {
  funnelName: string
  funnelId: string
  groupName?: string
  offerId: string
  offerName: string
  channelId?: string
  seed?: string
  status?: string
  source: string
}

function rowsForTarget(t: Target): Row[] {
  const out: Row[] = []
  const seen = new Set<string>()

  const push = (row: Row) => {
    const key = `${row.funnelId}|${row.offerId}|${row.source}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(row)
  }

  for (const job of jobs) {
    const articleId = String(job.articleId || '')
    const channelId = String(job.channelId || '')
    const seed = String(job.seedKeyword || '')
    const newUrl = String(job.newLandingUrl || '')
    const matched =
      articleId === t.articleId ||
      channelId === t.channel ||
      seed.toLowerCase() === t.ref.toLowerCase() ||
      newUrl.includes(t.articleId) ||
      newUrl.includes(t.host)
    if (!matched) continue
    push({
      funnelName: String(job.funnelName || ''),
      funnelId: String(job.funnelId || ''),
      offerId: String(job.offerId || ''),
      offerName: String(job.offerName || ''),
      channelId,
      seed,
      status: String(job.status || ''),
      source: 'draft',
    })
  }

  for (const rec of replaceRecords) {
    const articleId = String(rec.articleId || '')
    const channelId = String(rec.channelId || '')
    const ref = String(rec.ref || '')
    const resultUrl = String(rec.resultUrl || '')
    const newUrl = String(rec.newUrl || '')
    const matched =
      articleId === t.articleId ||
      channelId === t.channel ||
      ref.toLowerCase() === t.ref.toLowerCase() ||
      resultUrl.includes(t.articleId) ||
      newUrl.includes(t.articleId) ||
      resultUrl.includes(t.host)
    if (!matched) continue
    push({
      funnelName: String(rec.funnelName || ''),
      funnelId: String(rec.funnelId || ''),
      offerId: String(rec.offerId || ''),
      offerName: String(rec.offerName || ''),
      channelId,
      seed: ref,
      source: 'replace-log',
    })
  }

  for (const group of groups) {
    for (const offer of group.offerList || []) {
      const landing = String(offer.resultUrl || offer.url || '')
      let channel = ''
      try {
        channel = new URL(landing).searchParams.get('channel') || ''
      } catch {
        channel = String(offer.sourceChannelId || '')
      }
      const matched = channel === t.channel || landing.includes(t.host)
      if (!matched) continue
      push({
        funnelName: String(group.funnelName || ''),
        funnelId: String(group.funnelId || ''),
        groupName: String(group.groupName || ''),
        offerId: String(offer.offerId || ''),
        offerName: String(offer.offerName || ''),
        channelId: channel,
        source: 'groups',
      })
    }
  }

  return out
}

const report = targets.map((t) => {
  const rows = rowsForTarget(t)
  const funnels = [
    ...new Set(rows.map((r) => r.funnelName).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b))
  return {
    ref: t.ref,
    articleId: t.articleId,
    channel: t.channel,
    host: t.host,
    funnels,
    matches: rows,
  }
})

fs.writeFileSync('tmp/lookup-landing-funnels.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
