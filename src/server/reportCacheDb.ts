import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import {
  encodeArticleKeywords,
  normalizeCacheBatch,
  normalizeCacheLookup,
  type ArticleDaySnapshot,
  type CacheBatch,
  type CacheLookup,
  type ChannelDaySnapshot,
  type ConfigArticleRecord,
} from '../domain/reportCache'

interface SqlStatement {
  all: (...params: Array<string | number | null>) => CacheRow[]
  run: (...params: Array<string | number | null>) => void
}

interface SqliteDatabase {
  exec: (sql: string) => void
  prepare: (sql: string) => SqlStatement
  close: () => void
}

interface CacheRow {
  article_id?: string
  channel_id?: string
  investor?: string
  day: string
  page_views?: number
  keywords_json?: string
  revenue?: number | null
  value?: string
  config_id?: string
  country_code?: string
}

const ARTICLE_CLOCK_KEY = 'article-clock'
const ARTICLE_CLOCK_VALUE = 'local-epoch'

function openDatabase(filePath: string): SqliteDatabase {
  const require = createRequire(import.meta.url)
  const sqlite = require(`node:${'sqlite'}`) as {
    DatabaseSync: new (path: string) => SqliteDatabase
  }
  return new sqlite.DatabaseSync(filePath)
}

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS article_day (
    article_id TEXT NOT NULL,
    day TEXT NOT NULL,
    page_views INTEGER NOT NULL,
    keywords_json TEXT NOT NULL,
    PRIMARY KEY (article_id, day)
  );
  CREATE TABLE IF NOT EXISTS channel_day (
    channel_id TEXT NOT NULL,
    investor TEXT NOT NULL,
    day TEXT NOT NULL,
    revenue REAL,
    PRIMARY KEY (channel_id, investor, day)
  );
  CREATE TABLE IF NOT EXISTS cache_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config_article (
    config_id TEXT NOT NULL,
    day TEXT NOT NULL,
    article_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    country_code TEXT NOT NULL,
    PRIMARY KEY (config_id, day, article_id)
  );
`

export class ReportCacheStore {
  private db: SqliteDatabase

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.db = openDatabase(filePath)
    this.db.exec(CREATE_SQL)
    this.resetArticleDaysIfClockChanged()
  }

  lookup(input: CacheLookup): CacheBatch {
    const query = normalizeCacheLookup(input)
    return {
      articles: this.lookupArticles(query),
      channels: this.lookupChannels(query),
    }
  }

  save(input: CacheBatch): void {
    const batch = normalizeCacheBatch(input)
    this.db.exec('BEGIN')
    try {
      const insertArticle = this.db.prepare(
        `INSERT OR REPLACE INTO article_day (article_id, day, page_views, keywords_json)
         VALUES (?, ?, ?, ?)`,
      )
      for (const row of batch.articles) {
        insertArticle.run(row.articleId, row.day, row.pageViews, encodeArticleKeywords(row))
      }
      const insertChannel = this.db.prepare(
        `INSERT OR REPLACE INTO channel_day (channel_id, investor, day, revenue)
         VALUES (?, ?, ?, ?)`,
      )
      for (const row of batch.channels) {
        insertChannel.run(row.channelId, row.investor, row.day, row.revenue)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  lookupConfigArticles(configId: string, start: string, end: string): ConfigArticleRecord[] {
    const rows = this.db
      .prepare(
        `SELECT config_id, day, article_id, channel_id, country_code
         FROM config_article
         WHERE config_id = ? AND day >= ? AND day <= ?
         ORDER BY day, article_id`,
      )
      .all(configId, start, end)
    return rows.map((row) => ({
      configId: String(row.config_id ?? ''),
      day: row.day,
      articleId: String(row.article_id ?? ''),
      channelId: String(row.channel_id ?? ''),
      countryCode: String(row.country_code ?? ''),
    }))
  }

  saveConfigArticles(rows: ConfigArticleRecord[]): void {
    if (rows.length === 0) {
      return
    }
    this.db.exec('BEGIN')
    try {
      const insert = this.db.prepare(
        `INSERT OR REPLACE INTO config_article (config_id, day, article_id, channel_id, country_code)
         VALUES (?, ?, ?, ?, ?)`,
      )
      for (const row of rows) {
        insert.run(row.configId, row.day, row.articleId, row.channelId, row.countryCode)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.db.close()
  }

  private resetArticleDaysIfClockChanged() {
    const found = this.db.prepare('SELECT value FROM cache_meta WHERE key = ?').all(ARTICLE_CLOCK_KEY)
    if (found[0]?.value === ARTICLE_CLOCK_VALUE) {
      return
    }
    this.db.exec('DELETE FROM article_day')
    this.db.prepare('INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)').run(ARTICLE_CLOCK_KEY, ARTICLE_CLOCK_VALUE)
  }

  private lookupArticles(query: CacheLookup): ArticleDaySnapshot[] {
    const rows = this.selectIn(
      `SELECT article_id, day, page_views, keywords_json
       FROM article_day
       WHERE day >= ? AND day <= ? AND article_id IN (`,
      query.articleIds,
      [query.start, query.end],
    )
    const articles: ArticleDaySnapshot[] = []
    for (const row of rows) {
      let keywords: unknown
      try {
        keywords = JSON.parse(String(row.keywords_json ?? ''))
      } catch {
        continue
      }
      try {
        const [snapshot] = normalizeCacheBatch({
          articles: [
            {
              articleId: row.article_id,
              day: row.day,
              pageViews: row.page_views,
              keywords,
            },
          ],
        }).articles
        if (snapshot) {
          articles.push(snapshot)
        }
      } catch {
        continue
      }
    }
    return articles.sort((a, b) => a.articleId.localeCompare(b.articleId) || a.day.localeCompare(b.day))
  }

  private lookupChannels(query: CacheLookup): ChannelDaySnapshot[] {
    const rows = this.selectIn(
      `SELECT channel_id, investor, day, revenue
       FROM channel_day
       WHERE investor = ? AND day >= ? AND day <= ? AND channel_id IN (`,
      query.channelIds,
      [query.investor, query.start, query.end],
    )
    return normalizeCacheBatch({
      channels: rows.map((row) => ({
        channelId: row.channel_id,
        investor: row.investor,
        day: row.day,
        revenue: row.revenue ?? null,
      })),
    }).channels.sort((a, b) => a.channelId.localeCompare(b.channelId) || a.day.localeCompare(b.day))
  }

  private selectIn(prefix: string, ids: string[], leading: Array<string | number | null>): CacheRow[] {
    if (ids.length === 0) {
      return []
    }
    const rows: CacheRow[] = []
    for (let index = 0; index < ids.length; index += 400) {
      const chunk = ids.slice(index, index + 400)
      const sql = `${prefix}${chunk.map(() => '?').join(',')})`
      rows.push(...this.db.prepare(sql).all(...leading, ...chunk))
    }
    return rows
  }
}

export function openReportCache(filePath: string): ReportCacheStore {
  return new ReportCacheStore(filePath)
}
