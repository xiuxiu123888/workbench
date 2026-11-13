import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  loadOpsCenterBrowseCatalog,
  loadOpsCenterFunnelDetail,
  loadOpsCenterOfferIndex,
} from './opsCenterBrowse'
import { compareHourlyFromDisk, listHourlySnapshots, loadHourlySnapshot } from './opsCenterHourly'
import {
  captureHourlySnapshotToDisk,
  msUntilNextShanghaiHour,
  type HourlyCaptureEnv,
} from './opsCenterHourlyCapture'
import { rebuildOpsCenterReportFromDisk } from './opsCenterRebuild'
import {
  getArticleStockSummary,
  markStockConsumed,
  orderStockFromOptimizeBatch,
  planStockReplaceRun,
  readyStockItem,
} from './opsCenterArticleStock'
import {
  harvestOptimizeBatch,
  listOptimizeBatches,
  loadOptimizeBatch,
  loadOptimizeSchedule,
  markOptimizeBatchWritten,
  saveOptimizeSchedule,
} from './opsCenterOptimizeBatch'
import { readOpsCenterJson, writeOpsCenterJson } from './opsCenterStore'
import { shanghaiDay, shanghaiHour } from '../domain/opsCenterTime'

function queryOf(url?: string): URLSearchParams {
  const raw = String(url || '')
  const index = raw.indexOf('?')
  return new URLSearchParams(index >= 0 ? raw.slice(index + 1) : '')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > 32_000_000) {
        reject(new Error('运营中心落盘数据太大'))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function routeOf(url?: string): string {
  const pathName = String(url || '').split('?')[0] || ''
  const stripped = pathName
    .replace(/^\/local-api\/ops-center\/?/, '')
    .replace(/^\//, '')
    .trim()
  return stripped || 'index'
}

export interface OpsCenterPluginOptions {
  mis?: HourlyCaptureEnv
  /** 开发服务运行时自动整点拍小时快照，默认 true（有 MIS 配置时） */
  autoHourly?: boolean
}

export function opsCenterPlugin(root: string, options: OpsCenterPluginOptions = {}): Plugin {
  let stopScheduler: (() => void) | null = null

  return {
    name: 'ops-center-store',
    configureServer(server) {
      server.middlewares.use('/local-api/ops-center', (req, res, next) => {
        void handle(req, res).catch((error: unknown) => {
          if (res.headersSent) {
            next(error)
            return
          }
          send(res, 400, {
            message: error instanceof Error ? error.message : '运营中心落盘失败',
          })
        })
      })

      const mis = options.mis
      const autoHourly = options.autoHourly !== false
      if (autoHourly && mis?.misTarget && mis.misToken && mis.misClientId) {
        stopScheduler = startHourlyScheduler(root, mis)
        server.httpServer?.once('close', () => {
          stopScheduler?.()
          stopScheduler = null
        })
      } else if (process.env.VITEST !== 'true') {
        console.log('[ops-hourly] 自动小时快照未启用（缺少 MIS 配置或 OPS_HOURLY_AUTO=0）')
      }
    },
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const route = routeOf(req.url)
    if (req.method === 'GET' && route === 'report') {
      const report = readOpsCenterJson(root, 'report.json')
      const meta = readOpsCenterJson(root, 'meta.json')
      send(res, 200, { report, meta })
      return
    }

    if (req.method === 'GET' && route === 'funnels') {
      send(res, 200, loadOpsCenterBrowseCatalog(root))
      return
    }

    if (req.method === 'GET' && route === 'offers') {
      send(res, 200, loadOpsCenterOfferIndex(root))
      return
    }

    if (req.method === 'GET' && route === 'funnel-offer-drafts') {
      const payload = readOpsCenterJson(root, 'funnel-offer-drafts.json') as
        | { jobs?: unknown[]; count?: number; updatedAt?: string }
        | null
      send(res, 200, {
        updatedAt: payload?.updatedAt ?? null,
        count: Array.isArray(payload?.jobs) ? payload!.jobs!.length : 0,
        jobs: Array.isArray(payload?.jobs) ? payload!.jobs : [],
      })
      return
    }

    if (req.method === 'GET' && route === 'seed-lexicon') {
      const payload = readOpsCenterJson(root, 'seed-lexicon/by-category.json') as Record<
        string,
        unknown
      > | null
      const meta = readOpsCenterJson(root, 'seed-lexicon/meta.json') as Record<string, unknown> | null
      send(res, 200, {
        meta,
        lexicon: payload || { updatedAt: null, categories: [] },
      })
      return
    }

    if (req.method === 'GET' && route === 'offer-tags') {
      const payload = readOpsCenterJson(root, 'offer-tags/by-offer.json') as Record<string, unknown> | null
      send(res, 200, {
        tags: payload || { updatedAt: null, offers: {} },
      })
      return
    }

    if (req.method === 'GET' && route.startsWith('funnels/')) {
      const funnelId = decodeURIComponent(route.slice('funnels/'.length))
      send(res, 200, loadOpsCenterFunnelDetail(root, funnelId))
      return
    }

    if (req.method === 'GET' && route === 'hourly') {
      const query = queryOf(req.url)
      const day = String(query.get('day') || '').trim()
      if (!day) {
        send(res, 400, { message: '缺少 day' })
        return
      }
      send(res, 200, { day, hours: listHourlySnapshots(root, day) })
      return
    }

    if (req.method === 'GET' && route === 'hourly/compare') {
      const query = queryOf(req.url)
      const day = String(query.get('day') || '').trim()
      const currentHour = String(query.get('current') || '').trim()
      const baselineHour = String(query.get('baseline') || '').trim()
      if (!day || !currentHour) {
        send(res, 400, { message: '缺少 day 或 current' })
        return
      }
      send(res, 200, compareHourlyFromDisk(root, day, currentHour, baselineHour || null))
      return
    }

    if (req.method === 'GET' && route === 'optimize-schedule') {
      send(res, 200, loadOptimizeSchedule(root))
      return
    }

    if (req.method === 'GET' && route === 'article-stock') {
      send(res, 200, getArticleStockSummary(root))
      return
    }

    if (req.method === 'GET' && route === 'optimize-batches') {
      send(res, 200, listOptimizeBatches(root))
      return
    }

    if (req.method === 'GET' && route.startsWith('optimize-batches/')) {
      const rest = route.slice('optimize-batches/'.length)
      if (rest.endsWith('/report')) {
        const id = decodeURIComponent(rest.slice(0, -'/report'.length))
        const batch = loadOptimizeBatch(root, id)
        if (!batch) {
          send(res, 404, { message: `优化批次不存在: ${id}` })
          return
        }
        send(res, 200, {
          id: batch.id,
          afterMetricsDay: batch.afterMetricsDay,
          harvestedAt: batch.harvestedAt,
          reportText: batch.reportText,
        })
        return
      }
      const id = decodeURIComponent(rest)
      const batch = loadOptimizeBatch(root, id)
      if (!batch) {
        send(res, 404, { message: `优化批次不存在: ${id}` })
        return
      }
      send(res, 200, batch)
      return
    }

    if (req.method === 'POST' && route === 'rebuild') {
      const report = rebuildOpsCenterReportFromDisk(root)
      send(res, 200, {
        ok: true,
        report,
        message: `已基于本地重算：待换漏斗 ${report.funnelReplaceSummaries.length} · 弱 offer ${report.replaceAdvice.length}`,
      })
      return
    }

    if (req.method === 'POST' && route.startsWith('optimize-batches/') && route.endsWith('/harvest')) {
      const id = decodeURIComponent(
        route.slice('optimize-batches/'.length, route.length - '/harvest'.length),
      )
      const text = await readBody(req)
      const body = JSON.parse(text || '{}') as { day?: string }
      const day = String(body.day || shanghaiDay()).trim()
      if (!day) {
        send(res, 400, { message: '缺少 day' })
        return
      }
      const batch = harvestOptimizeBatch({ projectRoot: root, batchId: id, afterMetricsDay: day })
      send(res, 200, {
        ok: true,
        batch,
        reportText: batch.reportText,
        message: `已回收优化后数据 ${day}，批次 ${id}`,
      })
      return
    }

    if (req.method === 'POST' && route.startsWith('optimize-batches/') && route.endsWith('/mark-written')) {
      const id = decodeURIComponent(
        route.slice('optimize-batches/'.length, route.length - '/mark-written'.length),
      )
      const text = await readBody(req)
      const body = JSON.parse(text || '{}') as {
        updates?: Array<{ offerId: string; afterRef?: string; afterUrl?: string | null; note?: string }>
      }
      const batch = markOptimizeBatchWritten(root, id, Array.isArray(body.updates) ? body.updates : [])
      send(res, 200, { ok: true, batch, message: `已标记写回 ${id}` })
      return
    }

    if (req.method === 'POST' && route === 'optimize-schedule') {
      const text = await readBody(req)
      const body = JSON.parse(text || '{}') as Record<string, unknown>
      const config = saveOptimizeSchedule(root, body)
      send(res, 200, { ok: true, config, message: '已保存换文节奏' })
      return
    }

    if (req.method === 'POST' && route === 'article-stock/order-from-batch') {
      const text = await readBody(req)
      const body = JSON.parse(text || '{}') as { batchId?: string }
      const batchId = String(body.batchId || '').trim()
      if (!batchId) {
        send(res, 400, { message: '缺少 batchId' })
        return
      }
      const result = orderStockFromOptimizeBatch(root, batchId)
      send(res, 200, {
        ok: true,
        ...result,
        water: getArticleStockSummary(root).water,
        message: `已导入备货单 +${result.added}（跳过 ${result.skipped}）`,
      })
      return
    }

    if (req.method === 'POST' && route === 'article-stock/ready') {
      const text = await readBody(req)
      const body = JSON.parse(text || '{}') as {
        stockId?: string
        articleId?: string
        landingUrl?: string
        note?: string
      }
      const stockId = String(body.stockId || '').trim()
      if (!stockId) {
        send(res, 400, { message: '缺少 stockId' })
        return
      }
      const pool = readyStockItem(root, stockId, {
        articleId: String(body.articleId || ''),
        landingUrl: String(body.landingUrl || ''),
        note: body.note,
      })
      send(res, 200, {
        ok: true,
        pool,
        water: getArticleStockSummary(root).water,
        message: `备货已就绪 ${stockId}`,
      })
      return
    }

    if (req.method === 'POST' && route === 'article-stock/plan-run') {
      const text = await readBody(req)
      const body = JSON.parse(text || '{}') as { batchId?: string; maxPerRun?: number }
      const plan = planStockReplaceRun(root, body)
      send(res, 200, { ok: true, ...plan })
      return
    }

    if (req.method === 'POST' && route === 'article-stock/consume') {
      const text = await readBody(req)
      const body = JSON.parse(text || '{}') as { stockId?: string; offerId?: string }
      const stockId = String(body.stockId || '').trim()
      const offerId = String(body.offerId || '').trim()
      if (!stockId || !offerId) {
        send(res, 400, { message: '缺少 stockId 或 offerId' })
        return
      }
      const pool = markStockConsumed(root, stockId, offerId)
      send(res, 200, {
        ok: true,
        pool,
        water: getArticleStockSummary(root).water,
        message: `已消耗备货 ${stockId}`,
      })
      return
    }

    if (req.method === 'POST' && route === 'hourly/capture') {
      if (!options.mis?.misTarget || !options.mis.misToken || !options.mis.misClientId) {
        send(res, 400, { message: '缺少 MIS 配置，无法拍小时点' })
        return
      }
      const text = await readBody(req)
      const body = JSON.parse(text || '{}') as { day?: string; hour?: string }
      const snapshot = await captureHourlySnapshotToDisk({
        projectRoot: root,
        env: options.mis,
        day: body.day,
        hour: body.hour,
        onProgress: (message) => console.log(`[ops-hourly] ${message}`),
      })
      send(res, 200, {
        ok: true,
        snapshot: {
          day: snapshot.day,
          hour: snapshot.hour,
          pulledAt: snapshot.pulledAt,
          offerCount: snapshot.offerCount,
          funnelCount: snapshot.funnelCount,
          totals: snapshot.totals,
        },
        message: `已保存小时点 ${snapshot.day} ${snapshot.hour}:00`,
      })
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }

    const text = await readBody(req)
    const body = JSON.parse(text || '{}') as Record<string, unknown>

    if (route === 'write') {
      const relativePath = String(body.path || '')
      writeOpsCenterJson(root, relativePath, body.data)
      send(res, 200, { ok: true, path: relativePath })
      return
    }

    if (route === 'write-batch') {
      const files = Array.isArray(body.files) ? body.files : []
      const saved: string[] = []
      for (const file of files) {
        if (!file || typeof file !== 'object') {
          continue
        }
        const item = file as { path?: string; data?: unknown }
        const relativePath = String(item.path || '')
        saved.push(writeOpsCenterJson(root, relativePath, item.data))
      }
      send(res, 200, { ok: true, saved })
      return
    }

    if (route === 'meta') {
      writeOpsCenterJson(root, 'meta.json', body)
      send(res, 200, { ok: true })
      return
    }

    if (route === 'report') {
      writeOpsCenterJson(root, 'report.json', body)
      send(res, 200, { ok: true })
      return
    }

    send(res, 404, { message: `未知路由 ${route}` })
  }
}

function startHourlyScheduler(projectRoot: string, env: HourlyCaptureEnv): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let running = false

  const runCapture = async (reason: string) => {
    if (stopped || running) {
      return
    }
    running = true
    try {
      console.log(`[ops-hourly] 开始自动拍摄（${reason}）`)
      const snapshot = await captureHourlySnapshotToDisk({
        projectRoot,
        env,
        onProgress: (message) => console.log(`[ops-hourly] ${message}`),
      })
      console.log(`[ops-hourly] 完成 ${snapshot.day} ${snapshot.hour}:00`)
    } catch (error) {
      console.error('[ops-hourly] 自动拍摄失败:', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }

  const scheduleNext = () => {
    if (stopped) {
      return
    }
    const wait = msUntilNextShanghaiHour()
    console.log(`[ops-hourly] 已安排下一整点拍摄，约 ${Math.round(wait / 60000)} 分钟后`)
    timer = setTimeout(() => {
      void runCapture('整点').finally(scheduleNext)
    }, wait)
  }

  const day = shanghaiDay()
  const hour = shanghaiHour()
  const existing = loadHourlySnapshot(projectRoot, day, hour)
  if (!existing) {
    timer = setTimeout(() => {
      void runCapture('启动补拍当前小时').finally(scheduleNext)
    }, 15_000)
    console.log('[ops-hourly] 当前小时尚无快照，15 秒后补拍，之后按整点自动拉')
  } else {
    scheduleNext()
  }

  return () => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
}
