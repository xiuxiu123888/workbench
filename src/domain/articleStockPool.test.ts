import { describe, expect, it } from 'vitest'
import {
  emptyArticleStockPool,
  markStockReady,
  pickReadyStock,
  planReplaceRun,
  stockWaterLevel,
  type ArticleStockItem,
} from './articleStockPool'

function item(partial: Partial<ArticleStockItem> & Pick<ArticleStockItem, 'id' | 'status'>): ArticleStockItem {
  return {
    createdAt: 't',
    updatedAt: 't',
    partner: 'moboreels',
    seedRef: 'clorox everclean',
    targetOfferId: 'o1',
    targetOfferName: 'offer-1',
    targetFunnelName: 'moboreels-v02',
    beforeUrl: 'https://x.com/detail/1?channel=1',
    channelId: '1',
    articleId: null,
    landingUrl: null,
    batchId: 'b1',
    note: '',
    consumedAt: null,
    consumedOfferId: null,
    ...partial,
  }
}

describe('articleStockPool', () => {
  it('tracks water level', () => {
    let pool = emptyArticleStockPool()
    pool = {
      ...pool,
      items: [
        item({ id: 'a', status: 'ordered' }),
        item({ id: 'b', status: 'ready', articleId: '1', landingUrl: 'https://x.com/detail/2?channel=1' }),
      ],
    }
    expect(stockWaterLevel(pool)).toMatchObject({ ordered: 1, ready: 1 })
  })

  it('plans replace run from ready stock', () => {
    let pool = emptyArticleStockPool()
    pool = {
      ...pool,
      items: [
        item({
          id: 's1',
          status: 'ready',
          articleId: '99',
          landingUrl: 'https://x.com/detail/99?ref=clorox+everclean&channel=1',
        }),
      ],
    }
    pool = markStockReady(pool, 's1', {
      articleId: '99',
      landingUrl: 'https://x.com/detail/99?ref=clorox+everclean&channel=1',
    })
    const plan = planReplaceRun({
      pool,
      maxPerRun: 5,
      targets: [
        {
          offerId: 'o1',
          offerName: 'offer-1',
          funnelName: 'moboreels-v02',
          partner: 'moboreels',
          seedRef: 'clorox everclean',
          beforeUrl: 'https://x.com/detail/1?channel=1',
          channelId: '1',
          batchId: 'b1',
          status: 'planned',
        },
      ],
    })
    expect(plan).toHaveLength(1)
    expect(plan[0].articleId).toBe('99')
    expect(pickReadyStock(pool, { offerId: 'o1', partner: 'moboreels', seedRef: 'clorox everclean' }, new Set())).toBeTruthy()
  })
})
