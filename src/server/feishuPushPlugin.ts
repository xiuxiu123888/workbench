import type { Plugin } from 'vite'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function readEnvValue(root: string, key: string): string {
  const fromProcess = String(process.env[key] || '').trim()
  if (fromProcess) {
    return fromProcess
  }
  const envPath = path.join(root, '.env.local')
  if (!fs.existsSync(envPath)) {
    return ''
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue
    }
    const index = trimmed.indexOf('=')
    const name = trimmed.slice(0, index).trim()
    if (name !== key) {
      continue
    }
    return trimmed.slice(index + 1).trim()
  }
  return ''
}

function readBody(req: { on: (event: string, cb: (chunk?: Buffer) => void) => void }): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      if (chunk) {
        chunks.push(chunk)
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body: string) => void }, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function sendFeishuText(webhook: string, text: string): Promise<void> {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text },
    }),
  })
  const body = (await response.json()) as { code?: number; msg?: string }
  if (!response.ok || body.code !== 0) {
    throw new Error(body.msg || `飞书推送失败 HTTP ${response.status}`)
  }
}

export function feishuPushPlugin(root: string): Plugin {
  const script = path.join(root, 'scripts', 'push-daily-feishu.ts')
  const node = process.execPath
  const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  let running: Promise<void> | null = null

  return {
    name: 'feishu-push',
    configureServer(server) {
      server.middlewares.use('/local-api/feishu-text', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        void (async () => {
          const webhook = readEnvValue(root, 'FEISHU_WEBHOOK_URL')
          if (!webhook) {
            sendJson(res, 500, { message: '未配置 FEISHU_WEBHOOK_URL' })
            return
          }
          let text = ''
          try {
            const raw = await readBody(req)
            const body = JSON.parse(raw) as { text?: string }
            text = String(body.text || '').trim()
          } catch {
            sendJson(res, 400, { message: '请求体不对' })
            return
          }
          if (!text) {
            sendJson(res, 400, { message: '文本不能为空' })
            return
          }
          if (text.length > 12000) {
            sendJson(res, 400, { message: '文本过长，请缩短后再发' })
            return
          }
          try {
            await sendFeishuText(webhook, text)
            sendJson(res, 200, { message: '已发送分析报告到飞书' })
          } catch (error) {
            sendJson(res, 500, {
              message: error instanceof Error ? error.message : '推送失败',
            })
          }
        })()
      })

      server.middlewares.use('/local-api/feishu-push', (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }
        void (async () => {
          if (running) {
            sendJson(res, 409, { message: '已有推送任务在跑，请稍后再试' })
            return
          }
          let kind = 'today'
          try {
            const raw = await readBody(req)
            if (raw.trim()) {
              const body = JSON.parse(raw) as { kind?: string }
              if (body.kind === 'yesterday' || body.kind === 'today') {
                kind = body.kind
              }
            }
          } catch {
            sendJson(res, 400, { message: '请求体不对' })
            return
          }
          const args = kind === 'yesterday' ? ['--yesterday'] : []
          running = new Promise<void>((resolve, reject) => {
            const child = spawn(node, [tsx, script, ...args], {
              cwd: root,
              env: process.env,
              windowsHide: true,
            })
            let stdout = ''
            let stderr = ''
            child.stdout.on('data', (chunk: Buffer) => {
              stdout += chunk.toString('utf8')
            })
            child.stderr.on('data', (chunk: Buffer) => {
              stderr += chunk.toString('utf8')
            })
            child.on('error', reject)
            child.on('close', (code) => {
              if (code === 0) {
                resolve()
                return
              }
              reject(new Error(stderr.trim() || stdout.trim() || `推送失败 code=${code}`))
            })
          })
          try {
            await running
            sendJson(res, 200, {
              message: kind === 'yesterday' ? '已发送昨日汇总到飞书' : '已发送今日汇总到飞书',
            })
          } catch (error) {
            sendJson(res, 500, {
              message: error instanceof Error ? error.message : '推送失败',
            })
          } finally {
            running = null
          }
        })()
      })
    },
  }
}
