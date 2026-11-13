import { ruoyiReady, serviceConfig } from '../config/env'
import { createClient, unwrapMis } from './http'

const client = ruoyiReady
  ? createClient('/ruoyi-api', serviceConfig.ruoyiToken, '运营中心')
  : null

export interface FunnelListItem {
  funnelId: string
  funnelName: string
  partnerName?: string | null
  urlId?: number | string | null
  urlName?: string | null
  status?: string | null
  autoWeightEnabled?: number | null
  autoWeightExecTimes?: string[] | null
  autoWeightRuleType?: string | null
  platform?: string | null
}

export interface FunnelOfferGroupRef {
  groupId: string
  groupName: string
  geo?: string | null
}

export interface FunnelDetail {
  funnelId: string
  funnelName: string
  partnerName?: string | null
  urlName?: string | null
  urlId?: number | string | null
  offerGroupList?: FunnelOfferGroupRef[] | null
}

export interface FunnelOfferItem {
  offerId: string
  offerName: string
  categoryName?: string | null
  weight?: number | null
  channelId?: string | null
  countryCode?: string | null
  afsSource?: string | null
  todayRpm?: number | null
  todayRev?: number | null
}

export interface FunnelOfferGroup {
  groupId: string
  groupName: string
  routing?: string | null
  geo?: string | null
  yesterdayRpm?: number | null
  yesterdayRev?: number | null
  yesterdayRpmTrend?: number | null
  yesterdayRevTrend?: number | null
  offerList?: FunnelOfferItem[] | null
}

function assertClient() {
  if (!client) {
    throw new Error('运营中心接口尚未配置，请在 .env.local 设置 VITE_RUOYI_API_TARGET / VITE_RUOYI_TOKEN 后重启')
  }
  return client
}

export async function listFunnels(): Promise<FunnelListItem[]> {
  const response = await assertClient().get('/funnel/funnel/list')
  const data = unwrapMis<FunnelListItem[] | null>(response.data)
  return Array.isArray(data) ? data : []
}

export async function getFunnelDetail(funnelId: string): Promise<FunnelDetail> {
  const response = await assertClient().get('/funnel/funnel/detail', {
    params: { funnelId },
  })
  return unwrapMis<FunnelDetail>(response.data)
}

export async function getOfferGroupById(groupId: string): Promise<FunnelOfferGroup> {
  const response = await assertClient().get('/funnel/offerGroup/getById', {
    params: { groupId },
  })
  return unwrapMis<FunnelOfferGroup>(response.data)
}
