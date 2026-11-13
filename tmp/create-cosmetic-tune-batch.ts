/** 从美妆写回日志建调优批次 */
import fs from 'node:fs'
import { formatOptimizeCompareReport } from '../src/domain/offerOptimizeBatch'
import {
  createOptimizeBatchFromQueue,
  saveOptimizeBatch,
} from '../src/server/opsCenterOptimizeBatch'
import { shanghaiDay } from '../src/domain/opsCenterTime'

const COSMETIC_RE = /cosmetic|beauty|mature skin/i
const root = process.cwd()
const log = JSON.parse(fs.readFileSync('data/ops-center/offer-replace-log.json', 'utf8')) as {
  records?: Array<{ offerId?: string; ref?: string; ok?: boolean }>
}

const seen = new Set<string>()
const queue = [] as Array<{
  offerId: string
  priority: 'P0'
  reason: string
  plannedSeedRef: string
  note: string
  action: 'produce-write'
  status: 'written'
}>

for (const row of log.records || []) {
  if (!row.ok) continue
  const ref = String(row.ref || '').trim()
  if (!COSMETIC_RE.test(ref)) continue
  const offerId = String(row.offerId || '').trim()
  if (!offerId || seen.has(offerId)) continue
  seen.add(offerId)
  queue.push({
    offerId,
    priority: 'P0',
    reason: '美妆试词写回 · 调优观察',
    plannedSeedRef: ref,
    note: `writtenRef=${ref}`,
    action: 'produce-write',
    status: 'written',
  })
}

if (!queue.length) throw new Error('替换日志里没有美妆写回记录')

const day = shanghaiDay()
let batch = createOptimizeBatchFromQueue({
  projectRoot: root,
  id: `opt-cosmetic-${day.replace(/-/g, '')}`,
  title: `美妆试词调优 · ${day}`,
  beforeMetricsDay: day,
  notes:
    '刚写回的美妆词 offer。优化前=写回当日指标（多为旧词）。观察几小时后点「回收优化后」看哪些词/单元跑得好。',
  queue,
})

batch = {
  ...batch,
  items: batch.items.map((item) => ({
    ...item,
    status: 'written' as const,
    afterRef: item.plannedSeedRef,
  })),
  itemCount: batch.items.length,
  reportText: null,
}
batch.reportText = formatOptimizeCompareReport(batch)
saveOptimizeBatch(root, batch)

console.log(
  JSON.stringify(
    {
      id: batch.id,
      itemCount: batch.itemCount,
      skippedNoMetrics: queue.length - batch.itemCount,
      refs: [...new Set(batch.items.map((i) => i.plannedSeedRef))],
      path: `data/ops-center/optimize-batches/${batch.id}.json`,
    },
    null,
    2,
  ),
)
