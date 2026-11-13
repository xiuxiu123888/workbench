export const DASHBOARD_STORAGE_KEY = 'workbench.dashboard.v2'

export interface DashboardDayMetrics {
  revenue: number | null
  pageViews: number
  termClicks: number
  adClicks: number
  articleCount: number
  channelCount: number
}

export interface DashboardDomainRow {
  domain: string
  accountName: string
  accountSource: string
  yesterday: DashboardDayMetrics
  today: DashboardDayMetrics
  /** 重试合并收入/曝光时用 */
  channelIds?: string[]
  articleIds?: string[]
}

export type DashboardFailureKind = 'config' | 'exposure' | 'revenue' | 'meta'

/** 最近一次刷新的失败请求，仅保留失败；重试成功后移出并把结果并入 totals */
export interface DashboardRequestFailure {
  id: string
  kind: DashboardFailureKind
  target: string
  message: string
  at: string
  configId?: string
  channelId?: string
  source?: string
  articleIds?: string[]
}

export interface DashboardSnapshot {
  refreshedAt: string
  yesterday: string
  today: string
  totals: {
    yesterday: DashboardDayMetrics
    today: DashboardDayMetrics
  }
  domains: DashboardDomainRow[]
  warnings: string[]
  /** 拉取详情超时/失败的运营配置 id，可供单条重试 */
  failedConfigIds?: string[]
  requestFailures?: DashboardRequestFailure[]
}

export function configIdFromWarning(warning: string): string {
  const matched = String(warning ?? '').match(/^配置\s+(\S+)\s+/)
  return matched?.[1] ?? ''
}

export function makeRequestFailure(
  partial: Omit<DashboardRequestFailure, 'id' | 'at'> & { id?: string; at?: string },
): DashboardRequestFailure {
  const at = partial.at ?? new Date().toISOString()
  const id =
    partial.id ??
    `${partial.kind}:${partial.configId || partial.channelId || partial.target}:${at}:${Math.random().toString(36).slice(2, 8)}`
  return {
    ...partial,
    id,
    at,
  }
}

export function emptyDayMetrics(): DashboardDayMetrics {
  return {
    revenue: null,
    pageViews: 0,
    termClicks: 0,
    adClicks: 0,
    articleCount: 0,
    channelCount: 0,
  }
}

export function formatDashboardDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function yesterdayAndToday(now = new Date()): { yesterday: string; today: string } {
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayDate = new Date(todayDate)
  yesterdayDate.setDate(todayDate.getDate() - 1)
  return {
    today: formatDashboardDay(todayDate),
    yesterday: formatDashboardDay(yesterdayDate),
  }
}

/** 两个完整自然日：前天 vs 昨天（用于日环比归因，避免「今日未结束」干扰） */
export function dayBeforeAndYesterday(now = new Date()): {
  dayBefore: string
  yesterday: string
  calendarToday: string
} {
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayDate = new Date(todayDate)
  yesterdayDate.setDate(todayDate.getDate() - 1)
  const dayBeforeDate = new Date(todayDate)
  dayBeforeDate.setDate(todayDate.getDate() - 2)
  return {
    calendarToday: formatDashboardDay(todayDate),
    yesterday: formatDashboardDay(yesterdayDate),
    dayBefore: formatDashboardDay(dayBeforeDate),
  }
}

export function adClickRate(adClicks: number, pageViews: number): number | null {
  if (!Number.isFinite(adClicks) || !Number.isFinite(pageViews) || pageViews <= 0) {
    return null
  }
  return adClicks / pageViews
}

export function sumDayMetrics(rows: DashboardDayMetrics[]): DashboardDayMetrics {
  if (rows.length === 0) {
    return emptyDayMetrics()
  }
  let revenue: number | null = null
  let pageViews = 0
  let termClicks = 0
  let adClicks = 0
  let articleCount = 0
  let channelCount = 0
  for (const row of rows) {
    // 有数就加总；个别域名缺失时仍显示已知合计（飞书汇总同逻辑）
    if (row.revenue != null && Number.isFinite(row.revenue)) {
      revenue = (revenue ?? 0) + row.revenue
    }
    pageViews += row.pageViews
    termClicks += row.termClicks
    adClicks += row.adClicks
    articleCount += row.articleCount
    channelCount += row.channelCount
  }
  return {
    revenue,
    pageViews,
    termClicks,
    adClicks,
    articleCount,
    channelCount,
  }
}

export function loadDashboardSnapshot(storage: Pick<Storage, 'getItem'> = localStorage): DashboardSnapshot | null {
  try {
    const text = storage.getItem(DASHBOARD_STORAGE_KEY)
    if (!text) {
      return null
    }
    const parsed = JSON.parse(text) as DashboardSnapshot
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.domains)) {
      return null
    }
    const failedConfigIds = Array.isArray(parsed.failedConfigIds)
      ? parsed.failedConfigIds.map((id) => String(id)).filter(Boolean)
      : [...new Set((Array.isArray(parsed.warnings) ? parsed.warnings : []).map(configIdFromWarning).filter(Boolean))]
    const requestFailures = Array.isArray(parsed.requestFailures)
      ? parsed.requestFailures.filter((item) => item && typeof item === 'object' && item.kind && item.message)
      : []
    return {
      ...parsed,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
      failedConfigIds,
      requestFailures,
    }
  } catch {
    return null
  }
}

export function saveDashboardSnapshot(
  snapshot: DashboardSnapshot,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(snapshot))
}
