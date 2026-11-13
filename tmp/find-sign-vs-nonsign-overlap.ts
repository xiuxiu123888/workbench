import fs from 'node:fs'
import path from 'node:path'
import { FUNNEL_BROWSE_ALLOWLIST, isAllowedBrowseFunnel } from '../src/domain/funnelBrowseAllowlist'

type OfferLite = {
  offerId?: string
  offerName?: string
  countryCode?: string | null
  categoryName?: string | null
}

type GroupLite = {
  groupId: string
  groupName: string
  funnelId: string
  funnelName: string
  geo?: string | null
  offerList?: OfferLite[]
}

type FunnelOfferRow = {
  offerName: string
  categoryName: string
  geo: string
  rotators: Set<string>
}

type FunnelBucket = {
  funnelId: string
  funnelName: string
  offers: Map<string, FunnelOfferRow>
}

type SideFunnel = {
  funnelName: string
  funnelId: string
  rotators: string[]
}

type SideHit = {
  offerName: string
  categoryName: string
  geo: string
  funnels: Map<string, SideFunnel>
}

type OfferOverlap = {
  offerId: string
  offerName: string
  categoryName: string
  geo: string
  signFunnels: SideFunnel[]
  nonSignFunnels: SideFunnel[]
}

const KNOWN_PREFIXES = [
  'cd-reader',
  'blinkdrama',
  'moboreels',
  'vibeshort',
  'shortmax',
  'storyreel',
  'reader',
] as const

function partnerPrefix(funnelName: string): string {
  const lower = String(funnelName || '')
    .trim()
    .toLowerCase()
  for (const key of KNOWN_PREFIXES) {
    if (lower === key || lower.startsWith(`${key}-`)) {
      return key
    }
  }
  const noSign = String(funnelName || '')
    .trim()
    .replace(/-sign(?=-|$)/i, '')
  const match = noSign.match(/^(.*?)(?:-v\d+)?$/i)
  return (match?.[1] || noSign).toLowerCase()
}

function isSignFunnel(funnelName: string): boolean {
  return /-sign(?:-|$)/i.test(String(funnelName || ''))
}

const root = process.cwd()
const groups = JSON.parse(
  fs.readFileSync(path.join(root, 'data/ops-center/raw/groups.json'), 'utf8'),
) as GroupLite[]

const funnelOffers = new Map<string, FunnelBucket>()

for (const group of groups) {
  const funnelName = String(group.funnelName || '').trim()
  if (!isAllowedBrowseFunnel(funnelName)) continue
  const funnelId = String(group.funnelId || '').trim()
  let bucket = funnelOffers.get(funnelName)
  if (!bucket) {
    bucket = { funnelId, funnelName, offers: new Map() }
    funnelOffers.set(funnelName, bucket)
  }
  const rotator = String(group.groupName || group.groupId || '').trim()
  for (const offer of group.offerList || []) {
    const offerId = String(offer.offerId || '').trim()
    if (!offerId) continue
    let row = bucket.offers.get(offerId)
    if (!row) {
      row = {
        offerName: String(offer.offerName || offerId).trim(),
        categoryName: String(offer.categoryName || '').trim() || '—',
        geo: String(offer.countryCode || group.geo || '').trim() || '—',
        rotators: new Set(),
      }
      bucket.offers.set(offerId, row)
    }
    if (rotator) row.rotators.add(rotator)
  }
}

const byPartner = new Map<string, string[]>()
for (const name of FUNNEL_BROWSE_ALLOWLIST) {
  const partner = partnerPrefix(name)
  const list = byPartner.get(partner) || []
  list.push(name)
  byPartner.set(partner, list)
}

function ingest(side: Map<string, SideHit>, funnelNames: string[]) {
  for (const funnelName of funnelNames) {
    const bucket = funnelOffers.get(funnelName)
    if (!bucket) continue
    for (const [offerId, row] of bucket.offers) {
      let hit = side.get(offerId)
      if (!hit) {
        hit = {
          offerName: row.offerName,
          categoryName: row.categoryName,
          geo: row.geo,
          funnels: new Map(),
        }
        side.set(offerId, hit)
      }
      hit.funnels.set(funnelName, {
        funnelName,
        funnelId: bucket.funnelId,
        rotators: [...row.rotators].sort((a, b) => a.localeCompare(b)),
      })
    }
  }
}

const reports: Array<{
  partner: string
  funnels: string[]
  signFunnels: string[]
  nonSignFunnels: string[]
  skipped: boolean
  reason?: string
  signOfferCount?: number
  nonSignOfferCount?: number
  overlapCount: number
  overlaps: OfferOverlap[]
}> = []

