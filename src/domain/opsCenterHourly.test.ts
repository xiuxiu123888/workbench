import { describe, expect, it } from 'vitest'
import { buildHourlySnapshot, compareHourlySnapshots, previousHourLabel } from './opsCenterHourly'
import { msUntilNextShanghaiHour } from '../server/opsCenterHourlyCapture'

describe('opsCenterHourly', () => {
  it('builds snapshot and diffs against previous hour', () => {
    const funnels = [{ funnelId: 'f1', funnelName: 'demo' }]
    const earlier = buildHourlySnapshot({
      day: '2026-11-11',
      hour: '10',
      query: { startTime: '2026-11-11 00:00:00', endTime: '2026-11-11 23:59:59' },
      funnels,
      statsByFunnelId: new Map([
        [
          'f1',
          [
            {
              id: 'o1',
              name: 'offer-a',
              visits: 100,
              conversion: 5,
              revenue: '10',
              funnelImpressions: 200,
              funnelClicks: 40,
              clicks: 20,
              funnelRpm: '2',
              rpc: '0.5',
              funnelCtr: '20',
              cvr1: '5',
              cvr2: '10',
              url: 'https://example.com/a',
            },
          ],
        ],
      ]),
    })

    const later = buildHourlySnapshot({
      day: '2026-11-11',
      hour: '11',
      query: { startTime: '2026-11-11 00:00:00', endTime: '2026-11-11 23:59:59' },
      funnels,
      statsByFunnelId: new Map([
        [
          'f1',
          [
            {
              id: 'o1',
              name: 'offer-a',
              visits: 150,
              conversion: 8,
              revenue: '16',
              funnelImpressions: 300,
              funnelClicks: 60,
              clicks: 30,
              funnelRpm: '3',
              rpc: '0.5',
              funnelCtr: '20',
              cvr1: '5',
              cvr2: '10',
              url: 'https://example.com/a',
            },
          ],
        ],
      ]),
    })

    expect(later.totals.revenue).toBe(16)
    expect(later.funnels[0]?.offerCount).toBe(1)

    const diff = compareHourlySnapshots(later, earlier)
    expect(diff.baselineHour).toBe('10')
    expect(diff.totals.revenueDelta).toBe(6)
    expect(diff.totals.visitsDelta).toBe(50)
    expect(diff.funnels[0]?.funnelClicksDelta).toBe(20)
    expect(diff.offers[0]?.conversionDelta).toBe(3)
    expect(previousHourLabel('11')).toBe('10')
    expect(previousHourLabel('00')).toBeNull()
  })

  it('schedules the next shanghai hour at least a few seconds out', () => {
    expect(msUntilNextShanghaiHour()).toBeGreaterThanOrEqual(5_000)
  })
})
