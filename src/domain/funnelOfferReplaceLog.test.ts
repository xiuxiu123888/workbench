import { describe, expect, it } from 'vitest'
import {
  createFunnelOfferReplaceLogItem,
  filterFunnelOfferReplaceLog,
  loadFunnelOfferReplaceLog,
  prependFunnelOfferReplaceLog,
  saveFunnelOfferReplaceLog,
} from './funnelOfferReplaceLog'

describe('funnelOfferReplaceLog', () => {
  it('persists and filters replace logs', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }
    const record = createFunnelOfferReplaceLogItem({
      funnelId: 'f1',
      funnelName: 'demo',
      offerId: 'o1',
      offerName: 'offer-1',
      channelId: '99',
      articleId: '222',
      ref: 'new ref',
      oldUrl: 'https://a.com/detail/111?ref=old',
      newUrl: 'https://a.com/detail/222?ref=new+ref',
      resultUrl: 'https://a.com/detail/222?ref=new+ref&subid1=99&subid2=222',
      ok: true,
      message: '替换成功',
      createdAt: 100,
    })
    const next = prependFunnelOfferReplaceLog([], record)
    saveFunnelOfferReplaceLog(next, storage)
    const loaded = loadFunnelOfferReplaceLog(storage)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].offerId).toBe('o1')
    expect(filterFunnelOfferReplaceLog(loaded, 'demo')).toHaveLength(1)
    expect(filterFunnelOfferReplaceLog(loaded, 'nope')).toHaveLength(0)
  })
})
