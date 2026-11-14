import fs from 'node:fs'
import path from 'node:path'
import { FUNNEL_BROWSE_ALLOWLIST } from '../domain/funnelBrowseAllowlist'
import { listOpsCenterMetricDays, opsCenterRoot, readOpsCenterJson } from './opsCenterStore'

function refArticleId(url: string): string {
  const m = String(url || '').match(/\/detail\/(\d+)/)
  return m?.[1] || ''
}

function funnelFromOfferName(name: string): string {
  const n = String(name || '')
  const hit = FUNNEL_BROWSE_ALLOWLIST.find((f) => n.toLowerCase().startsWith(f.toLowerCase() + '-'))
  return hit || ''
}

export function collectWhitelistArticleIdsForHarvest(
  projectRoot: string,
  statDay: string,
): {
  day: string
  metricsDay: string
  articleIds: string[]
  existingDays: string[]
} {
  const metricDays = listOpsCenterMetricDays(projectRoot)
    .filter((day) =>
      fs.existsSync(path.join(opsCenterRoot(projectRoot), 'metrics', day, 'all.json')),
    )
    .sort((a, b) => b.localeCompare(a))
  const metricsDay = metricDays.includes(statDay) ? statDay : metricDays[0]
  if (!metricsDay) {
    throw new Error('data/ops-center/metrics 下没有 all.json，请先同步漏斗指标')
  }
  const metrics = readOpsCenterJson<{ statsList?: Array<{ name?: string; url?: string }> }>(
    projectRoot,
    `metrics/${metricsDay}/all.json`,
  )
  const allow = new Set(FUNNEL_BROWSE_ALLOWLIST.map((x) => x.toLowerCase()))
  const articleIds = new Set<string>()
  for (const item of metrics?.statsList || []) {
    const funnel = funnelFromOfferName(String(item.name || ''))
    if (!funnel || !allow.has(funnel.toLowerCase())) continue
    if (/default/i.test(String(item.name || ''))) continue
    const id = refArticleId(String(item.url || ''))
    if (id) articleIds.add(id)
  }

  const index = readOpsCenterJson<{ days?: string[] }>(projectRoot, 'keyword-harvest/index.json')
  return {
    day: statDay,
    metricsDay,
    articleIds: [...articleIds],
    existingDays: Array.isArray(index?.days) ? index!.days! : [],
  }
}
