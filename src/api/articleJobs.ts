import axios from 'axios'
import { articleReady, serviceConfig } from '../config/env'
import { ApiError, isTimeoutError } from './http'
import type { ArticleJobProgress, ArticleJobResultItem, ArticleJobStatus } from '../domain/articleJobStore'

const client = articleReady
  ? axios.create({
      baseURL: '/article-agent-api',
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'X-Platform-Token': serviceConfig.articleToken,
      },
    })
  : null

client?.interceptors.response.use(
  (response) => response,
  (error) => {
    if (isTimeoutError(error)) {
      throw new ApiError('自动编排接口超时，请稍后重试')
    }
    if (!error.response) {
      throw new ApiError('无法连接自动编排服务，请检查代理或网络')
    }
    if (error.response.status === 401) {
      throw new ApiError('创作平台 Token 失效，请修改 .env.local 后重启', 401)
    }
    const data = error.response.data as { detail?: string; msg?: string; message?: string } | undefined
    throw new ApiError(data?.detail || data?.msg || data?.message || '请求失败', error.response.status)
  },
)

function assertClient() {
  if (!client) {
    throw new Error('运营配置接口尚未配置，无法调用自动编排')
  }
  return client
}

export interface CreateArticleJobInput {
  intentKeyword: string
  categoryId?: number
  languageId: number
  regionId: string
  userId: string
  userName: string
  targets: Array<{ domain: string; site_id: number | string; account_id: number | string }>
  publish: boolean
  articlesPerDomain: number
  idempotencyKey: string
}

export interface ArticleJobDetail {
  task_id: string
  status: ArticleJobStatus
  intent_keyword?: string
  category_id?: number
  language_id?: number
  region_id?: string
  options?: {
    articles_per_domain?: number
    publish?: boolean
  }
  progress?: ArticleJobProgress
  results?: ArticleJobResultItem[]
  error_message?: string | null
  created_at?: string
}

export async function createArticleJob(input: CreateArticleJobInput): Promise<ArticleJobDetail> {
  const articlesPerDomain = Math.min(10, Math.max(1, Math.floor(Number(input.articlesPerDomain) || 1)))
  const categoryId =
    input.categoryId != null && Number.isFinite(Number(input.categoryId)) && Number(input.categoryId) > 0
      ? Math.floor(Number(input.categoryId))
      : 0
  const response = await assertClient().post(
    '/api/v1/admin/article-jobs',
    {
      intent_keyword: input.intentKeyword,
      category_id: categoryId,
      language_id: input.languageId,
      region_id: input.regionId,
      user: {
        user_id: input.userId,
        user_name: input.userName,
      },
      targets: input.targets,
      mode: 'auto',
      callback_url: null,
      options: {
        out_show: false,
        generate_author: true,
        publish: input.publish,
        articles_per_domain: articlesPerDomain,
      },
    },
    {
      headers: {
        'Idempotency-Key': input.idempotencyKey,
      },
    },
  )
  return response.data as ArticleJobDetail
}

export async function getArticleJob(taskId: string): Promise<ArticleJobDetail> {
  const response = await assertClient().get(`/api/v1/admin/article-jobs/${encodeURIComponent(taskId)}`)
  return response.data as ArticleJobDetail
}

export interface ArticleJobItemArticle {
  title?: string | null
  firstP?: string | null
  text?: string | null
  terms?: string[] | null
  metaTitle?: string | null
  metaDescription?: string | null
  image?: string | null
  sources?: string[] | null
}

/** 查看编排任务子项草稿（publish=false 时用） */
export async function getArticleJobItemArticle(
  taskId: string,
  itemId: string | number,
): Promise<ArticleJobItemArticle> {
  const response = await assertClient().get(
    `/api/v1/admin/article-jobs/${encodeURIComponent(taskId)}/items/${encodeURIComponent(String(itemId))}/article`,
  )
  return (response.data || {}) as ArticleJobItemArticle
}

/** 发布编排任务子项，拿到正式 article_id */
export async function publishArticleJobItem(
  taskId: string,
  itemId: string | number,
): Promise<ArticleJobDetail> {
  const response = await assertClient().post(
    `/api/v1/admin/article-jobs/${encodeURIComponent(taskId)}/items/${encodeURIComponent(String(itemId))}/publish`,
  )
  return response.data as ArticleJobDetail
}

export function platformUserFromToken(token: string): { userId: string; userName: string } {
  try {
    const payload = token.split('.')[1]
    if (!payload) {
      return { userId: '1', userName: 'admin' }
    }
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      userId?: string | number
      username?: string
      sub?: string
    }
    return {
      userId: String(json.userId ?? '1'),
      userName: String(json.username || json.sub || 'admin'),
    }
  } catch {
    return { userId: '1', userName: 'admin' }
  }
}
