import { misReady, serviceConfig } from '../config/env'
import { isHttpUrl, pickSiteName } from '../domain/campaignForm'
import { ApiError, createClient, unwrapMis } from './http'

const client = misReady
  ? createClient('/mis-api', serviceConfig.misToken, 'MIS', {
      ClientID: serviceConfig.misClientId,
    })
  : null

export interface AccountOption {
  label: string
  value: string
}

function assertClient() {
  if (!client) {
    throw new Error('MIS 接口尚未配置')
  }
  return client
}

export async function getAfsAccounts(): Promise<AccountOption[]> {
  const response = await assertClient().get('/system/dict/data/type/afs_account')
  const data = unwrapMis<Array<{ dictLabel?: string; dictValue?: string | number }>>(response.data)
  if (!Array.isArray(data)) {
    return []
  }
  return data
    .map((item) => ({
      label: String(item.dictLabel ?? item.dictValue ?? ''),
      value: String(item.dictValue ?? ''),
    }))
    .filter((item) => item.value)
}

export async function searchSite(articleId: string): Promise<string> {
  const response = await assertClient().get('/funnel/campaign/searchSite', {
    params: { articleId },
  })
  return pickSiteName(unwrapMis<unknown>(response.data))
}

export async function createCampaign(payload: Record<string, unknown>): Promise<string> {
  const response = await assertClient().post('/funnel/campaign/add', payload)
  const data = unwrapMis<unknown>(response.data)
  if (!isHttpUrl(data)) {
    throw new ApiError('创建成功，但返回的链接不是 http/https 地址')
  }
  return String(data).trim()
}
