import { formatMoney } from './report'
import type { JoinedOffer } from './opsCenter'

export interface CategorySuggestion {
  categoryName: string
  revenue: number
  visits: number
  funnelClicks: number
  conversion: number
  funnelRpmAvg: number
  score: number
}

export interface ReplaceAdviceItem {
  funnelId: string
  funnelName: string
  partnerName: string | null
  urlName: string | null
  geo: string | null
  offerId: string
  offerName: string
  channelId: string | null
  currentCategory: string
  reasons: string[]
  severity: 'high' | 'medium'
  visits: number
  revenue: number
  funnelRpm: number
  funnelCtr: number
  conversion: number
  funnelClicks: number
  suggestCategories: CategorySuggestion[]
}

export interface FunnelReplaceSummary {
  funnelId: string
  funnelName: string
  partnerName: string | null
  urlName: string | null
  weakOfferCount: number
  highSeverityCount: number
  visits: number
  revenue: number
  currentCategories: string[]
  suggestCategories: string[]
  sampleReasons: string[]
}

function label(value: string | null | undefined, empty = '(未填)'): string {
  const text = String(value ?? '').trim()
  return text || empty
}

function percentile(values: number[], p: number): number {
  if (!values.length) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[index]
}

function trafficOf(row: JoinedOffer): number {
  return Math.max(row.visits, row.funnelClicks)
}

function categoryPool(rows: JoinedOffer[]): CategorySuggestion[] {
  const map = new Map<string, JoinedOffer[]>()
  for (const row of rows) {
    const key = label(row.categoryName, '(无品类)')
    if (key === '(无品类)' || key === '(未填)') {
      continue
    }
    const bucket = map.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      map.set(key, [row])
    }
  }
  return [...map.entries()]
    .map(([categoryName, items]) => {
      const revenue = items.reduce((n, row) => n + row.revenue, 0)
      const visits = items.reduce((n, row) => n + row.visits, 0)
      const funnelClicks = items.reduce((n, row) => n + row.funnelClicks, 0)
      const conversion = items.reduce((n, row) => n + row.conversion, 0)
      const funnelRpmAvg = items.length
        ? items.reduce((n, row) => n + row.funnelRpm, 0) / items.length
        : 0
      return {
        categoryName,
        revenue,
        visits,
        funnelClicks,
        conversion,
        funnelRpmAvg,
        score: revenue * 2 + funnelClicks * 0.01 + conversion,
      }
    })
    .sort((a, b) => b.score - a.score || b.revenue - a.revenue || a.categoryName.localeCompare(b.categoryName))
}

