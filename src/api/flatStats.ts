import { misReady, serviceConfig } from '../config/env'
import { createClient, unwrapMis } from './http'

const client = misReady
  ? createClient('/mis-api', serviceConfig.misToken, 'MIS', {
      ClientID: serviceConfig.misClientId,
    })
  : null

export interface FlatStatsCountryInfo {
  countryCode?: string | null
  revenue?: string | number | null
  impressions?: number | null
  rpm?: string | number | null
  funnelClicks?: number | null
  clicks?: number | null
}

export interface FlatStatsOfferRow {
  id: string
  name?: string | null
  categoryId?: string | null
  category?: string | null
  visits?: number | null
  views?: number | null
  conversion?: number | null
  offerSource?: string | null
  revenue?: string | number | null
  funnelImpressions?: number | null
  funnelClicks?: number | null
  clicks?: number | null
  funnelRpm?: string | number | null
  rpc?: string | number | null
  funnelCtr?: string | number | null
  cvr1?: string | number | null
  cvr2?: string | number | null
  url?: string | null
  countryInfos?: FlatStatsCountryInfo[] | null
}

export interface FlatStatsResult {
  categoryList?: Array<{
    categoryId?: string | null
    categoryName?: string | null
    categoryType?: string | null
  }> | null
  statsList?: FlatStatsOfferRow[] | null
}

export interface FlatStatsQuery {
  startTime: string
  endTime: string
  filterIds: string[]
  statsType?: 'offer'
  filterIdType?: 'funnel'
  reportTimezone?: string
  includeAfsMetrics?: boolean
}

function assertClient() {
  if (!client) {
    throw new Error('MIS 接口尚未配置')
  }
  return client
}

export async function fetchFlatStats(query: FlatStatsQuery): Promise<FlatStatsResult> {
  const response = await assertClient().post('/landpulse/stat/flatStats', {
    startTime: query.startTime,
    endTime: query.endTime,
    statsType: query.statsType || 'offer',
    filterIdType: query.filterIdType || 'funnel',
    filterIds: query.filterIds,
    reportTimezone: query.reportTimezone || 'UTC+08:00',
    includeAfsMetrics: query.includeAfsMetrics ?? true,
  })
  return unwrapMis<FlatStatsResult>(response.data) || { statsList: [], categoryList: [] }
}
