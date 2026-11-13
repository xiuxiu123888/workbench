import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { normalizeGenerationLog, type GenerationRecord } from '../domain/generationLog'

interface SqliteStatement {
  all: () => GenerationLogRow[]
  run: (...params: Array<string | number>) => void
}

interface SqliteDatabase {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

function openDatabase(filePath: string): SqliteDatabase {
  const require = createRequire(import.meta.url)
  const sqlite = require(`node:${'sqlite'}`) as {
    DatabaseSync: new (path: string) => SqliteDatabase
  }
  return new sqlite.DatabaseSync(filePath)
}

interface GenerationLogRow {
  id: string
  created_at: number
  source_article_id: string
  new_article_id: string
  title: string
  link_ref: string
  url: string
  channel: string
  site_name: string
  article_account: string
  afs_account: string
  ok: number
  message: string
}

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS generation_log (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    source_article_id TEXT NOT NULL,
    new_article_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    link_ref TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT '',
    site_name TEXT NOT NULL DEFAULT '',
    article_account TEXT NOT NULL DEFAULT '',
    afs_account TEXT NOT NULL DEFAULT '',
    ok INTEGER NOT NULL,
    message TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS generation_log_created_at ON generation_log (created_at DESC);
`

export class GenerationLogStore {
  private db: SqliteDatabase

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.db = openDatabase(filePath)
    this.db.exec(CREATE_SQL)
  }

  list(): GenerationRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, created_at, source_article_id, new_article_id, title, link_ref, url, channel,
                site_name, article_account, afs_account, ok, message
         FROM generation_log
         ORDER BY created_at DESC, id DESC`,
      )
      .all()
    return rows.map(toRecord)
  }

  insert(record: GenerationRecord): GenerationRecord {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO generation_log (
           id, created_at, source_article_id, new_article_id, title, link_ref, url, channel,
           site_name, article_account, afs_account, ok, message
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.createdAt,
        record.sourceArticleId,
        record.newArticleId,
        record.title,
        record.linkRef,
        record.url,
        record.channel,
        record.siteName,
        record.articleAccount,
        record.afsAccount,
        record.ok ? 1 : 0,
        record.message,
      )
    return record
  }

  replaceAll(records: GenerationRecord[]): void {
    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM generation_log')
      for (const record of records) {
        this.insert(record)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  clear(): void {
    this.db.exec('DELETE FROM generation_log')
  }

  close(): void {
    this.db.close()
  }
}

export function openGenerationLog(filePath: string): GenerationLogStore {
  return new GenerationLogStore(filePath)
}

export function importLegacyGenerationLog(store: GenerationLogStore, jsonPath: string): void {
  if (store.list().length > 0 || !fs.existsSync(jsonPath)) {
    return
  }
  try {
    const records = normalizeGenerationLog(JSON.parse(fs.readFileSync(jsonPath, 'utf8')))
    if (records.length > 0) {
      store.replaceAll(records)
    }
  } catch {
    // 旧的 JSON 读不出来时，数据库保持空白。
  }
}

function toRecord(row: GenerationLogRow): GenerationRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    sourceArticleId: row.source_article_id,
    newArticleId: row.new_article_id,
    title: row.title,
    linkRef: row.link_ref,
    url: row.url,
    channel: row.channel,
    siteName: row.site_name,
    articleAccount: row.article_account,
    afsAccount: row.afs_account,
    ok: row.ok === 1,
    message: row.message,
  }
}
