import {
  normalizeCacheBatch,
  normalizeConfigArticles,
  type ArticleDaySnapshot,
  type CacheLookup,
  type ChannelDaySnapshot,
  type ConfigArticleRecord,
} from '../domain/reportCache'

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body = (await response.json()) as { message?: string }
    if (body.message) {
      message = body.message
    }
  } catch {
    message = fallback
  }
  throw new Error(message)
}

export async function lookupReportCache(query: CacheLookup): Promise<{
  articles: ArticleDaySnapshot[]
  channels: ChannelDaySnapshot[]
}> {
  const response = await fetch('/local-api/report-cache/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  })
  if (!response.ok) {
    return readError(response, '读取本地日报失败')
  }
  return normalizeCacheBatch(await response.json())
}

export async function lookupConfigArticles(query: {
  configId: string
  start: string
  end: string
}): Promise<ConfigArticleRecord[]> {
  const response = await fetch('/local-api/report-cache/membership/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  })
  if (!response.ok) {
    return readError(response, '读取换下的文章失败')
  }
  const body = (await response.json()) as { articles?: unknown }
  return normalizeConfigArticles(body.articles ?? [])
}

export async function saveConfigArticles(articles: ConfigArticleRecord[]): Promise<void> {
  if (articles.length === 0) {
    return
  }
  const response = await fetch('/local-api/report-cache/membership', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articles }),
  })
  if (!response.ok) {
    return readError(response, '记下换下的文章失败')
  }
}

export async function saveReportCache(batch: {
  articles: ArticleDaySnapshot[]
  channels: ChannelDaySnapshot[]
}): Promise<void> {
  if (batch.articles.length === 0 && batch.channels.length === 0) {
    return
  }
  const response = await fetch('/local-api/report-cache', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  })
  if (!response.ok) {
    return readError(response, '写入本地日报失败')
  }
}
