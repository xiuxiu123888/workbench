import fs from 'node:fs'
import path from 'node:path'
import { isAllowedBrowseFunnel } from '../src/domain/funnelBrowseAllowlist'

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
  routing?: string | null
  offerList?: OfferLite[]
}

const root = process.cwd()
const groupsPath = path.join(root, 'data/ops-center/raw/groups.json')
const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf8')) as GroupLite[]

type Hit = {
  offerId: string
  offerName: string
  geo: string
  categoryName: string
  rotators: { groupId: string; groupName: string; routing: string }[]
}

type FunnelReport = {
  funnelId: string
  funnelName: string
  allowed: boolean
  rotatorCount: number
  duplicateOfferCount: number
  hits: Hit[]
}

const byFunnel = new Map<string, GroupLite[]>()
for (const group of groups) {
  const funnelId = String(group.funnelId || '').trim()
  if (!funnelId) continue
  const list = byFunnel.get(funnelId) || []
  list.push(group)
  byFunnel.set(funnelId, list)
}

const reports: FunnelReport[] = []

for (const [funnelId, funnelGroups] of byFunnel) {
  const funnelName = String(funnelGroups[0]?.funnelName || funnelId).trim()
  /** offerId -> rotator placements */
  const placements = new Map<
    string,
    {
      offerName: string
      geo: string
      categoryName: string
      rotators: Map<string, { groupId: string; groupName: string; routing: string }>
    }
  >()

  for (const group of funnelGroups) {
    const groupId = String(group.groupId || '').trim()
    if (!groupId) continue
    for (const offer of group.offerList || []) {
      const offerId = String(offer.offerId || '').trim()
      if (!offerId) continue
      let row = placements.get(offerId)
      if (!row) {
        row = {
          offerName: String(offer.offerName || offerId).trim(),
          geo: String(offer.countryCode || group.geo || '').trim() || '—',
          categoryName: String(offer.categoryName || '').trim() || '—',
          rotators: new Map(),
        }
        placements.set(offerId, row)
      }
      row.rotators.set(groupId, {
        groupId,
        groupName: String(group.groupName || groupId).trim(),
        routing: String(group.routing || '').trim() || '—',
      })
    }
  }

  const hits: Hit[] = []
  for (const [offerId, row] of placements) {
    if (row.rotators.size < 2) continue
    hits.push({
      offerId,
      offerName: row.offerName,
      geo: row.geo,
      categoryName: row.categoryName,
      rotators: [...row.rotators.values()].sort((a, b) => a.groupName.localeCompare(b.groupName)),
    })
  }

  hits.sort(
    (a, b) =>
      b.rotators.length - a.rotators.length ||
      a.offerName.localeCompare(b.offerName) ||
      a.offerId.localeCompare(b.offerId),
  )

  if (hits.length === 0) continue

  reports.push({
    funnelId,
    funnelName,
    allowed: isAllowedBrowseFunnel(funnelName),
    rotatorCount: funnelGroups.length,
    duplicateOfferCount: hits.length,
    hits,
  })
}

reports.sort(
  (a, b) =>
    Number(b.allowed) - Number(a.allowed) ||
    b.duplicateOfferCount - a.duplicateOfferCount ||
    a.funnelName.localeCompare(b.funnelName),
)

const out = {
  generatedAt: new Date().toISOString(),
  funnelWithDupCount: reports.length,
  allowedFunnelWithDupCount: reports.filter((r) => r.allowed).length,
  totalDupOfferPlacements: reports.reduce((sum, r) => sum + r.duplicateOfferCount, 0),
  reports,
}

const jsonPath = path.join(root, 'tmp/intra-funnel-dup-offers.json')
const txtPath = path.join(root, 'tmp/intra-funnel-dup-offers.txt')
fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), 'utf8')

const lines: string[] = []
lines.push(`# 同一漏斗内、不同 rotator 复用同一 offer`)
lines.push(`生成时间: ${out.generatedAt}`)
lines.push(
  `有复用的漏斗: ${out.funnelWithDupCount}（白名单 ${out.allowedFunnelWithDupCount}）· 复用 offer 条数合计: ${out.totalDupOfferPlacements}`,
)
lines.push('')

for (const report of reports) {
  lines.push(
    `## ${report.funnelName}${report.allowed ? '' : '（非白名单）'}  · funnelId=${report.funnelId}`,
  )
  lines.push(
    `rotator 数 ${report.rotatorCount} · 跨 rotator 复用的 offer ${report.duplicateOfferCount} 个`,
  )
  for (const hit of report.hits) {
    const rotatorText = hit.rotators
      .map((r) => `${r.groupName}[${r.groupId}]`)
      .join(' | ')
    lines.push(
      `- ${hit.offerName} (${hit.offerId}) · geo=${hit.geo} · 品类=${hit.categoryName} · 出现在 ${hit.rotators.length} 个 rotator: ${rotatorText}`,
    )
  }
  lines.push('')
}

fs.writeFileSync(txtPath, lines.join('\n'), 'utf8')
console.log(JSON.stringify({
  funnelWithDupCount: out.funnelWithDupCount,
  allowedFunnelWithDupCount: out.allowedFunnelWithDupCount,
  totalDupOfferPlacements: out.totalDupOfferPlacements,
  jsonPath,
  txtPath,
  allowedSummary: reports
    .filter((r) => r.allowed)
    .map((r) => ({
      funnelName: r.funnelName,
      duplicateOfferCount: r.duplicateOfferCount,
      sample: r.hits.slice(0, 3).map((h) => ({
        offerId: h.offerId,
        offerName: h.offerName,
        rotatorCount: h.rotators.length,
        rotators: h.rotators.map((x) => x.groupName),
      })),
    })),
}, null, 2))
