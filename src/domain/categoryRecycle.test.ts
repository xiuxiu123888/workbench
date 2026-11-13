import { describe, expect, it } from 'vitest'
import { emptyProgress, type StoredArticleJob } from './articleJobStore'
import { channelsForCategories } from './categoryRecycle'

function job(partial: Partial<StoredArticleJob> & Pick<StoredArticleJob, 'taskId'>): StoredArticleJob {
  return {
    intentKeyword: 'kw',
    refKeyword: 'ref',
    channelId: '',
    categoryId: 0,
    languageId: 1,
    regionId: 'US',
    publish: false,
    articlesPerDomain: 1,
    targets: [],
    status: 'success',
    progress: emptyProgress(),
    results: [],
    errorMessage: null,
    createdAt: '',
    updatedAt: '',
    ...partial,
  }
}

describe('categoryRecycle', () => {
  it('按品类收集渠道，去重且忽略空渠道', () => {
    const jobs = [
      job({ taskId: '1', categoryId: 10, channelId: '28473' }),
      job({ taskId: '2', categoryId: 10, channelId: '28473' }),
      job({ taskId: '3', categoryId: 10, channelId: ' 99 ' }),
      job({ taskId: '4', categoryId: 11, channelId: '100' }),
      job({ taskId: '5', categoryId: 10, channelId: '' }),
    ]
    expect(channelsForCategories(jobs, new Set(['10']))).toEqual(['99', '28473'])
    expect(channelsForCategories(jobs, new Set(['11']))).toEqual(['100'])
    expect(channelsForCategories(jobs, new Set(['99']))).toEqual([])
  })
})
