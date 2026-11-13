import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureHourlySnapshotToDisk } from '../src/server/opsCenterHourlyCapture'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return
  }
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const index = line.indexOf('=')
    if (index <= 0) {
      continue
    }
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!(key in process.env) || process.env[key] === '') {
      process.env[key] = value
    }
  }
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? '').trim()
  if (!value) {
    throw new Error(`缺少 ${name}，请写在 .env.local`)
  }
  return value
}

async function main() {
  loadEnvFile(path.join(ROOT, '.env.local'))
  loadEnvFile(path.join(ROOT, '.env'))

  const snapshot = await captureHourlySnapshotToDisk({
    projectRoot: ROOT,
    env: {
      misTarget: requireEnv('VITE_MIS_API_TARGET'),
      misToken: requireEnv('VITE_MIS_TOKEN'),
      misClientId: requireEnv('VITE_MIS_CLIENT_ID'),
    },
    onProgress: (message) => console.log(message),
  })
  console.log(
    JSON.stringify(
      {
        day: snapshot.day,
        hour: snapshot.hour,
        funnelCount: snapshot.funnelCount,
        offerCount: snapshot.offerCount,
        revenue: snapshot.totals.revenue,
        visits: snapshot.totals.visits,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
