import { describe, expect, it } from 'vitest'
import { articleDomain, buildArticleUpdate, collectArticleGroups, collectDirectGroups, parseArticleIds } from './batch'

describe('批量文章', () => {
  it('文章 ID 和 ref 按组收集，空行忽略', () => {
    expect(
      collectArticleGroups([
        { articleId: ' 12 ', channelId: '', linkRef: 'First ref ' },
        { articleId: '', channelId: '', linkRef: '   ' },
        { articleId: '34', channelId: ' 88 ', linkRef: 'Second' },
      ]),
    ).toEqual({
      ok: true,
      groups: [
        { articleId: '12', channelId: '', linkRef: 'First ref ' },
        { articleId: '34', channelId: '88', linkRef: 'Second' },
      ],
    })
    expect(collectArticleGroups([{ articleId: '12', channelId: '', linkRef: ' ' }]).ok).toBe(false)
    expect(collectArticleGroups([{ articleId: '12', channelId: '88', linkRef: ' ' }]).ok).toBe(false)
    expect(collectArticleGroups([{ articleId: '12', channelId: 'abc', linkRef: 'ref' }]).ok).toBe(false)
    expect(collectArticleGroups([{ articleId: '12', channelId: '', linkRef: 'a' }, { articleId: '12', channelId: '', linkRef: 'b' }]).ok).toBe(false)
  })

  it('直接拼链接时渠道 ID 必填', () => {
    expect(collectDirectGroups([{ articleId: '12', channelId: ' 88 ', linkRef: 'Keep ' }])).toEqual({
      ok: true,
      groups: [{ articleId: '12', channelId: '88', linkRef: 'Keep ' }],
    })
    expect(collectDirectGroups([{ articleId: '12', channelId: '', linkRef: 'Keep' }])).toEqual({
      ok: false,
      message: '每一组都要填写渠道 ID',
    })
  })

  it('按行、逗号和空格拆出文章 ID，并去掉重复', () => {
    expect(parseArticleIds('12\n34, 12 56')).toEqual(['12', '34', '56'])
    expect(parseArticleIds('abc\n')).toEqual([])
  })

  it('优先用网站的 siteUrl 作为域名', () => {
    expect(articleDomain({ siteUrl: 'vitafluxly.com', siteName: 'Vita' })).toBe('vitafluxly.com')
    expect(articleDomain({ siteName: 'vitafluxly.com' })).toBe('vitafluxly.com')
  })

  it('更新归属时保留原文，只改账户和网站', () => {
    const detail = {
      id: 9,
      title: '原标题',
      text: '<p>正文</p><img src="https://img.example/a.png">',
      firstP: '概览',
      metaTitle: 'meta',
      metaDescription: 'desc',
      terms: 't',
      outShow: '1',
      langId: 2,
      articleCategoryId: [3, 8],
      accountId: 1,
      siteId: 2,
      countryCode: 'US',
    }
    const payload = buildArticleUpdate(detail, 7, 11)
    expect(payload).toMatchObject({
      id: 9,
      title: '原标题',
      text: detail.text,
      firstP: '概览',
      accountId: 7,
      siteId: 11,
      articleCategoryId: 8,
      image: 'https://img.example/a.png',
    })
    expect(detail.accountId).toBe(1)
  })
})