for (const [partner, names] of [...byPartner.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const signFunnels = names.filter(isSignFunnel)
  const nonSignFunnels = names.filter((name) => !isSignFunnel(name))

  if (signFunnels.length === 0 || nonSignFunnels.length === 0) {
    reports.push({
      partner,
      funnels: names,
      signFunnels,
      nonSignFunnels,
      skipped: true,
      reason: signFunnels.length === 0 ? '组内无 sign 漏斗' : '组内无非 sign 漏斗',
      overlapCount: 0,
      overlaps: [],
    })
    continue
  }

  const signSide = new Map<string, SideHit>()
  const nonSignSide = new Map<string, SideHit>()
  ingest(signSide, signFunnels)
  ingest(nonSignSide, nonSignFunnels)

  const overlaps: OfferOverlap[] = []
  for (const [offerId, signHit] of signSide) {
    const nonSignHit = nonSignSide.get(offerId)
    if (!nonSignHit) continue
    overlaps.push({
      offerId,
      offerName: signHit.offerName || nonSignHit.offerName,
      categoryName: signHit.categoryName || nonSignHit.categoryName,
      geo: signHit.geo || nonSignHit.geo,
      signFunnels: [...signHit.funnels.values()].sort((a, b) => a.funnelName.localeCompare(b.funnelName)),
      nonSignFunnels: [...nonSignHit.funnels.values()].sort((a, b) =>
        a.funnelName.localeCompare(b.funnelName),
      ),
    })
  }
  overlaps.sort(
    (a, b) => a.offerName.localeCompare(b.offerName) || a.offerId.localeCompare(b.offerId),
  )

  reports.push({
    partner,
    funnels: names,
    signFunnels,
    nonSignFunnels,
    skipped: false,
    signOfferCount: signSide.size,
    nonSignOfferCount: nonSignSide.size,
    overlapCount: overlaps.length,
    overlaps,
  })
}

const checked = reports.filter((row) => !row.skipped)
const withOverlap = checked.filter((row) => row.overlapCount > 0)
const out = {
  generatedAt: new Date().toISOString(),
  partnerGroupCount: reports.length,
  checkedGroups: checked.length,
  groupsWithOverlap: withOverlap.length,
  totalOverlapOffers: withOverlap.reduce((sum, row) => sum + row.overlapCount, 0),
  reports,
}

const jsonPath = path.join(root, 'tmp/sign-vs-nonsign-offer-overlap.json')
const txtPath = path.join(root, 'tmp/sign-vs-nonsign-offer-overlap.txt')
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), 'utf8')

const lines: string[] = []
lines.push('# 白名单 · 合作商前缀组内：sign vs 非 sign 相同 offer')
lines.push(`生成: ${out.generatedAt}`)
lines.push(
  `合作商组 ${out.partnerGroupCount} · 可对比（同时有 sign/非sign）${out.checkedGroups} · 有重叠 ${out.groupsWithOverlap} · 重叠 offer 合计 ${out.totalOverlapOffers}`,
)
lines.push('')

for (const report of reports) {
  lines.push(`## ${report.partner}`)
  lines.push(`漏斗: ${report.funnels.join(', ')}`)
  lines.push(`sign: ${report.signFunnels.join(', ') || '—'}`)
  lines.push(`非sign: ${report.nonSignFunnels.join(', ') || '—'}`)
  if (report.skipped) {
    lines.push(`结果: 跳过（${report.reason}）`)
    lines.push('')
    continue
  }
  lines.push(
    `sign侧offer ${report.signOfferCount} · 非sign侧offer ${report.nonSignOfferCount} · 重叠 ${report.overlapCount}`,
  )
  if (report.overlapCount === 0) {
    lines.push('结果: 无相同 offer')
  } else {
    for (const hit of report.overlaps) {
      const signText = hit.signFunnels
        .map((funnel) => `${funnel.funnelName}(${funnel.rotators.join('/')})`)
        .join(' | ')
      const nonText = hit.nonSignFunnels
        .map((funnel) => `${funnel.funnelName}(${funnel.rotators.join('/')})`)
        .join(' | ')
      lines.push(
        `- ${hit.offerName} (${hit.offerId}) · ${hit.categoryName} · geo=${hit.geo}`,
      )
      lines.push(`  sign: ${signText}`)
      lines.push(`  非sign: ${nonText}`)
    }
  }
  lines.push('')
}

fs.writeFileSync(txtPath, lines.join('\n'), 'utf8')

console.log(
  JSON.stringify(
    {
      partnerGroupCount: out.partnerGroupCount,
      checkedGroups: out.checkedGroups,
      groupsWithOverlap: out.groupsWithOverlap,
      totalOverlapOffers: out.totalOverlapOffers,
      summary: reports.map((row) => ({
        partner: row.partner,
        skipped: row.skipped,
        reason: row.reason,
        signFunnels: row.signFunnels,
        nonSignFunnels: row.nonSignFunnels,
        overlapCount: row.overlapCount,
        overlaps: row.overlaps.map((hit) => ({
          offerId: hit.offerId,
          offerName: hit.offerName,
          sign: hit.signFunnels.map((funnel) => funnel.funnelName),
          nonSign: hit.nonSignFunnels.map((funnel) => funnel.funnelName),
        })),
      })),
      txtPath,
    },
    null,
    2,
  ),
)
