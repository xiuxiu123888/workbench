import { describe, expect, it } from 'vitest'
import {
  formatFeishuSiteLines,
  metricsByCountry,
  normalizeCountryCode,
  resolveArticleCountry,
  revenueByCountry,
} from './feishuPushFormat'

describe('feishuPushFormat', () => {
  it('normalizes country codes', () => {
    expect(normalizeCountryCode(' jp ')).toBe('JP')
    expect(normalizeCountryCode('')).toBe('未标注')
    expect(resolveArticleCountry('1', new Map([['1', 'us']]), new Map())).toBe('US')
    expect(resolveArticleCountry('2', new Map(), new Map([['2', 'GB']]))).toBe('GB')
    expect(resolveArticleCountry('3', new Map(), new Map())).toBe('未标注')
  })

  it('splits channel revenue across countries that share it', () => {
    const revenues = revenueByCountry(
      [
        { channelId: 'a', countryCode: 'US' },
        { channelId: 'a', countryCode: 'JP' },
        { channelId: 'b', countryCode: 'JP' },
      ],
      new Map([
        ['a', 10],
        ['b', 4],
      ]),
    )
    expect(revenues.get('US')).toBe(5)
    expect(revenues.get('JP')).toBe(9)
  })

  it('marks country revenue missing when any channel is missing', () => {
    const revenues = revenueByCountry(
      [{ channelId: 'a', countryCode: 'US' }],
      new Map([['a', null]]),
    )
    expect(revenues.get('US')).toBeNull()
  })

  it('aggregates article stats by country', () => {
    const rows = metricsByCountry(
      [
        { articleId: '1', countryCode: 'US' },
        { articleId: '2', countryCode: 'JP' },
        { articleId: '3', countryCode: 'US' },
      ],
      new Map([
        ['1\n2026-11-04', { pageViews: 10, termClicks: 2, adClicks: 1 }],
        ['2\n2026-11-04', { pageViews: 5, termClicks: 1, adClicks: 0 }],
        ['3\n2026-11-04', { pageViews: 7, termClicks: 3, adClicks: 2 }],
      ]),
      '2026-11-04',
      new Map([
        ['US', 8],
        ['JP', 3],
      ]),
    )
    expect(rows[0]).toMatchObject({ countryCode: 'US', revenue: 8, pageViews: 17, termClicks: 5, adClicks: 3 })
    expect(rows[1]).toMatchObject({ countryCode: 'JP', revenue: 3, pageViews: 5 })
  })

  it('formats single country on the domain line', () => {
    expect(
      formatFeishuSiteLines(1, {
        label: 'example.com',
        revenue: 1.2,
        pageViews: 3,
        termClicks: 1,
        adClicks: 0,
        countries: [{ countryCode: 'JP', revenue: 1.2, pageViews: 3, termClicks: 1, adClicks: 0 }],
      }),
    ).toEqual(['1. example.com（JP）  收入 1.20  曝光 3  词点 1  广点 0'])
  })

  it('formats multi-country as indented lines', () => {
    expect(
      formatFeishuSiteLines(2, {
        label: 'example.com',
        revenue: 10,
        pageViews: 20,
        termClicks: 4,
        adClicks: 2,
        countries: [
          { countryCode: 'US', revenue: 6, pageViews: 12, termClicks: 3, adClicks: 1 },
          { countryCode: 'JP', revenue: 4, pageViews: 8, termClicks: 1, adClicks: 1 },
        ],
      }),
    ).toEqual([
      '2. example.com  收入 10.00  曝光 20  词点 4  广点 2',
      '   US  收入 6.00  曝光 12  词点 3  广点 1',
      '   JP  收入 4.00  曝光 8  词点 1  广点 1',
    ])
  })
})
