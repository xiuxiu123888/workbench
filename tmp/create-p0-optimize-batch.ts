/**
 * 用今日 P0 无广告队列建优化批次，落盘优化前快照。
 * 用法: npx tsx tmp/create-p0-optimize-batch.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { createOptimizeBatchFromQueue } from '../src/server/opsCenterOptimizeBatch'

const root = process.cwd()
const reportPath = path.join(root, 'tmp/noad-replace-report.json')
if (!fs.existsSync(reportPath)) {
  throw new Error('缺少 tmp/noad-replace-report.json，先跑 build-noad-replace-report.ts')
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
  day: string
  p0Queue: Array<{
    offerId: string
    reason: string
    borrowSeedRef: string
    donorOffer: string
    donorFunnel: string
    action: string
    currentRef: string
  }>
}

const day = report.day || '2026-11-13'
const batch = createOptimizeBatchFromQueue({
  projectRoot: root,
  id: `opt-p0-${day.replace(/-/g, '')}`,
  title: `P0无广告优先换文 · ${day}`,
  beforeMetricsDay: day,
  notes:
    '优化前快照已存。换文写回后可用 POST /local-api/ops-center/optimize-batches/{id}/harvest 请求优化后数据并出报告。',
  queue: report.p0Queue.map((row) => ({
    offerId: row.offerId,
    priority: 'P0' as const,
    reason: row.reason,
    plannedSeedRef: row.borrowSeedRef,
    donorOfferName: row.donorOffer || null,
    donorFunnelName: row.donorFunnel || null,
    action:
      row.action === '同词跳过/换域再试'
        ? ('same-ref-skip' as const)
        : row.action === '人工指定种子'
          ? ('manual-seed' as const)
          : ('produce-write' as const),
    status: row.action === '同词跳过/换域再试' ? ('skipped' as const) : ('planned' as const),
    note: `beforeRef=${row.currentRef}`,
  })),
})

console.log(
  JSON.stringify(
    {
      id: batch.id,
      path: `data/ops-center/optimize-batches/${batch.id}.json`,
      reportPath: `data/ops-center/optimize-batches/${batch.id}.report.txt`,
      itemCount: batch.itemCount,
      planned: batch.items.filter((i) => i.status === 'planned').length,
      skipped: batch.items.filter((i) => i.status === 'skipped').length,
      beforeMetricsDay: batch.beforeMetricsDay,
      harvestHint: `npx tsx tmp/harvest-optimize-batch.ts ${batch.id} [day]`,
    },
    null,
    2,
  ),
)
console.log('\n--- 优化前报告预览 ---\n')
console.log(batch.reportText)
