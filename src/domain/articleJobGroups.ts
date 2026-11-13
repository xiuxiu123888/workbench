import { bareDomain, type ArticleJobResultItem, type StoredArticleJob } from './articleJobStore'
import { buildDirectLandingUrl, channelFromUrl } from './campaignForm'

export interface JobArticleRow {
  key: string
  job: StoredArticleJob
  item: ArticleJobResultItem
  index: number
  domain: string
  accountId: string
  countryCode: string
  articleId: string
  channelId: string
  link: string
  writable: boolean
  written: boolean
  pending: boolean
}

export interface JobCountryGroup {
  countryCode: string
  articles: JobArticleRow[]
}

export interface JobSiteGroup {
  key: string
  categoryId: number
  accountId: string
  domain: string
  title: string
  countries: JobCountryGroup[]
  writableCount: number
  writtenCount: number
  totalCount: number
  pendingCount: number
  taskIds: string[]
  statusSummary: string
}

function resultKey(job: StoredArticleJob, item: ArticleJobResultItem, index: number): string {
  return `${job.taskId}:${item.id ?? `${item.domain}-${item.article_number ?? index}`}`
}

function canWrite(item: ArticleJobResultItem): boolean {
  return String(item.status).toLowerCase() === 'success' && item.article_id != null && String(item.article_id).trim() !== ''
}

function previewLink(job: StoredArticleJob, item: ArticleJobResultItem, channelId: string): string {
  const articleId = String(item.article_id ?? '').trim()
  const domain = bareDomain(item.domain)
  if (!articleId || !domain || !channelId) {
    return ''
  }
  const linkRef = job.refKeyword || job.intentKeyword || job.regionId
  try {
    return buildDirectLandingUrl(domain, articleId, channelId, linkRef)
  } catch {
    return ''
  }
}

/** 无 results 时用创建目标占位，保证创建后立刻能看见任务树 */
function rowsForJob(job: StoredArticleJob): Array<{ item: ArticleJobResultItem; index: number; pending: boolean }> {
  if (job.results.length > 0) {
    return job.results.map((item, index) => ({ item, index, pending: false }))
  }
  return job.targets.map((target, index) => ({
    item: {
      domain: target.domain,
      site_id: target.site_id,
      account_id: target.account_id,
      status: job.status || 'queued',
      article_id: null,
      error_message: job.errorMessage,
    },
    index,
    pending: true,
  }))
}

/** 任务列表：类目+账户+网站 → 国家 → 文章 */
export function buildJobSiteGroups(input: {
  jobs: StoredArticleJob[]
  categoryLabel: (categoryId: number) => string
  accountLabel: (accountId: string) => string
  writtenKeys: Set<string>
  writeLinks: Record<string, string>
}): JobSiteGroup[] {
  type Acc = {
    categoryId: number
    accountId: string
    domain: string
    byCountry: Map<string, JobArticleRow[]>
    taskIds: Set<string>
    statuses: Set<string>
  }
  const groups = new Map<string, Acc>()

  for (const job of input.jobs) {
    for (const { item, index, pending } of rowsForJob(job)) {
      const domain = bareDomain(item.domain)
      if (!domain) {
        continue
      }
      const accountId = String(item.account_id ?? '').trim()
      const categoryId = job.categoryId
      const groupKey = `${categoryId}\n${accountId}\n${domain}`
      let acc = groups.get(groupKey)
      if (!acc) {
        acc = {
          categoryId,
          accountId,
          domain,
          byCountry: new Map(),
          taskIds: new Set(),
          statuses: new Set(),
        }
        groups.set(groupKey, acc)
      }
      acc.taskIds.add(job.taskId)
      acc.statuses.add(String(job.status || 'queued'))
      const key = resultKey(job, item, index)
      const written = input.writtenKeys.has(key)
      const storedLink = String(input.writeLinks[key] ?? '').trim()
      const preferred = job.channelId.trim()
      const channelId = channelFromUrl(storedLink) || preferred
      const link = storedLink || previewLink(job, item, channelId)
      const countryCode = String(job.regionId || '').trim().toUpperCase() || '—'
      const row: JobArticleRow = {
        key,
        job,
        item,
        index,
        domain,
        accountId,
        countryCode,
        articleId: String(item.article_id ?? '').trim(),
        channelId,
        link,
        writable: !pending && canWrite(item),
        written,
        pending,
      }
      const list = acc.byCountry.get(countryCode) ?? []
      list.push(row)
      acc.byCountry.set(countryCode, list)
    }
  }

  return [...groups.entries()]
    .map(([key, acc]) => {
      const countries = [...acc.byCountry.entries()]
        .map(([countryCode, articles]) => ({
          countryCode,
          articles: articles.sort((a, b) => a.articleId.localeCompare(b.articleId) || a.key.localeCompare(b.key)),
        }))
        .sort((a, b) => a.countryCode.localeCompare(b.countryCode))
      const flat = countries.flatMap((country) => country.articles)
      const categoryLabel = input.categoryLabel(acc.categoryId)
      const accountLabel = input.accountLabel(acc.accountId) || acc.accountId || '—'
      const pendingCount = flat.filter((row) => row.pending).length
      return {
        key,
        categoryId: acc.categoryId,
        accountId: acc.accountId,
        domain: acc.domain,
        title: `${categoryLabel} · ${accountLabel} · ${acc.domain}`,
        countries,
        writableCount: flat.filter((row) => row.writable && !row.written).length,
        writtenCount: flat.filter((row) => row.written).length,
        totalCount: flat.length,
        pendingCount,
        taskIds: [...acc.taskIds],
        statusSummary: summarizeStatuses([...acc.statuses]),
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
}

function summarizeStatuses(statuses: string[]): string {
  if (statuses.length === 0) {
    return '排队中'
  }
  if (statuses.every((item) => item === 'success')) {
    return '全部成功'
  }
  if (statuses.every((item) => item === 'failed')) {
    return '失败'
  }
  if (statuses.some((item) => item === 'running' || item === 'queued' || item === 'planning')) {
    return '生成中'
  }
  if (statuses.some((item) => item === 'partial_success' || item === 'failed')) {
    return '部分完成'
  }
  return statuses[0] || '排队中'
}
