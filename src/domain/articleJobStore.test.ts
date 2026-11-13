import { describe, expect, it } from 'vitest'
import {
  bareDomain,
  isTerminalJobStatus,
  normalizeStoredJobs,
  removeArticleJob,
  upsertArticleJob,
} from './articleJobStore'

describe('articleJobStore', () => {
  it('detects terminal statuses', () => {
    expect(isTerminalJobStatus('success')).toBe(true)
    expect(isTerminalJobStatus('partial_success')).toBe(true)
    expect(isTerminalJobStatus('failed')).toBe(true)
    expect(isTerminalJobStatus('running')).toBe(false)
    expect(isTerminalJobStatus('queued')).toBe(false)
  })

  it('normalizes domains', () => {
    expect(bareDomain('https://WWW.Example.com/path')).toBe('example.com')
    expect(bareDomain('example.com/')).toBe('example.com')
  })

  it('upserts and removes jobs', () => {
    const first = {
      taskId: 'job_1',
      intentKeyword: 'a',
      refKeyword: 'ref-a',
      channelId: '',
      categoryId: 10,
      languageId: 1,
      regionId: 'US',
      publish: true,
      articlesPerDomain: 1,
      targets: [{ domain: 'a.com', site_id: 1, account_id: 3 }],
      status: 'queued',
      progress: { total: 1, completed: 0, success: 0, failed: 0, running: 0 },
      results: [],
      errorMessage: null,
      createdAt: '1',
      updatedAt: '1',
    }
    const list = upsertArticleJob([], first)
    expect(list).toHaveLength(1)
    const updated = upsertArticleJob(list, { ...first, status: 'running' })
    expect(updated).toHaveLength(1)
    expect(updated[0].status).toBe('running')
    expect(removeArticleJob(updated, 'job_1')).toEqual([])
  })

  it('drops invalid stored rows and backfills ref/category/channel', () => {
    expect(normalizeStoredJobs([{ taskId: '' }, { taskId: 'x', intentKeyword: 'k' }])).toEqual([
      expect.objectContaining({
        taskId: 'x',
        intentKeyword: 'k',
        refKeyword: 'k',
        channelId: '',
        categoryId: 0,
      }),
    ])
  })
})
