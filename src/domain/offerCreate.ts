import { buildDirectLandingUrl, siteOrigin } from './campaignForm'
import { preserveHitPlaceholder } from './funnelOfferGenerate'

export type OfferCreateStep =
  | 'idle'
  | 'campaign'
  | 'orchestrate'
  | 'poll'
  | 'buildUrl'
  | 'addOffer'
  | 'done'
  | 'failed'

export const OFFER_CREATE_STEP_LABEL: Record<OfferCreateStep, string> = {
  idle: '等待',
  campaign: '创建渠道',
  orchestrate: '发起编排',
  poll: '等待产文',
  buildUrl: '拼落地链',
  addOffer: '创建 Offer',
  done: '完成',
  failed: '失败',
}

export interface OfferCreateBatchDefaults {
  domain: string
  accountLabel: string
  afsLabel: string
  version: string
  partner: string
  countryCode: string
  articleCategoryId: number
  offerCategoryId: string
  offerSourceId: string
  languageId: number | null
  regionId: string
}

export interface OfferCreateRowInput {
  id: string
  partner: string
  ref: string
  channelId: string
  funnelId?: string
  funnelName?: string
}

export interface OfferCreateRowState extends OfferCreateRowInput {
  funnelId: string
  funnelName: string
  step: OfferCreateStep
  note: string
  taskId: string
  articleId: string
  offerName: string
  url: string
  resultUrl: string
  offerId: string
  error: string
}

/** 美妆词库四词，按漏斗顺序轮询 */
export const COSMETIC_SEED_ROTATION = [
  'Cosmetic Products',
  'Cosmetics and Beauty Products',
  'Cosmetics Products',
  'Best Beauty Products for Mature Skin',
] as const

export function defaultOfferCreateBatch(): OfferCreateBatchDefaults {
  return {
    domain: 'seekmoon.ai',
    accountLabel: 'A17',
    afsLabel: 'AFS17',
    version: 'v0x',
    partner: 'blinkdrama',
    countryCode: 'US',
    articleCategoryId: 5162,
    offerCategoryId: '',
    offerSourceId: '43AnIa0hlCrd',
    languageId: null,
    regionId: 'US',
  }
}

export function bareHost(domain: string): string {
  const text = String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  return text.split('/')[0] || ''
}

/**
 * 有漏斗名时：{funnelName}-A17-us-{channel}-{domain}
 * 否则：{partner}-v0x-A17-us-{channel}-{domain}
 */
export function buildOfferCreateName(input: {
  partner: string
  version: string
  accountCode: string
  countryCode: string
  channelId: string
  domain: string
  funnelName?: string
}): string {
  const account = String(input.accountCode || 'A17').trim() || 'A17'
  const country = String(input.countryCode || 'US')
    .trim()
    .toLowerCase() || 'us'
  const channel = String(input.channelId || '').trim()
  const domain = bareHost(input.domain)
  const funnelName = String(input.funnelName || '').trim().replace(/\s+/g, '')
  if (funnelName) {
    return `${funnelName}-${account}-${country}-${channel}-${domain}`
  }
  const partner = String(input.partner || '')
    .trim()
    .replace(/\s+/g, '')
  const version = String(input.version || 'v0x').trim() || 'v0x'
  return `${partner}-${version}-${account}-${country}-${channel}-${domain}`
}

export function rotateCosmeticSeed(index: number, seeds: readonly string[] = COSMETIC_SEED_ROTATION): string {
  if (!seeds.length) return ''
  const i = ((index % seeds.length) + seeds.length) % seeds.length
  return seeds[i]
}

/** 按白名单顺序 + 美妆词轮询生成创建行（funnels 需已是白名单子集或将被过滤） */
export function buildRowsFromAllowlistFunnels(
  funnels: Array<{ funnelId: string; funnelName: string }>,
  options?: {
    allowNames?: readonly string[]
    seeds?: readonly string[]
    isAllowed?: (name: string) => boolean
  },
): OfferCreateRowInput[] {
  const seeds = options?.seeds?.length ? options.seeds : COSMETIC_SEED_ROTATION
  const allowNames = options?.allowNames
  const allowSet = allowNames ? new Set(allowNames.map((n) => n.toLowerCase())) : null
  const isAllowed =
    options?.isAllowed ||
    ((name: string) => (allowSet ? allowSet.has(name.trim().toLowerCase()) : true))

  const ordered = allowNames?.length
    ? allowNames
        .map((name) => {
          const hit = funnels.find(
            (f) => String(f.funnelName || '').trim().toLowerCase() === name.toLowerCase(),
          )
          return hit || null
        })
        .filter((f): f is { funnelId: string; funnelName: string } => Boolean(f))
    : funnels.filter((f) => isAllowed(String(f.funnelName || '')))

  return ordered.map((funnel, index) => {
    const funnelName = String(funnel.funnelName || '').trim()
    return {
      id: `funnel-${funnel.funnelId || index}`,
      funnelId: String(funnel.funnelId || '').trim(),
      funnelName,
      partner: funnelName,
      ref: rotateCosmeticSeed(index, seeds),
      channelId: '',
    }
  })
}

