/**
 * 回收优化后指标并刷新对比报告。
 * 用法: npx tsx tmp/harvest-optimize-batch.ts <batchId> [metricsDay]
 */
import { harvestOptimizeBatch } from '../src/server/opsCenterOptimizeBatch'
import { shanghaiDay } from '../src/domain/opsCenterTime'

const batchId = String(process.argv[2] || '').trim()
const day = String(process.argv[3] || shanghaiDay()).trim()
if (!batchId) {
  console.error('用法: npx tsx tmp/harvest-optimize-batch.ts <batchId> [metricsDay]')
  process.exit(1)
}

const batch = harvestOptimizeBatch({
  projectRoot: process.cwd(),
  batchId,
  afterMetricsDay: day,
})

console.log(
  JSON.stringify(
    {
      id: batch.id,
      afterMetricsDay: batch.afterMetricsDay,
      harvestedAt: batch.harvestedAt,
      reportPath: `data/ops-center/optimize-batches/${batch.id}.report.txt`,
    },
    null,
    2,
  ),
)
console.log('\n--- 对比报告 ---\n')
console.log(batch.reportText)
