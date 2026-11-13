import { describe, expect, it } from 'vitest'
import {
  createGenerationRecord,
  filterGenerationLog,
  normalizeGenerationLog,
  prependGenerationRecord,
  type GenerationDraft,
} from './generationLog'

const draft: GenerationDraft = {
  sourceArticleId: ' 12 ',
  newArticleId: '99',
  title: '原标题',
  linkRef: 'Drain Cleaning ',
  url: 'https://vitafluxly.com/detail/99?channel=5949606886&ref=Drain+Cleaning+',
  siteName: ' vitafluxly.com ',
  articleAccount: 'A1',
  afsAccount: 'AFS1',
  ok: true,
  message: '完成',
}

describe('生成记录', () => {
  it('保留 ref 原文，并从链接取出渠道', () => {
    const record = createGenerationRecord(draft, 1_700_000_000_000, 'rec-1')
    expect(record.linkRef).toBe('Drain Cleaning ')
    expect(record.sourceArticleId).toBe('12')
    expect(record.channel).toBe('5949606886')
    expect(record.siteName).toBe('vitafluxly.com')
  })

  it('新记录排在最前，并丢掉超出上限的旧记录', () => {
    const older = createGenerationRecord({ ...draft, sourceArticleId: '1' }, 1, 'old')
    const newer = createGenerationRecord({ ...draft, sourceArticleId: '2' }, 2, 'new')
    expect(prependGenerationRecord([older], newer, 1)).toEqual([newer])
  })

  it('按文章 ID、ref、渠道和链接筛选', () => {
    const record = createGenerationRecord(draft, 1, 'rec-1')
    const failed = createGenerationRecord(
      { ...draft, sourceArticleId: '8', linkRef: 'Other', url: '', ok: false, message: '复制失败' },
      2,
      'rec-2',
    )
    expect(filterGenerationLog([record, failed], '5949606886')).toEqual([record])
    expect(filterGenerationLog([record, failed], 'drain cleaning')).toEqual([record])
    expect(filterGenerationLog([record, failed], '复制失败')).toEqual([failed])
    expect(filterGenerationLog([record], '   ')).toEqual([record])
  })

  it('坏数据读成空列表，合法记录保留', () => {
    expect(normalizeGenerationLog('{')).toEqual([])
    expect(normalizeGenerationLog(null)).toEqual([])
    const record = createGenerationRecord(draft, 3, 'rec-3')
    expect(normalizeGenerationLog([record, { id: '', createdAt: 1 }, { id: 'x' }]).map((item) => item.id)).toEqual(['rec-3'])
  })
})
