import { spawn } from 'node:child_process'
import fs from 'node:fs'

/** reader-vo1 按 reader-v01 处理 */
const WANT_NAMES = [
  'reader-v01',
  'ShortMax-v11',
  'moboreels-v03',
  'Vibeshort-V04',
  'storyreel-v01',
  'Vibeshort-V03',
  'moboreels-v02',
  'storyreel-v04',
  'ShortMax-v06',
  'storyreel-v03',
  'cd-reader-pb-v01',
  'storyreel-v05',
  'reader-v02',
]

const list = JSON.parse(fs.readFileSync('data/ops-center/raw/list.json', 'utf8'))
const rows = list.data || list
const byName = new Map(rows.map((row) => [String(row.funnelName || '').toLowerCase(), row]))

const batch = []
for (const name of WANT_NAMES) {
  const row = byName.get(name.toLowerCase())
  if (!row) {
    console.error(`缺少漏斗: ${name}`)
    process.exit(1)
  }
  batch.push({ funnelId: row.funnelId, funnelName: row.funnelName })
}

const stamp = Date.now()
const summaryPath = `tmp/funnel-batch-generate-${stamp}.json`
const summary = {
  title: '批量漏斗产文',
  startedAt: new Date().toISOString(),
  names: WANT_NAMES,
  funnels: batch,
  results: [],
}

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
console.log(`batch ${batch.length} funnels → ${summaryPath}`)

function runOne(funnelId) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['tmp/run-funnel-generate.mjs', funnelId], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    })
    child.on('error', (error) => {
      resolve({ code: 1, error: error.message })
    })
    child.on('close', (code) => {
      resolve({ code: code ?? 1 })
    })
  })
}

for (let index = 0; index < batch.length; index += 1) {
  const item = batch[index]
  console.log(`\n======== [${index + 1}/${batch.length}] ${item.funnelName} (${item.funnelId}) ========`)
  const startedAt = new Date().toISOString()
  const result = await runOne(item.funnelId)
  const finishedAt = new Date().toISOString()
  const runPath = `tmp/funnel-${item.funnelId}-generate-run.json`
  let runSummary = null
  try {
    const run = JSON.parse(fs.readFileSync(runPath, 'utf8'))
    runSummary = run.summary || null
  } catch {
    /* ignore */
  }
  summary.results.push({
    funnelId: item.funnelId,
    funnelName: item.funnelName,
    startedAt,
    finishedAt,
    exitCode: result.code,
    error: result.error || null,
    summary: runSummary,
    runPath,
  })
  summary.updatedAt = finishedAt
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  console.log(
    `done ${item.funnelName} exit=${result.code} success=${runSummary?.success ?? '-'} failed=${runSummary?.failed ?? '-'}`,
  )
}

summary.finishedAt = new Date().toISOString()
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
console.log(`\nbatch finished → ${summaryPath}`)
console.log(
  JSON.stringify(
    {
      summaryPath,
      results: summary.results.map((row) => ({
        funnelName: row.funnelName,
        exitCode: row.exitCode,
        summary: row.summary,
      })),
    },
    null,
    2,
  ),
)
