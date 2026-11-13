import { articleReady, serviceConfig } from '../config/env'
import { createClient, unwrapArticle } from './http'

const client = articleReady
  ? createClient('/article-api', serviceConfig.articleToken, '运营配置')
  : null

export interface SiteOption {
  id: number | string
  siteName: string
  siteUrl?: string
  accountId?: number | string
  isPass?: boolean
}

export interface AccountOption {
  id: number | string
  name: string
}

export interface LanguageOption {
  id: number | string
  langCode?: string
  langName?: string
}

export interface CategoryOption {
  id: number | string
  name: string
  alias?: string
  parentId?: number | string | null
}

export interface OperationConfigRow {
  id: number | string
  siteId?: number | string
  siteName?: string
  accountId?: number | string
  isPut?: boolean
  recentArticles?: unknown
}

function assertClient() {
  if (!client) {
    throw new Error('运营配置接口尚未配置')
  }
  return client
}

export async function getSiteList(): Promise<SiteOption[]> {
  const response = await assertClient().get('/site/getAll')
  const data = unwrapArticle<SiteOption[] | null>(response.data)
  return Array.isArray(data) ? data : []
}

export async function getOperationConfigPage(params: {
  pageNum: number
  pageSize: number
  siteId?: number | string
  accountId?: number | string
}): Promise<{ records: OperationConfigRow[]; total: number }> {
  const response = await assertClient().post('/operationConfig/page', params)
  const data = unwrapArticle<{ records?: OperationConfigRow[]; total?: number } | null>(response.data)
  return {
    records: data?.records ?? [],
    total: data?.total ?? 0,
  }
}

export async function getOperationConfigDetail(
  query: number | string | { id?: number | string; site?: string },
): Promise<Record<string, unknown>> {
  const params =
    query != null && typeof query === 'object'
      ? {
          ...(query.id != null && query.id !== '' ? { id: query.id } : {}),
          ...(query.site?.trim() ? { site: query.site.trim() } : {}),
        }
      : { id: query }
  if (params.id == null && !('site' in params && params.site)) {
    throw new Error('获取运营配置详情需要 id 或 site')
  }
  const response = await assertClient().get('/operationConfig/detail', { params })
  const data = unwrapArticle<Record<string, unknown> | null>(response.data)
  return data ?? {}
}

export async function updateOperationConfig(data: Record<string, unknown>): Promise<void> {
  const response = await assertClient().post('/operationConfig/update', data)
  unwrapArticle(response.data)
}

export async function getAccountList(): Promise<AccountOption[]> {
  const response = await assertClient().get('/account/getAll')
  const data = unwrapArticle<AccountOption[] | null>(response.data)
  return Array.isArray(data) ? data : []
}

export async function getLanguageList(): Promise<LanguageOption[]> {
  const response = await assertClient().get('/lang/getAll')
  const data = unwrapArticle<LanguageOption[] | null>(response.data)
  return Array.isArray(data) ? data : []
}

export async function getCategoryList(): Promise<CategoryOption[]> {
  const response = await assertClient().get('/article/allCategoryNew')
  const data = unwrapArticle<CategoryOption[] | null>(response.data)
  return Array.isArray(data) ? data : []
}

export async function copyArticle(id: number | string): Promise<string> {
  const response = await assertClient().post('/article/copyArticle', { id })
  const data = unwrapArticle<unknown>(response.data)
  if (data == null || String(data).trim() === '') {
    throw new Error('复制成功，但没有返回新文章 ID')
  }
  return String(data).trim()
}

export async function getArticleDetail(id: number | string): Promise<Record<string, unknown>> {
  const response = await assertClient().post('/article/detail', { id })
  const data = unwrapArticle<Record<string, unknown> | null>(response.data)
  return data ?? {}
}

export async function updateArticle(data: Record<string, unknown>): Promise<void> {
  const response = await assertClient().post('/article/update', data)
  unwrapArticle(response.data)
}
