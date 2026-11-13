import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openReportCache } from './reportCacheDb'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-cache-'))
  dirs.push(dir)
  return dir
}

describe('日报缓存数据库', () => {
  it('按文章、渠道和优化师取回，空收入和 0 都保留', () => {
    const filePath = path.join(tempDir(), 'data', 'report-cache.db')
    const store = openReportCache(filePath)
    store.save({
      articles: [
        {
          articleId: '12',
          day: '2026-10-27',
          pageViews: 4,
          keywords: [{ keyword: 'drain ', termClicks: 2, adClicks: 1 }],
        },
        {
          articleId: '12',
          day: '2026-10-20',
          pageViews: 1,
          keywords: [],
        },
        {
          articleId: '99',
          day: '2026-10-27',
          pageViews: 8,
          keywords: [],
        },
      ],
      channels: [
        { channelId: '88', investor: 'jiayao', day: '2026-10-27', revenue: null },
        { channelId: '88', investor: 'jiayao', day: '2026-10-28', revenue: 0 },
        { channelId: '88', investor: 'other', day: '2026-10-27', revenue: 9 },
      ],
    })
    store.save({
      articles: [{ articleId: '12', day: '2026-10-27', pageViews: 6, keywords: [] }],
      channels: [],
    })

    expect(
      store.lookup({
        articleIds: ['12', '99'],
        channelIds: ['88'],
        investor: 'jiayao',
        start: '2026-10-27',
        end: '2026-10-28',
      }),
    ).toEqual({
      articles: [
        { articleId: '12', day: '2026-10-27', pageViews: 6, termClicks: 0, adClicks: 0, keywordCount: 0, keywords: [] },
        { articleId: '99', day: '2026-10-27', pageViews: 8, termClicks: 0, adClicks: 0, keywordCount: 0, keywords: [] },
      ],
      channels: [
        { channelId: '88', investor: 'jiayao', day: '2026-10-27', revenue: null },
        { channelId: '88', investor: 'jiayao', day: '2026-10-28', revenue: 0 },
      ],
    })
    store.close()

    const reopened = openReportCache(filePath)
    expect(
      reopened.lookup({
        articleIds: ['12'],
        channelIds: [],
        investor: 'jiayao',
        start: '2026-10-27',
        end: '2026-10-27',
      }).articles,
    ).toEqual([
      { articleId: '12', day: '2026-10-27', pageViews: 6, termClicks: 0, adClicks: 0, keywordCount: 0, keywords: [] },
    ])
    reopened.close()
  })

  it('旧的文章缓存按错误时间存过，打开时清掉，渠道收入保留', () => {
    const filePath = path.join(tempDir(), 'report-cache.db')
    const store = openReportCache(filePath)
    store.save({
      articles: [{ articleId: '12', day: '2026-10-27', pageViews: 4, keywords: [] }],
      channels: [{ channelId: '88', investor: 'jiayao', day: '2026-10-27', revenue: 3 }],
    })
    store.close()

    const require = createRequire(import.meta.url)
    const sqlite = require(`node:${'sqlite'}`) as {
      DatabaseSync: new (path: string) => { exec: (sql: string) => void; close: () => void }
    }
    const db = new sqlite.DatabaseSync(filePath)
    db.exec(`UPDATE cache_meta SET value = 'text-date'`)
    db.close()

    const reopened = openReportCache(filePath)
    expect(
      reopened.lookup({
        articleIds: ['12'],
        channelIds: ['88'],
        investor: 'jiayao',
        start: '2026-10-27',
        end: '2026-10-27',
      }),
    ).toEqual({
      articles: [],
      channels: [{ channelId: '88', investor: 'jiayao', day: '2026-10-27', revenue: 3 }],
    })
    reopened.close()
  })

  it('按配置记住换下的文章，别的配置互不影响', () => {
    const store = openReportCache(path.join(tempDir(), 'report-cache.db'))
    store.saveConfigArticles([
      { configId: '7', day: '2026-10-29', articleId: '111', channelId: '9', countryCode: 'US' },
      { configId: '8', day: '2026-10-29', articleId: '222', channelId: '3', countryCode: '' },
    ])
    expect(store.lookupConfigArticles('7', '2026-10-29', '2026-10-29')).toEqual([
      { configId: '7', day: '2026-10-29', articleId: '111', channelId: '9', countryCode: 'US' },
    ])
    store.close()
  })
})