/** 有流量但变现/转化偏弱 → 待换；建议品类取同国家（不足则同合作方/全局）头部。 */
export function buildReplaceAdvice(joined: JoinedOffer[], limit = 40): {
  items: ReplaceAdviceItem[]
  funnelSummaries: FunnelReplaceSummary[]
} {
  const active = joined.filter((row) => row.hasFlatStats && trafficOf(row) > 0)
  if (!active.length) {
    return { items: [], funnelSummaries: [] }
  }

  const trafficValues = active.map(trafficOf)
  const trafficMedian = percentile(trafficValues, 0.5)
  const trafficFloor = Math.max(trafficMedian * 0.8, percentile(trafficValues, 0.4))

  const byGeo = new Map<string, JoinedOffer[]>()
  const byPartner = new Map<string, JoinedOffer[]>()
  for (const row of active) {
    const geo = label(row.geo, '(默认/未标)')
    const partner = label(row.partnerName)
    ;(byGeo.get(geo) ?? (byGeo.set(geo, []), byGeo.get(geo)!)).push(row)
    ;(byPartner.get(partner) ?? (byPartner.set(partner, []), byPartner.get(partner)!)).push(row)
  }

  const geoMedianRevenue = new Map<string, number>()
  const geoMedianRpm = new Map<string, number>()
  const geoMedianCtr = new Map<string, number>()
  for (const [geo, rows] of byGeo) {
    geoMedianRevenue.set(geo, percentile(rows.map((row) => row.revenue), 0.5))
    geoMedianRpm.set(geo, percentile(rows.map((row) => row.funnelRpm), 0.5))
    geoMedianCtr.set(geo, percentile(rows.map((row) => row.funnelCtr), 0.5))
  }

  const globalCategoryPool = categoryPool(active)
  const items: ReplaceAdviceItem[] = []

  for (const row of active) {
    if (trafficOf(row) < trafficFloor) {
      continue
    }

    const geo = label(row.geo, '(默认/未标)')
    const currentCategory = label(row.categoryName, '(无品类)')
    const medianRev = geoMedianRevenue.get(geo) ?? 0
    const medianRpm = geoMedianRpm.get(geo) ?? 0
    const medianCtr = geoMedianCtr.get(geo) ?? 0
    const reasons: string[] = []

    if (row.visits > 0 && row.conversion <= 0) {
      reasons.push(`有访问(${Math.round(row.visits)})但转化=0`)
    }
    if (medianRev > 0 && row.revenue <= medianRev * 0.4) {
      reasons.push(
        `收入 $${formatMoney(row.revenue)} 低于同国家中位 $${formatMoney(medianRev)} 的 40%`,
      )
    } else if (row.revenue <= 0 && trafficOf(row) >= trafficFloor) {
      reasons.push('有流量但收入为 0')
    }
    if (medianRpm > 0 && row.funnelRpm <= medianRpm * 0.4) {
      reasons.push(
        `Funnel RPM ${formatMoney(row.funnelRpm)} 低于同国家中位 ${formatMoney(medianRpm)} 的 40%`,
      )
    }
    if (medianCtr > 0 && row.funnelCtr <= medianCtr * 0.5) {
      reasons.push(
        `漏斗 CTR ${formatMoney(row.funnelCtr)} 低于同国家中位 ${formatMoney(medianCtr)} 的 50%`,
      )
    }

    if (!reasons.length) {
      continue
    }

    const geoPool = categoryPool(byGeo.get(geo) || [])
    const partnerPool = categoryPool(byPartner.get(label(row.partnerName)) || [])
    const pool = (geoPool.length >= 3 ? geoPool : partnerPool.length ? partnerPool : globalCategoryPool).filter(
      (item) => item.categoryName !== currentCategory,
    )
    const suggestCategories = pool.slice(0, 3)
    if (!suggestCategories.length) {
      continue
    }

    const severity: 'high' | 'medium' =
      row.revenue <= 0 || row.conversion <= 0 || reasons.length >= 2 ? 'high' : 'medium'

    items.push({
      funnelId: row.funnelId,
      funnelName: row.funnelName,
      partnerName: row.partnerName,
      urlName: row.urlName,
      geo: row.geo,
      offerId: row.offerId,
      offerName: row.offerName,
      channelId: row.channelId ?? null,
      currentCategory,
      reasons,
      severity,
      visits: row.visits,
      revenue: row.revenue,
      funnelRpm: row.funnelRpm,
      funnelCtr: row.funnelCtr,
      conversion: row.conversion,
      funnelClicks: row.funnelClicks,
      suggestCategories,
    })
  }

  items.sort(
    (a, b) =>
      Number(b.severity === 'high') - Number(a.severity === 'high') ||
      b.visits - a.visits ||
      a.revenue - b.revenue ||
      a.funnelName.localeCompare(b.funnelName),
  )

  const limited = items.slice(0, limit)
  const byFunnel = new Map<string, ReplaceAdviceItem[]>()
  for (const item of limited) {
    const bucket = byFunnel.get(item.funnelId)
    if (bucket) {
      bucket.push(item)
    } else {
      byFunnel.set(item.funnelId, [item])
    }
  }

  const funnelSummaries: FunnelReplaceSummary[] = [...byFunnel.entries()]
    .map(([funnelId, rows]) => {
      const suggest = new Map<string, number>()
      for (const row of rows) {
        for (const [index, cat] of row.suggestCategories.entries()) {
          suggest.set(cat.categoryName, (suggest.get(cat.categoryName) || 0) + (3 - index))
        }
      }
      return {
        funnelId,
        funnelName: rows[0].funnelName,
        partnerName: rows[0].partnerName,
        urlName: rows[0].urlName,
        weakOfferCount: rows.length,
        highSeverityCount: rows.filter((row) => row.severity === 'high').length,
        visits: rows.reduce((n, row) => n + row.visits, 0),
        revenue: rows.reduce((n, row) => n + row.revenue, 0),
        currentCategories: [...new Set(rows.map((row) => row.currentCategory))],
        suggestCategories: [...suggest.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([name]) => name),
        sampleReasons: [...new Set(rows.flatMap((row) => row.reasons))].slice(0, 3),
      }
    })
    .sort(
      (a, b) =>
        b.highSeverityCount - a.highSeverityCount ||
        b.weakOfferCount - a.weakOfferCount ||
        b.visits - a.visits ||
        a.funnelName.localeCompare(b.funnelName),
    )

  return { items: limited, funnelSummaries }
}

export function formatReplaceAdviceLines(summaries: FunnelReplaceSummary[], items: ReplaceAdviceItem[]): string[] {
  const lines: string[] = []
  if (!summaries.length) {
    lines.push('暂无需要换文的漏斗（有流量且明显弱于同国家中位的 offer）')
    return lines
  }
  lines.push(`待换漏斗 ${summaries.length} 个 · 弱 offer ${items.length} 条`)
  for (const row of summaries.slice(0, 12)) {
    lines.push(
      `${row.funnelName}：当前[${row.currentCategories.join('、')}] → 建议[${row.suggestCategories.join('、')}]；${row.sampleReasons[0] || ''}`,
    )
  }
  return lines
}