export function buildOfferCreateUrls(input: {
  domain: string
  articleId: string
  channelId: string
  ref: string
}): { url: string; resultUrl: string } {
  const domain = bareHost(input.domain)
  const articleId = String(input.articleId || '').trim()
  const channelId = String(input.channelId || '').trim()
  const ref = String(input.ref || '').trim()
  const landing = buildDirectLandingUrl(domain, articleId, channelId, ref)
  const withHit = preserveHitPlaceholder(`${landing}${landing.includes('?') ? '&' : '?'}hit={hit}`)
  return { url: landing, resultUrl: withHit }
}

/** 简易 url：仅 detail + ref（样例形态）；正式仍用 buildOfferCreateUrls */
export function buildSimpleOfferUrls(input: {
  domain: string
  articleId: string
  ref: string
}): { url: string; resultUrl: string } {
  const origin = siteOrigin(bareHost(input.domain))
  const articleId = String(input.articleId || '').trim()
  const params = new URLSearchParams()
  params.set('ref', String(input.ref || '').trim())
  const url = `${origin}/detail/${articleId}?${params.toString()}`
  return {
    url,
    resultUrl: preserveHitPlaceholder(`${url}&hit={hit}`),
  }
}

export function emptyOfferCreateRow(partial?: Partial<OfferCreateRowInput>): OfferCreateRowState {
  return {
    id: partial?.id || `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    partner: String(partial?.partner || '').trim(),
    ref: String(partial?.ref || ''),
    channelId: String(partial?.channelId || '').trim(),
    funnelId: String(partial?.funnelId || '').trim(),
    funnelName: String(partial?.funnelName || '').trim(),
    step: 'idle',
    note: '',
    taskId: '',
    articleId: '',
    offerName: '',
    url: '',
    resultUrl: '',
    offerId: '',
    error: '',
  }
}

export function parseOfferCreateLines(text: string, defaultPartner: string): OfferCreateRowInput[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const rows: OfferCreateRowInput[] = []
  for (const line of lines) {
    // partner\tref 或 partner,ref 或 仅 ref
    const parts = line.includes('\t')
      ? line.split('\t')
      : line.includes(',')
        ? line.split(',')
        : [line]
    if (parts.length >= 2) {
      const partner = parts[0].trim() || defaultPartner
      const ref = parts.slice(1).join(',').trim()
      if (!ref) continue
      rows.push({
        id: `row-${Date.now()}-${rows.length}-${Math.random().toString(36).slice(2, 6)}`,
        partner,
        ref,
        channelId: '',
      })
    } else {
      rows.push({
        id: `row-${Date.now()}-${rows.length}-${Math.random().toString(36).slice(2, 6)}`,
        partner: defaultPartner,
        ref: parts[0],
        channelId: '',
      })
    }
  }
  return rows
}

export function matchAccountByLabel(
  accounts: Array<{ id: number | string; name: string }>,
  label: string,
): { id: number | string; name: string } | null {
  const want = String(label || '')
    .trim()
    .toLowerCase()
  if (!want) return null
  const exact = accounts.find((a) => String(a.name || '').trim().toLowerCase() === want)
  if (exact) return exact
  return (
    accounts.find((a) =>
      String(a.name || '')
        .toLowerCase()
        .includes(want),
    ) || null
  )
}

export function matchAfsByLabel(
  options: Array<{ label: string; value: string }>,
  label: string,
): { label: string; value: string } | null {
  const want = String(label || '')
    .trim()
    .toLowerCase()
  if (!want) return null
  const exact =
    options.find((o) => String(o.label || '').trim().toLowerCase() === want) ||
    options.find((o) => String(o.value || '').trim().toLowerCase() === want)
  if (exact) return exact
  return (
    options.find(
      (o) =>
        String(o.label || '')
          .toLowerCase()
          .includes(want) ||
        String(o.value || '')
          .toLowerCase()
          .includes(want),
    ) || null
  )
}

export function matchSiteByDomain(
  sites: Array<{ id: number | string; siteName: string; siteUrl?: string; accountId?: number | string }>,
  domain: string,
  accountId?: number | string,
): (typeof sites)[number] | null {
  const want = bareHost(domain).toLowerCase()
  if (!want) return null
  const pool =
    accountId == null || accountId === ''
      ? sites
      : sites.filter((s) => String(s.accountId ?? '') === String(accountId))
  const scored = pool
    .map((site) => {
      const name = bareHost(site.siteName || '').toLowerCase()
      const url = bareHost(site.siteUrl || '').toLowerCase()
      let score = 0
      if (name === want || url === want) score = 3
      else if (name.includes(want) || url.includes(want) || want.includes(name)) score = 2
      return { site, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.site || null
}
