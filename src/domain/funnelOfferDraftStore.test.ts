import { describe, expect, it } from 'vitest'
import { mergeFunnelOfferDrafts, type FunnelOfferDraftJob } from './funnelOfferDraftStore'

function job(partial: Partial<FunnelOfferDraftJob> & Pick<FunnelOfferDraftJob, 'key' | 'updatedAt'>): FunnelOfferDraftJob {
  return {
    funnelId: 'f1',
    funnelName: 'demo',
    offerId: partial.key.split(':')[1] || 'o1',
    offerName: 'offer',
    groupId: 'g1',
    groupName: 'g',
    oldLandingUrl: null,
    channelId: '1',
    categoryName: 'c',
    seedKeyword: 'seed',
    taskId: 't1',
    status: 'ready',
    note: 'old',
    ...partial,
  }
}

describe('mergeFunnelOfferDrafts', () => {
  it('keeps newer local status/note over older disk copy', () => {
    const local = [
      job({
        key: 'f1:o1',
        updatedAt: '2026-11-11T12:00:00.000Z',
        note: '已写 resultUrl',
        status: 'ready',
      }),
    ]
    const remote = [
      job({
        key: 'f1:o1',
        updatedAt: '2026-11-11T10:00:00.000Z',
        note: '已发布',
        status: 'ready',
      }),
      job({
        key: 'f1:o2',
        updatedAt: '2026-11-11T11:00:00.000Z',
        note: '磁盘新增',
        offerId: 'o2',
      }),
    ]
    const merged = mergeFunnelOfferDrafts(local, remote)
    expect(merged.find((row) => row.key === 'f1:o1')?.note).toBe('已写 resultUrl')
    expect(merged.find((row) => row.key === 'f1:o2')?.note).toBe('磁盘新增')
  })

  it('keeps remote when updatedAt is equal so disk edits are not overwritten by stale localStorage', () => {
    const local = [
      job({
        key: 'f1:o1',
        updatedAt: '2026-11-11T12:00:00.000Z',
        seedKeyword: 'cars with 0 apr',
      }),
    ]
    const remote = [
      job({
        key: 'f1:o1',
        updatedAt: '2026-11-11T12:00:00.000Z',
        seedKeyword: 'cars with apr',
      }),
    ]
    const merged = mergeFunnelOfferDrafts(local, remote)
    expect(merged.find((row) => row.key === 'f1:o1')?.seedKeyword).toBe('cars with apr')
  })
})
