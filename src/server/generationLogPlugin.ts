import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import { normalizeGenerationLog } from '../domain/generationLog'
import { importLegacyGenerationLog, openGenerationLog, type GenerationLogStore } from './generationLogDb'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > 2_000_000) {
        reject(new Error('生成记录太大'))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function generationLogPlugin(root: string): Plugin {
  const filePath = path.join(root, 'data', 'generation-log.db')
  let store: GenerationLogStore | null = null

  return {
    name: 'generation-log-db',
    configureServer(server) {
      store = openGenerationLog(filePath)
      importLegacyGenerationLog(store, path.join(root, 'data', 'generation-log.json'))
      server.httpServer?.on('close', () => {
        store?.close()
        store = null
      })
      server.middlewares.use('/local-api/generation-log', (req, res, next) => {
        void handle(req, res).catch((error: unknown) => {
          if (res.headersSent) {
            next(error)
            return
          }
          const message = error instanceof Error ? error.message : '写入生成记录失败'
          send(res, 400, { message })
        })
      })
    },
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!store) {
      throw new Error('生成记录数据库还没有打开')
    }
    if (req.method === 'GET') {
      send(res, 200, store.list())
      return
    }
    if (req.method === 'POST') {
      const text = await readBody(req)
      const [record] = normalizeGenerationLog([JSON.parse(text || '{}')])
      if (!record) {
        throw new Error('生成记录缺少 id 或时间')
      }
      send(res, 200, store.insert(record))
      return
    }
    if (req.method === 'DELETE') {
      store.clear()
      send(res, 200, [])
      return
    }
    res.statusCode = 405
    res.end()
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
