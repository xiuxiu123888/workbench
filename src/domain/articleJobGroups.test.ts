import { describe, expect, it } from 'vitest'
import { emptyProgress, type StoredArticleJob } from './articleJobStore'
import { buildJobSiteGroups } from './articleJobGroups'

function job(partial: Partial<StoredArticleJob> & Pick<StoredArticleJob, 'taskId'>): StoredArticleJob {
  return {
    intentKeyword: 'kw',
    refKeyword: 'ref',
    channelId: '28473',
    categoryId: 10,
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

describe('buildJobSiteGroups', () => {
  it('按类目+账户+网站分组，国家为二级', () => {
    const jobs = [
      job({
        taskId: 't1',
        regionId: 'US',
        results: [
          {
            domain: 'counselsai.com',
            account_id: '3',
            status: 'success',
            article_id: '100',
          },
        ],
      }),
      job({
        taskId: 't2',
        regionId: 'JP',
        results: [
          {
            domain: 'counselsai.com',
            account_id: '3',
            status: 'success',
            article_id: '200',
          },
        ],
      }),
      job({
        taskId: 't3',
        regionId: 'US',
        categoryId: 10,
        results: [
          {
            domain: 'other.com',
            account_id: '3',
            status: 'success',
            article_id: '300',
          },
        ],
      }),
    ]
    const groups = buildJobSiteGroups({
      jobs,
      categoryLabel: () => '金融',
      accountLabel: () => 'A3',
      writtenKeys: new Set(),
      writeLinks: {},
    })
    expect(groups).toHaveLength(2)
    const main = groups.find((item) => item.domain === 'counselsai.com')
    expect(main?.title).toBe('金融 · A3 · counselsai.com')
    expect(main?.countries.map((c) => c.countryCode)).toEqual(['JP', 'US'])
    expect(main?.countries.find((c) => c.countryCode === 'US')?.articles[0]?.articleId).toBe('100')
    expect(main?.writableCount).toBe(2)
  })

  it('无 results 时用 targets 占位，创建后立刻可见', () => {
    const groups = buildJobSiteGroups({
      jobs: [
        job({
          taskId: 'pending',
          status: 'queued',
          regionId: 'US',
          targets: [{ domain: 'counselsai.com', site_id: 1, account_id: '3' }],
          results: [],
        }),
      ],
      categoryLabel: () => '金融',
      accountLabel: () => 'A3',
      writtenKeys: new Set(),
      writeLinks: {},
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('金融 · A3 · counselsai.com')
    expect(groups[0].pendingCount).toBe(1)
    expect(groups[0].countries[0]?.countryCode).toBe('US')
  })
})

