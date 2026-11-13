import { describe, expect, it } from 'vitest'
import {
  buildMetricSnapshot,
  formatOptimizeCompareReport,
  secondHopPct,
  summarizeTuneBySeed,
  upsertBatchIndex,
  verdictOfItem,
  type OptimizeBatch,
  type OptimizeBatchItem,
} from './offerOptimizeBatch'

describe('offerOptimizeBatch', () => {
  it('computes second hop pct', () => {
    expect(secondHopPct(0, 100)).toBe(0)
    expect(secondHopPct(25, 100)).toBe(25)
  })

  it('builds metric snapshot with rpc', () => {
    const snap = buildMetricSnapshot({
      offerId: 'a',
      offerName: 'offer-a',
      funnelName: 'moboreels-v02',
      partner: 'moboreels',
      ref: 'gm hybrid suv',
      funnelClicks: 100,
      adClicks: 0,
      revenue: 1,
      funnelRpm: 0.1,
      metricsDay: '2026-11-13',
    })
    expect(snap.rpc).toBe(0.01)
    expect(snap.secondHopPct).toBe(0)
  })

  it('formats before-only report and after compare', () => {
    const before = buildMetricSnapshot({
      offerId: 'a',
      offerName: 'offer-a',
      funnelName: 'moboreels-v02',
      partner: 'moboreels',
      ref: 'old',
      funnelClicks: 100,
      adClicks: 0,
      conversion: 0,
      revenue: 1,
      funnelRpm: 0.1,
      metricsDay: '2026-11-13',
    })
    const batch: OptimizeBatch = {
      id: 'opt-1',
      title: 'test',
      createdAt: '2026-11-13T00:00:00.000Z',
      beforeMetricsDay: '2026-11-13',
      afterMetricsDay: null,
      harvestedAt: null,
      rulesVersion: 'v1',
      notes: '',
      itemCount: 1,
      items: [
        {
          offerId: 'a',
          offerName: 'offer-a',
          funnelName: 'moboreels-v02',
          partner: 'moboreels',
          priority: 'P0',
          reason: 'no ad',
          beforeRef: 'old',
          plannedSeedRef: 'new',
          afterRef: null,
          beforeUrl: null,
          afterUrl: null,
          donorOfferName: null,
          donorFunnelName: null,
          action: 'produce-write',
          status: 'planned',
          note: '',
          before,
          after: null,
        },
      ],
      reportText: null,
    }
    expect(formatOptimizeCompareReport(batch)).toContain('尚未回收')

    batch.afterMetricsDay = '2026-11-14'
    batch.harvestedAt = '2026-11-14T12:00:00.000Z'
    batch.items[0].after = buildMetricSnapshot({
      ...before,
      ref: 'new',
      adClicks: 10,
      conversion: 5,
      revenue: 8,
      funnelRpm: 2,
      metricsDay: '2026-11-14',
    })
    const text = formatOptimizeCompareReport(batch)
    expect(text).toContain('收入上升 1')
    expect(text).toContain('二跳上升 1')
    expect(text).toContain('Δ:')
  })

  it('classifies tune verdict and seed summary', () => {
    const base = {
      offerId: 'a',
      offerName: 'o',
      funnelName: 'f',
      partner: 'p',
      priority: 'P0' as const,
      reason: '',
      beforeRef: 'old',
      plannedSeedRef: 'Cosmetic Products',
      afterRef: 'Cosmetic Products',
      beforeUrl: null,
      afterUrl: null,
      donorOfferName: null,
      donorFunnelName: null,
      action: 'produce-write' as const,
      status: 'written' as const,
      note: '',
      before: buildMetricSnapshot({
        offerId: 'a',
        offerName: 'o',
        funnelName: 'f',
        partner: 'p',
        ref: 'old',
        funnelClicks: 100,
        adClicks: 0,
        revenue: 0.1,
        funnelRpm: 0.1,
        metricsDay: '2026-11-13',
      }),
      after: buildMetricSnapshot({
        offerId: 'a',
        offerName: 'o',
        funnelName: 'f',
        partner: 'p',
        ref: 'Cosmetic Products',
        funnelClicks: 100,
        adClicks: 20,
        revenue: 8,
        funnelRpm: 2,
        metricsDay: '2026-11-14',
      }),
    } satisfies OptimizeBatchItem
    expect(verdictOfItem(base)).toBe('good')
    const summary = summarizeTuneBySeed([base])
    expect(summary[0].seed).toBe('Cosmetic Products')
    expect(summary[0].good).toBe(1)
  })

  it('upserts index with newest first', () => {
    const batch = {
      id: 'b2',
      title: 't',
      createdAt: '2026-11-13T02:00:00.000Z',
      beforeMetricsDay: '2026-11-13',
      afterMetricsDay: null,
      harvestedAt: null,
      itemCount: 1,
      items: [],
    } as unknown as OptimizeBatch
    const index = upsertBatchIndex(
      {
        updatedAt: 'x',
        batches: [
          {
            id: 'b1',
            title: 'old',
            createdAt: '2026-11-13T01:00:00.000Z',
            beforeMetricsDay: '2026-11-13',
            afterMetricsDay: null,
            harvestedAt: null,
            itemCount: 1,
            writtenCount: 0,
            path: 'optimize-batches/b1.json',
          },
        ],
      },
      { ...batch, rulesVersion: 'v1', notes: '', reportText: null, items: [] },
      'optimize-batches/b2.json',
    )
    expect(index.batches.map((row) => row.id)).toEqual(['b2', 'b1'])
  })
})
