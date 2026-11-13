import type { FlatStatsOfferRow, FlatStatsResult } from '../api/flatStats'
import { createClient, unwrapMis } from '../api/http'
import type { FunnelListItem } from '../api/ruoyiFunnel'
import { mapPool } from '../domain/opsCenter'
import { buildHourlySnapshot, type HourlySnapshot } from '../domain/opsCenterHourly'
import { shanghaiDay, shanghaiDayBounds, shanghaiHour } from '../domain/opsCenterTime'
import { rebuildOpsCenterReportFromDisk } from './opsCenterRebuild'
import { readOpsCenterJson, writeOpsCenterJson } from './opsCenterStore'

interface LocalListFile {
  data?: FunnelListItem[]
}

export interface HourlyCaptureEnv {
  misTarget: string
  misToken: string
  misClientId: string
}

export async function captureHourlySnapshotToDisk(input: {
  projectRoot: string
  env: HourlyCaptureEnv
  day?: string
  hour?: string
  concurrency?: number
  onProgress?: (message: string) => void
}): Promise<HourlySnapshot> {
  const misTarget = String(input.env.misTarget || '').trim()
  const misToken = String(input.env.misToken || '').trim()
  const misClientId = String(input.env.misClientId || '').trim()
  if (!misTarget || !misToken || !misClientId) {
    throw new Error('缺少 MIS 配置：VITE_MIS_API_TARGET / VITE_MIS_TOKEN / VITE_MIS_CLIENT_ID')
  }

  const day = input.day || shanghaiDay()
  const hour = input.hour || shanghaiHour()
  const bounds = shanghaiDayBounds(day)
  const listFile = readOpsCenterJson<LocalListFile>(input.projectRoot, 'raw/list.json')
  const funnels = Array.isArray(listFile?.data) ? listFile.data : []
  if (!funnels.length) {
    throw new Error('本地还没有 raw/list.json，请先在漏斗总览拉取一次漏斗数据')
  }

  const client = createClient(misTarget, misToken, 'MIS', { ClientID: misClientId })
  const concurrency = Math.min(input.concurrency ?? 3, 3)
  const onProgress = input.onProgress
  onProgress?.(`正在拍 ${day} ${hour}:00 小时点（${funnels.length} 漏斗）…`)

  const statsByFunnelId = new Map<string, FlatStatsOfferRow[]>()
  const merged: FlatStatsOfferRow[] = []
  await mapPool(
    funnels,
    concurrency,
    async (funnel) => {
      const response = await client.post('/landpulse/stat/flatStats', {
        startTime: bounds.startTime,
        endTime: bounds.endTime,
        statsType: 'offer',
        filterIdType: 'funnel',
        filterIds: [funnel.funnelId],
        reportTimezone: 'UTC+08:00',
        includeAfsMetrics: true,
      })
      const result = unwrapMis<FlatStatsResult>(response.data) || { statsList: [] }
      const rows = result.statsList || []
      statsByFunnelId.set(funnel.funnelId, rows)
      merged.push(...rows)
      writeOpsCenterJson(input.projectRoot, `metrics/${day}/funnel-${funnel.funnelId}.json`, {
        funnelId: funnel.funnelId,
        funnelName: funnel.funnelName,
        day,
        query: bounds,
        data: result,
      })
    },
    (done, total) => onProgress?.(`小时 flatStats ${done}/${total}`),
  )

  const pulledAt = new Date().toISOString()
  const snapshot = buildHourlySnapshot({
    day,
    hour,
    query: bounds,
    funnels,
    statsByFunnelId,
    pulledAt,
  })
  writeOpsCenterJson(input.projectRoot, `metrics/${day}/hourly/${hour}.json`, snapshot)
  // 同步刷新总览用的当日累计，避免页面仍显示旧 all.json
  writeOpsCenterJson(input.projectRoot, `metrics/${day}/all.json`, {
    day,
    count: merged.length,
    statsList: merged,
    updatedFromHourly: hour,
    pulledAt,
  })

  const meta = readOpsCenterJson<Record<string, unknown>>(input.projectRoot, 'meta.json') || {}
  const metricDays = Array.isArray(meta.metricDays)
    ? [...new Set([day, ...meta.metricDays.map(String)])]
    : [day]
  writeOpsCenterJson(input.projectRoot, 'meta.json', {
    ...meta,
    pulledAt,
    primaryDay: day,
    metricDays,
    flatStatsCount: merged.length,
    lastHourlyAt: pulledAt,
    lastHourlyHour: hour,
  })

  try {
    rebuildOpsCenterReportFromDisk(input.projectRoot)
    onProgress?.('已同步刷新总览 all.json 与分析报告')
  } catch (error) {
    onProgress?.(
      `小时点已保存，但重算报告失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }

  onProgress?.(
    `已保存小时点 ${day} ${hour}:00 · 漏斗 ${snapshot.funnelCount} · offer ${snapshot.offerCount} · 收入 $${snapshot.totals.revenue.toFixed(2)}`,
  )
  return snapshot
}

/** 距离下一个上海整点的毫秒数（至少 5 秒） */
export function msUntilNextShanghaiHour(now = new Date()): number {
  const day = shanghaiDay(now)
  const hour = Number(shanghaiHour(now))
  const nextHour = hour === 23 ? 0 : hour + 1
  const nextDay = hour === 23 ? shiftDay(day, 1) : day
  const target = shanghaiLocalToUtcMs(nextDay, nextHour, 0, 5)
  const wait = target - now.getTime()
  return Math.max(5_000, wait)
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  utc.setUTCDate(utc.getUTCDate() + delta)
  return utc.toISOString().slice(0, 10)
}

/** 把上海本地日历时间近似转成 UTC ms（按固定 UTC+8） */
function shanghaiLocalToUtcMs(day: string, hour: number, minute: number, second: number): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d, hour - 8, minute, second)
}
