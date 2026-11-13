import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import { normalizeCacheBatch, normalizeCacheLookup, normalizeConfigArticleQuery, normalizeConfigArticles } from '../domain/reportCache'
import { openReportCache, type ReportCacheStore } from './reportCacheDb'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > 8_000_000) {
        reject(new Error('日报缓存太大'))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function reportCachePlugin(root: string): Plugin {
  const filePath = path.join(root, 'data', 'report-cache.db')
  let store: ReportCacheStore | null = null

  return {
    name: 'report-cache-db',
    configureServer(server) {
      store = openReportCache(filePath)
      server.httpServer?.on('close', () => {
        store?.close()
        store = null
      })
      server.middlewares.use('/local-api/report-cache', (req, res, next) => {
        void handle(req, res).catch((error: unknown) => {
          if (res.headersSent) {
            next(error)
            return
          }
          const message = error instanceof Error ? error.message : '写入日报缓存失败'
          send(res, 400, { message })
        })
      })
    },
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!store) {
      throw new Error('日报缓存数据库还没有打开')
    }
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    const text = await readBody(req)
    const body = JSON.parse(text || '{}') as unknown
    const route = cacheRoute(req.url)
    if (route === 'members-lookup') {
      const query = normalizeConfigArticleQuery(body)
      send(res, 200, { articles: store.lookupConfigArticles(query.configId, query.start, query.end) })
      return
    }
    if (route === 'members') {
      store.saveConfigArticles(normalizeConfigArticles(body))
      send(res, 200, { ok: true })
      return
    }
    if (route === 'lookup') {
      send(res, 200, store.lookup(normalizeCacheLookup(body)))
      return
    }
    if (route === 'save') {
      store.save(normalizeCacheBatch(body))
      send(res, 200, { ok: true })
      return
    }
    res.statusCode = 404
    res.end()
  }
}

function cacheRoute(url: string | undefined): 'lookup' | 'save' | 'members' | 'members-lookup' | '' {
  const raw = (url ?? '').split('?')[0] ?? ''
  if (raw === '/membership/lookup' || raw === '/local-api/report-cache/membership/lookup') {
    return 'members-lookup'
  }
  if (raw === '/membership' || raw === '/local-api/report-cache/membership') {
    return 'members'
  }
  if (raw === '/lookup' || raw === '/local-api/report-cache/lookup') {
    return 'lookup'
  }
  if (raw === '/' || raw === '' || raw === '/local-api/report-cache' || raw === '/local-api/report-cache/') {
    return 'save'
  }
  return ''
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
