import { fetchFlatStats, type FlatStatsOfferRow } from './flatStats'
import {
  loadOpsCenterReportLocal,
  rebuildOpsCenterReportLocal,
  saveOpsCenterMeta,
  saveOpsCenterReportLocal,
  writeOpsCenterBatch,
  writeOpsCenterFile,
} from './opsCenterLocal'
import {
  getFunnelDetail,
  getOfferGroupById,
  listFunnels,
  type FunnelDetail,
  type FunnelListItem,
} from './ruoyiFunnel'
import {
  buildOpsCenterReport,
  mapPool,
  type OpsCenterReport,
  type SyncedGroup,
} from '../domain/opsCenter'
import type { HourlySnapshot } from '../domain/opsCenterHourly'
import { shanghaiDay, shanghaiDayBounds, shiftShanghaiDay } from '../domain/opsCenterTime'

export interface SyncOpsCenterOptions {
  concurrency?: number
  onProgress?: (message: string) => void
  /** 默认今天（上海时区）；可传入 YYYY-MM-DD */
  day?: string
  /** 是否同时拉昨天指标，默认 true */
  includeYesterday?: boolean
}

export async function syncOpsCenterReport(options: SyncOpsCenterOptions = {}): Promise<OpsCenterReport> {
  const concurrency = options.concurrency ?? 4
  const onProgress = options.onProgress
  const primaryDay = options.day || shanghaiDay()
  const days = options.includeYesterday === false ? [primaryDay] : [primaryDay, shiftShanghaiDay(primaryDay, -1)]

  onProgress?.('正在拉取漏斗列表…')
  const funnels = await listFunnels()
  await writeOpsCenterFile('raw/list.json', { code: 200, data: funnels, pulledAt: new Date().toISOString() })
  onProgress?.(`已落盘漏斗列表 ${funnels.length} 条，开始拉详情…`)

  const details = await mapPool(
    funnels,
    concurrency,
    async (funnel) => getFunnelDetail(funnel.funnelId),
    (done, total) => onProgress?.(`漏斗详情 ${done}/${total}`),
  )

  const detailFiles = details.map((detail, index) => ({
    path: `raw/detail-${funnels[index].funnelId}.json`,
    data: { code: 200, data: detail },
  }))
  await writeOpsCenterBatch([
    ...detailFiles,
    { path: 'raw/details.json', data: details },
  ])

  const jobs: Array<{
    funnel: FunnelListItem
    detail: FunnelDetail
    groupId: string
  }> = []
  for (let i = 0; i < funnels.length; i += 1) {
    const funnel = funnels[i]
    const detail = details[i]
    for (const group of detail.offerGroupList || []) {
      jobs.push({ funnel, detail, groupId: group.groupId })
    }
  }

  onProgress?.(`共 ${jobs.length} 个页面组，开始拉 offer 并落盘…`)
  const groups = await mapPool(
    jobs,
    concurrency,
    async (job) => {
      const group = await getOfferGroupById(job.groupId)
      const synced: SyncedGroup = {
        ...group,
        funnelId: job.funnel.funnelId,
        funnelName: job.funnel.funnelName,
        partnerName: job.funnel.partnerName ?? null,
        urlName: job.funnel.urlName ?? null,
        urlId: job.funnel.urlId ?? null,
        platform: job.funnel.platform ?? null,
      }
      await writeOpsCenterFile(`raw/group-${job.groupId}.json`, { code: 200, data: synced })
      return synced
    },
    (done, total) => onProgress?.(`页面组 ${done}/${total}`),
  )
  await writeOpsCenterFile('raw/groups.json', groups)

  const flatStats: FlatStatsOfferRow[] = []
  for (const day of days) {
    const bounds = shanghaiDayBounds(day)
    onProgress?.(`正在拉 ${day} flatStats（按漏斗）…`)
    const dayRows = await mapPool(
      funnels,
      Math.min(concurrency, 3),
      async (funnel) => {
        const result = await fetchFlatStats({
          startTime: bounds.startTime,
          endTime: bounds.endTime,
          filterIds: [funnel.funnelId],
          filterIdType: 'funnel',
          statsType: 'offer',
          reportTimezone: 'UTC+08:00',
          includeAfsMetrics: true,
        })
        const payload = {
          funnelId: funnel.funnelId,
          funnelName: funnel.funnelName,
          day,
          query: bounds,
          data: result,
        }
        await writeOpsCenterFile(`metrics/${day}/funnel-${funnel.funnelId}.json`, payload)
        return result.statsList || []
      },
      (done, total) => onProgress?.(`${day} flatStats ${done}/${total}`),
    )
    const merged = dayRows.flat()
    await writeOpsCenterFile(`metrics/${day}/all.json`, {
      day,
      count: merged.length,
      statsList: merged,
    })
    if (day === primaryDay) {
      flatStats.push(...merged)
    }
  }

  onProgress?.('正在生成分析报告并落盘…')
  const report = buildOpsCenterReport({
    funnels,
    details,
    groups,
    flatStats,
    primaryDay,
    metricDays: days,
    pulledAt: new Date().toISOString(),
  })
  await saveOpsCenterReportLocal(report)
  await saveOpsCenterMeta({
    pulledAt: report.pulledAt,
    primaryDay,
    metricDays: days,
    funnelCount: report.funnelCount,
    groupCount: report.groupCount,
    offerCount: report.offerCount,
    matchedOfferCount: report.matchedOfferCount,
    flatStatsCount: flatStats.length,
  })
  onProgress?.(
    `完成：漏斗 ${report.funnelCount} / 组 ${report.groupCount} / offer ${report.offerCount} / 对齐 ${report.matchedOfferCount}`,
  )
  return report
}

export async function loadLatestOpsCenterReport(): Promise<OpsCenterReport | null> {
  return loadOpsCenterReportLocal()
}

/** 不拉远程，只读 data/ops-center 重算报告（含换文建议） */
export async function reanalyzeOpsCenterFromLocal(): Promise<OpsCenterReport> {
  const { report } = await rebuildOpsCenterReportLocal()
  return report
}

export interface CaptureHourlyOptions {
  concurrency?: number
  onProgress?: (message: string) => void
  day?: string
  hour?: string
}

/** 只拉当天 flatStats：写小时快照，并同步刷新 all.json / 总览报告 */
export async function captureOpsCenterHourlySnapshot(
  options: CaptureHourlyOptions = {},
): Promise<HourlySnapshot> {
  const onProgress = options.onProgress
  onProgress?.('正在通过本地服务拍小时点并刷新总览…')
  const response = await fetch('/local-api/ops-center/hourly/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      day: options.day,
      hour: options.hour,
    }),
  })
  const body = (await response.json().catch(() => null)) as {
    message?: string
    snapshot?: {
      day: string
      hour: string
      pulledAt: string
      offerCount: number
      funnelCount: number
      totals: HourlySnapshot['totals']
    }
  } | null
  if (!response.ok || !body?.snapshot) {
    throw new Error(body?.message || '拍小时点失败')
  }
  onProgress?.(body.message || `已保存小时点 ${body.snapshot.day} ${body.snapshot.hour}:00`)
  return {
    day: body.snapshot.day,
    hour: body.snapshot.hour,
    pulledAt: body.snapshot.pulledAt,
    query: shanghaiDayBounds(body.snapshot.day),
    offerCount: body.snapshot.offerCount,
    funnelCount: body.snapshot.funnelCount,
    totals: body.snapshot.totals,
    funnels: [],
    offers: [],
  }
}
