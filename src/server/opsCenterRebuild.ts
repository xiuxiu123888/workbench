import type { FlatStatsOfferRow } from '../api/flatStats'
import type { FunnelDetail, FunnelListItem } from '../api/ruoyiFunnel'
import { buildOpsCenterReport, type OpsCenterReport, type SyncedGroup } from '../domain/opsCenter'
import { readOpsCenterJson, writeOpsCenterJson } from './opsCenterStore'

interface LocalListFile {
  data?: FunnelListItem[]
}

interface LocalMetricsFile {
  day?: string
  statsList?: FlatStatsOfferRow[]
}

interface LocalMeta {
  primaryDay?: string
  metricDays?: string[]
  pulledAt?: string
}

export function rebuildOpsCenterReportFromDisk(projectRoot: string): OpsCenterReport {
  const meta = readOpsCenterJson<LocalMeta>(projectRoot, 'meta.json') || {}
  const listFile = readOpsCenterJson<LocalListFile>(projectRoot, 'raw/list.json')
  const funnels = listFile?.data
  if (!Array.isArray(funnels) || !funnels.length) {
    throw new Error('本地还没有 raw/list.json，请先同步一次')
  }

  const groups = readOpsCenterJson<SyncedGroup[]>(projectRoot, 'raw/groups.json')
  if (!Array.isArray(groups) || !groups.length) {
    throw new Error('本地还没有 raw/groups.json，请先同步一次')
  }

  const details = readOpsCenterJson<FunnelDetail[]>(projectRoot, 'raw/details.json') || []
  const primaryDay = meta.primaryDay || new Date().toISOString().slice(0, 10)
  const metrics = readOpsCenterJson<LocalMetricsFile>(projectRoot, `metrics/${primaryDay}/all.json`)
  const flatStats = Array.isArray(metrics?.statsList) ? metrics.statsList : []
  if (!flatStats.length) {
    throw new Error(`本地还没有 metrics/${primaryDay}/all.json，请先同步一次`)
  }

  const report = buildOpsCenterReport({
    funnels,
    details: Array.isArray(details) ? details : [],
    groups,
    flatStats,
    primaryDay,
    metricDays: meta.metricDays || [primaryDay],
    pulledAt: meta.pulledAt || new Date().toISOString(),
  })

  writeOpsCenterJson(projectRoot, 'report.json', report)
  writeOpsCenterJson(projectRoot, 'meta.json', {
    ...meta,
    rebuiltAt: new Date().toISOString(),
    primaryDay,
    funnelCount: report.funnelCount,
    groupCount: report.groupCount,
    offerCount: report.offerCount,
    matchedOfferCount: report.matchedOfferCount,
    replaceAdviceCount: report.replaceAdvice.length,
    funnelReplaceCount: report.funnelReplaceSummaries.length,
  })

  return report
}
