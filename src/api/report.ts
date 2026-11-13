import { articleReady, serviceConfig } from '../config/env'
import { createClient, ApiError, unwrapArticle, withRequestTimeout } from './http'

const articleClient = articleReady
  ? createClient('/article-api', serviceConfig.articleToken, '运营配置')
  : null

/** 收入 afsData 需 admin 权限 */
const misAdminClient =
  serviceConfig.misTarget && serviceConfig.misAdminToken && serviceConfig.misClientId
    ? createClient('/mis-api', serviceConfig.misAdminToken, 'MIS Admin', {
        ClientID: serviceConfig.misClientId,
      })
    : null

export interface PointRecord {
  keyword?: string | null
  createTime?: string | number | null
  eventType?: string | null
}

interface PointPage {
  records?: PointRecord[]
  total?: number
}

export interface ChannelRevenueRow {
  targetTime?: string | null
  date?: string | null
  revenue?: string | number | null
  estimatedEarnings?: string | number | null
  domain?: string | null
  customChannelId?: string | null
  countryCode?: string | null
  source?: string | number | null
}

const POINT_PAGE_SIZE = 200
const POINT_ROW_LIMIT = 5000
const POINT_COUNT_TIMEOUT_MS = 20000
const POINT_PAGE_TIMEOUT_MS = 45000
const DAILY_STAT_TIMEOUT_MS = 60000
const REVENUE_TIMEOUT_MS = 45000

export interface Subid2DailyKeyword {
  keyword?: string | null
  termClickCount?: number | null
  adClicksCount?: number | null
}

export interface Subid2DailyItem {
  subid2?: string | null
  pageViewCount?: number | null
  termClickCount?: number | null
  adClicksCount?: number | null
  keywordCount?: number | null
  keywords?: Subid2DailyKeyword[] | null
}

export interface Subid2DailyDay {
  date?: string | null
  items?: Subid2DailyItem[] | null
}

function assertArticle() {
  if (!articleClient) {
    throw new ApiError('运营配置接口尚未配置')
  }
  return articleClient
}

function assertMisAdmin() {
  if (!misAdminClient) {
    throw new ApiError('收入接口需要管理员 token，请填写 VITE_MIS_ADMIN_TOKEN')
  }
  return misAdminClient
}

async function postPointPage(body: Record<string, unknown>, timeoutMs: number): Promise<PointPage> {
  return withRequestTimeout(timeoutMs, async (signal) => {
    const response = await assertArticle().post('/websitePointRecord/page', body, {
      timeout: timeoutMs,
      signal,
    })
    return unwrapArticle<PointPage>(response.data) ?? {}
  })
}

export async function countPointRecords(filter: {
  subid2: string
  eventType: string
  createTime: [string, string]
}): Promise<number> {
  const page = await postPointPage(
    {
      pageNum: 1,
      pageSize: 1,
      subid2: filter.subid2,
      eventType: filter.eventType,
      createTime: filter.createTime,
    },
    POINT_COUNT_TIMEOUT_MS,
  )
  return Number(page.total ?? 0)
}

export async function listPointRecords(filter: {
  subid2: string
  eventType: string
  createTime: [string, string]
}): Promise<PointRecord[]> {
  const records: PointRecord[] = []
  let pageNum = 1
  let total = 0
  do {
    const page = await postPointPage(
      {
        pageNum,
        pageSize: POINT_PAGE_SIZE,
        subid2: filter.subid2,
        eventType: filter.eventType,
        createTime: filter.createTime,
      },
      POINT_PAGE_TIMEOUT_MS,
    )
    total = Number(page.total ?? 0)
    const batch = page.records ?? []
    records.push(...batch)
    if (batch.length === 0) {
      break
    }
    pageNum += 1
  } while (records.length < total && records.length < POINT_ROW_LIMIT)

  if (total > POINT_ROW_LIMIT) {
    throw new ApiError('埋点记录太多，请缩短日期后再查')
  }
  return records
}

export async function listSubid2DailyStat(filter: {
  subid2List: string[]
  startDate: string
  endDate: string
  keywordLimit?: number
}): Promise<Subid2DailyDay[]> {
  const subid2List = [...new Set(filter.subid2List.map((id) => id.trim()).filter(Boolean))]
  if (subid2List.length === 0) {
    return []
  }
  return withRequestTimeout(DAILY_STAT_TIMEOUT_MS, async (signal) => {
    const response = await assertArticle().post(
      '/forwardRecord/subid2DailyStat',
      {
        subid2List,
        startDate: filter.startDate,
        endDate: filter.endDate,
        keywordLimit: filter.keywordLimit ?? 20,
      },
      { timeout: DAILY_STAT_TIMEOUT_MS, signal },
    )
    const data = unwrapArticle<Subid2DailyDay[] | null>(response.data)
    return Array.isArray(data) ? data : []
  })
}

function unwrapReportRows(body: unknown): { rows: ChannelRevenueRow[]; total: number } {
  if (!body || typeof body !== 'object') {
    throw new ApiError('请求失败')
  }
  const record = body as {
    code?: number
    msg?: string
    rows?: ChannelRevenueRow[]
    total?: number
    data?: { rows?: ChannelRevenueRow[]; total?: number }
  }
  if (record.code !== 200) {
    throw new ApiError(record.msg || '请求失败')
  }
  if (Array.isArray(record.rows)) {
    return { rows: record.rows, total: Number(record.total ?? record.rows.length) }
  }
  if (Array.isArray(record.data?.rows)) {
    return { rows: record.data.rows, total: Number(record.data.total ?? record.data.rows.length) }
  }
  return { rows: [], total: 0 }
}

export async function listChannelRevenue(filter: {
  customChannelId: string
  start: string
  end: string
  /** 可空：回收只按渠道拉时可不传 */
  source?: string
  /** @deprecated afsData 不再需要 investor；保留参数以免旧调用报错 */
  investor?: string
}): Promise<ChannelRevenueRow[]> {
  const customChannelId = filter.customChannelId.trim()
  if (!customChannelId) {
    return []
  }
  const source = String(filter.source ?? '').trim()
  const rows: ChannelRevenueRow[] = []
  let pageNum = 1
  let total = 0
  do {
    const page = await withRequestTimeout(REVENUE_TIMEOUT_MS, async (signal) => {
      const response = await assertMisAdmin().get('/report/afsData/list', {
        timeout: REVENUE_TIMEOUT_MS,
        signal,
        params: {
          pageNum,
          pageSize: 100,
          date: [filter.start, filter.end],
          filterOpera: true,
          domain: '',
          customChannelId,
          ...(source ? { source } : {}),
        },
        paramsSerializer: { indexes: null },
      })
      return unwrapReportRows(response.data)
    })
    total = page.total
    rows.push(...page.rows)
    if (page.rows.length === 0) {
      break
    }
    pageNum += 1
  } while (rows.length < total && pageNum < 20)
  return rows
}
