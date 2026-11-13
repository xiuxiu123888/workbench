export type ArticleJobStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'success'
  | 'partial_success'
  | 'failed'
  | string

export interface ArticleJobProgress {
  total: number
  completed: number
  success: number
  failed: number
  running: number
}

export interface ArticleJobResultItem {
  id?: number | string
  domain: string
  article_number?: number
  site_id?: number | string
  account_id?: number | string
  status: string
  article_id: number | string | null
  error_code?: string | null
  error_message?: string | null
}

export interface ArticleJobTarget {
  domain: string
  site_id: number | string
  account_id: number | string
}

export interface StoredArticleJob {
  taskId: string
  intentKeyword: string
  /** 落地链接 ref；可与种子词不同 */
  refKeyword: string
  /** 选填渠道；有则写入时直接用，无则复用/MIS */
  channelId: string
  categoryId: number
  languageId: number
  regionId: string
  publish: boolean
  articlesPerDomain: number
  /** 创建时选中的网站；无 results 时也用来展示任务树 */
  targets: ArticleJobTarget[]
  status: ArticleJobStatus
  progress: ArticleJobProgress
  results: ArticleJobResultItem[]
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export const ARTICLE_JOB_STORAGE_KEY = 'workbench.article-jobs.v1'
export const ARTICLE_JOB_STORAGE_LIMIT = 50

const TERMINAL = new Set(['success', 'partial_success', 'failed'])

export function isTerminalJobStatus(status: string): boolean {
  return TERMINAL.has(String(status || '').trim())
}

export function emptyProgress(): ArticleJobProgress {
  return { total: 0, completed: 0, success: 0, failed: 0, running: 0 }
}

function normalizeTargets(raw: unknown): ArticleJobTarget[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: ArticleJobTarget[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    const domain = bareDomain(String(record.domain ?? ''))
    if (!domain) {
      continue
    }
    out.push({
      domain,
      site_id: (record.site_id as number | string | undefined) ?? '',
      account_id: (record.account_id as number | string | undefined) ?? '',
    })
  }
  return out
}

export function normalizeStoredJobs(raw: unknown): StoredArticleJob[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const jobs: StoredArticleJob[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    const taskId = String(record.taskId ?? '').trim()
    if (!taskId) {
      continue
    }
    const progress = record.progress && typeof record.progress === 'object' ? (record.progress as ArticleJobProgress) : emptyProgress()
    const intentKeyword = String(record.intentKeyword ?? '')
    const refRaw = String(record.refKeyword ?? '').trim()
    const categoryRaw = Number(record.categoryId)
    jobs.push({
      taskId,
      intentKeyword,
      refKeyword: refRaw || intentKeyword,
      channelId: String(record.channelId ?? '').trim(),
      categoryId: Number.isFinite(categoryRaw) && categoryRaw > 0 ? Math.floor(categoryRaw) : 0,
      languageId: Number(record.languageId) || 1,
      regionId: String(record.regionId ?? 'US'),
      publish: Boolean(record.publish),
      articlesPerDomain: Math.min(10, Math.max(1, Math.floor(Number(record.articlesPerDomain) || 1))),
      targets: normalizeTargets(record.targets),
      status: String(record.status ?? 'queued'),
      progress: {
        total: Number(progress.total) || 0,
        completed: Number(progress.completed) || 0,
        success: Number(progress.success) || 0,
        failed: Number(progress.failed) || 0,
        running: Number(progress.running) || 0,
      },
      results: Array.isArray(record.results)
        ? record.results.map((row) => {
            const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
            const articleNumber = Number(r.article_number)
            return {
              id: r.id as number | string | undefined,
              domain: String(r.domain ?? ''),
              article_number: Number.isFinite(articleNumber) && articleNumber > 0 ? articleNumber : undefined,
              site_id: r.site_id as number | string | undefined,
              account_id: r.account_id as number | string | undefined,
              status: String(r.status ?? ''),
              article_id: (r.article_id as number | string | null) ?? null,
              error_code: (r.error_code as string | null) ?? null,
              error_message: (r.error_message as string | null) ?? null,
            }
          })
        : [],
      errorMessage: record.errorMessage == null ? null : String(record.errorMessage),
      createdAt: String(record.createdAt ?? ''),
      updatedAt: String(record.updatedAt ?? ''),
    })
  }
  return jobs
}

export function loadArticleJobs(storage: Pick<Storage, 'getItem'> = localStorage): StoredArticleJob[] {
  try {
    const text = storage.getItem(ARTICLE_JOB_STORAGE_KEY)
    if (!text) {
      return []
    }
    return normalizeStoredJobs(JSON.parse(text))
  } catch {
    return []
  }
}

export function saveArticleJobs(jobs: StoredArticleJob[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  const clipped = jobs.slice(0, ARTICLE_JOB_STORAGE_LIMIT)
  storage.setItem(ARTICLE_JOB_STORAGE_KEY, JSON.stringify(clipped))
}

export function upsertArticleJob(jobs: StoredArticleJob[], next: StoredArticleJob): StoredArticleJob[] {
  const index = jobs.findIndex((item) => item.taskId === next.taskId)
  if (index < 0) {
    return [next, ...jobs].slice(0, ARTICLE_JOB_STORAGE_LIMIT)
  }
  const copy = jobs.slice()
  copy[index] = next
  return copy
}

export function removeArticleJob(jobs: StoredArticleJob[], taskId: string): StoredArticleJob[] {
  return jobs.filter((item) => item.taskId !== taskId)
}

export function bareDomain(input: string): string {
  const text = String(input ?? '').trim()
  if (!text) {
    return ''
  }
  try {
    const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`
    return new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return text
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./i, '')
      .toLowerCase()
  }
}
