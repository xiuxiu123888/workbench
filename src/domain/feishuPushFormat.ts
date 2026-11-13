import { formatMoney } from './report'

export interface CountryMetric {
  countryCode: string
  revenue: number | null
  pageViews: number
  termClicks: number
  adClicks: number
}

export interface FeishuSiteRow {
  label: string
  revenue: number | null
  pageViews: number
  termClicks: number
  adClicks: number
  countries: CountryMetric[]
}

export function normalizeCountryCode(code: string): string {
  const text = String(code ?? '').trim().toUpperCase()
  return text || '未标注'
}

export function resolveArticleCountry(
  articleId: string,
  fromRecent: Map<string, string>,
  fromKept: Map<string, string>,
): string {
  return normalizeCountryCode(fromRecent.get(articleId) || fromKept.get(articleId) || '')
}

/** 渠道收入按使用该渠道的国家分摊；一国独用则全记入该国。 */
export function revenueByCountry(
  links: Array<{ channelId: string; countryCode: string }>,
  channelRevenues: Map<string, number | null>,
): Map<string, number | null> {
  const channelCountries = new Map<string, Set<string>>()
  for (const link of links) {
    const channelId = link.channelId.trim()
    if (!channelId) {
      continue
    }
    const code = normalizeCountryCode(link.countryCode)
    const set = channelCountries.get(channelId) ?? new Set<string>()
    set.add(code)
    channelCountries.set(channelId, set)
  }

  const totals = new Map<string, { sum: number; missing: boolean }>()
  const touch = (code: string, amount: number | null) => {
    const current = totals.get(code) ?? { sum: 0, missing: false }
    if (amount == null) {
      current.missing = true
    } else {
      current.sum += amount
    }
    totals.set(code, current)
  }

  for (const [channelId, countries] of channelCountries) {
    const revenue = channelRevenues.has(channelId) ? channelRevenues.get(channelId)! : null
    const share = revenue == null ? null : revenue / countries.size
    for (const code of countries) {
      touch(code, share)
    }
  }

  const result = new Map<string, number | null>()
  for (const [code, value] of totals) {
    result.set(code, value.missing ? null : value.sum)
  }
  return result
}

export function metricsByCountry(
  links: Array<{ articleId: string; countryCode: string }>,
  stats: Map<string, { pageViews: number; termClicks: number; adClicks: number }>,
  day: string,
  revenues: Map<string, number | null>,
): CountryMetric[] {
  const buckets = new Map<string, { pageViews: number; termClicks: number; adClicks: number }>()
  for (const link of links) {
    const code = normalizeCountryCode(link.countryCode)
    const stat = stats.get(`${link.articleId}\n${day}`)
    const current = buckets.get(code) ?? { pageViews: 0, termClicks: 0, adClicks: 0 }
    current.pageViews += stat?.pageViews ?? 0
    current.termClicks += stat?.termClicks ?? 0
    current.adClicks += stat?.adClicks ?? 0
    buckets.set(code, current)
  }

  const codes = new Set([...buckets.keys(), ...revenues.keys()])
  if (codes.size === 0) {
    codes.add('未标注')
  }

  return [...codes]
    .map((countryCode) => {
      const bucket = buckets.get(countryCode) ?? { pageViews: 0, termClicks: 0, adClicks: 0 }
      return {
        countryCode,
        revenue: revenues.has(countryCode) ? revenues.get(countryCode)! : null,
        pageViews: bucket.pageViews,
        termClicks: bucket.termClicks,
        adClicks: bucket.adClicks,
      }
    })
    .sort((a, b) => {
      if (a.revenue == null && b.revenue == null) {
        return a.countryCode.localeCompare(b.countryCode)
      }
      if (a.revenue == null) {
        return 1
      }
      if (b.revenue == null) {
        return -1
      }
      return b.revenue - a.revenue || a.countryCode.localeCompare(b.countryCode)
    })
}

function metricLine(prefix: string, row: {
  revenue: number | null
  pageViews: number
  termClicks: number
  adClicks: number
}): string {
  const revenue = row.revenue == null ? '—' : formatMoney(row.revenue)
  return `${prefix}  收入 ${revenue}  曝光 ${row.pageViews}  词点 ${row.termClicks}  广点 ${row.adClicks}`
}

/** 返回域名行；多国家时附带缩进的国家明细行。 */
export function formatFeishuSiteLines(index: number, row: FeishuSiteRow): string[] {
  const countries = row.countries.filter((item) => item.countryCode)
  if (countries.length <= 1) {
    const code = countries[0]?.countryCode
    const label = code && code !== '未标注' ? `${row.label}（${code}）` : row.label
    return [metricLine(`${index}. ${label}`, row)]
  }
  return [
    metricLine(`${index}. ${row.label}`, row),
    ...countries.map((item) => metricLine(`   ${item.countryCode}`, item)),
  ]
}
