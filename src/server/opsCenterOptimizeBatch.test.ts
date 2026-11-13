import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createOptimizeBatchFromQueue,
  harvestOptimizeBatch,
  listOptimizeBatches,
} from './opsCenterOptimizeBatch'
import { writeOpsCenterJson } from './opsCenterStore'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('opsCenterOptimizeBatch', () => {
  it('stores before snapshot and harvests after compare report', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opt-batch-'))
    tempRoots.push(root)

    writeOpsCenterJson(root, 'raw/groups.json', [
      {
        funnelName: 'moboreels-v02',
        offerList: [{ offerId: 'o1', offerName: 'moboreels-v02-A1-us-1-x.com' }],
      },
    ])
    writeOpsCenterJson(root, 'metrics/2026-11-13/all.json', {
      statsList: [
        {
          id: 'o1',
          name: 'moboreels-v02-A1-us-1-x.com',
          visits: 10,
          funnelClicks: 100,
          clicks: 0,
          conversion: 0,
          revenue: '1',
          funnelRpm: '0.1',
          url: 'https://x.com/detail/1?ref=old+ref&channel=1',
        },
      ],
    })
    writeOpsCenterJson(root, 'metrics/2026-11-14/all.json', {
      statsList: [
        {
          id: 'o1',
          name: 'moboreels-v02-A1-us-1-x.com',
          visits: 20,
          funnelClicks: 120,
          clicks: 15,
          conversion: 8,
          revenue: '9',
          funnelRpm: '2',
          url: 'https://x.com/detail/2?ref=new+ref&channel=1',
        },
      ],
    })

    const batch = createOptimizeBatchFromQueue({
      projectRoot: root,
      id: 'opt-test',
      title: 'test batch',
      beforeMetricsDay: '2026-11-13',
      queue: [
        {
          offerId: 'o1',
          priority: 'P0',
          reason: 'no ad',
          plannedSeedRef: 'new ref',
        },
      ],
    })

    expect(batch.itemCount).toBe(1)
    expect(batch.items[0].before.adClicks).toBe(0)
    expect(batch.items[0].beforeRef).toBe('old ref')
    expect(batch.reportText).toContain('尚未回收')
    expect(listOptimizeBatches(root).batches[0].id).toBe('opt-test')

    const harvested = harvestOptimizeBatch({
      projectRoot: root,
      batchId: 'opt-test',
      afterMetricsDay: '2026-11-14',
    })
    expect(harvested.afterMetricsDay).toBe('2026-11-14')
    expect(harvested.items[0].after?.adClicks).toBe(15)
    expect(harvested.reportText).toContain('收入上升 1')
    expect(harvested.reportText).toContain('二跳上升 1')
    expect(
      fs.existsSync(path.join(root, 'data', 'ops-center', 'optimize-batches', 'opt-test.report.txt')),
    ).toBe(true)
  })
})
