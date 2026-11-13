import type { StoredArticleJob } from './articleJobStore'

/** 编排任务里、落在给定品类集合上的渠道 id（去重） */
export function channelsForCategories(jobs: StoredArticleJob[], categoryIds: Set<string>): string[] {
  const channels = new Set<string>()
  for (const job of jobs) {
    if (!categoryIds.has(String(job.categoryId))) {
      continue
    }
    const channelId = job.channelId.trim()
    if (channelId) {
      channels.add(channelId)
    }
  }
  return [...channels].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}
