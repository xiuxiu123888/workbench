import { misReady, serviceConfig } from '../config/env'
import { rewriteOfferUrlArticleAndRef } from '../domain/funnelOfferGenerate'
import { createClient, unwrapMis } from './http'

const client = misReady
  ? createClient('/mis-api', serviceConfig.misToken, 'MIS', {
      ClientID: serviceConfig.misClientId,
    })
  : null

function assertClient() {
  if (!client) {
    throw new Error('MIS 接口尚未配置，无法读写 offer')
  }
  return client
}

export interface LandpulseOfferDetail {
  id?: number | string
  offerId: string
  offerName?: string | null
  offerCategoryId?: string | null
  status?: string | null
  url?: string | null
  campaignId?: string | number | null
  funnelAccountId?: string | number | null
  offerSourceId?: string | null
  resultUrl?: string | null
  terms?: string | null
  ref?: string | null
  sourceChannelId?: string | null
  articleId?: string | null
  countryCode?: string | null
}

export interface LandpulseOfferUpdatePayload {
  offerId: string
  offerCategoryId: string | null
  offerName: string
  url: string | null
  offerSourceId: string | null
  campaignId: string | number | null
  resultUrl: string
}

export async function getLandpulseOfferById(offerId: string): Promise<LandpulseOfferDetail> {
  const response = await assertClient().get('/landpulse/offer/getById', {
    params: { offerId },
  })
  return unwrapMis<LandpulseOfferDetail>(response.data)
}

export async function updateLandpulseOffer(payload: LandpulseOfferUpdatePayload): Promise<void> {
  const response = await assertClient().put('/landpulse/offer/update', payload)
  unwrapMis(response.data)
}

export interface LandpulseOfferCategory {
  categoryId: string
  categoryName: string
  raw?: Record<string, unknown>
}

export interface LandpulseOfferAddPayload {
  offerCategoryId: string
  offerName: string
  countryCode: string
  url: string
  offerSourceId: string
  resultUrl: string
}

function normalizeOfferCategory(item: Record<string, unknown>): LandpulseOfferCategory | null {
  const categoryId = String(
    item.categoryId ?? item.id ?? item.offerCategoryId ?? item.value ?? '',
  ).trim()
  const categoryName = String(
    item.categoryName ?? item.name ?? item.label ?? item.dictLabel ?? categoryId,
  ).trim()
  if (!categoryId) {
    return null
  }
  return { categoryId, categoryName: categoryName || categoryId, raw: item }
}

/** GET /landpulse/category/listByType?categoryType=offer */
export async function listOfferCategories(): Promise<LandpulseOfferCategory[]> {
  const response = await assertClient().get('/landpulse/category/listByType', {
    params: { categoryType: 'offer' },
  })
  const data = unwrapMis<unknown>(response.data)
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { list?: unknown }).list)
      ? ((data as { list: unknown[] }).list)
      : data && typeof data === 'object' && Array.isArray((data as { records?: unknown }).records)
        ? ((data as { records: unknown[] }).records)
        : []
  const out: LandpulseOfferCategory[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const normalized = normalizeOfferCategory(item as Record<string, unknown>)
    if (normalized) out.push(normalized)
  }
  return out
}

function pickCreatedOfferId(data: unknown): string {
  if (typeof data === 'string' || typeof data === 'number') {
    return String(data).trim()
  }
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    const id = record.offerId ?? record.id ?? record.data
    if (id != null && String(id).trim()) {
      return String(id).trim()
    }
  }
  return ''
}

/** POST /landpulse/offer/add */
export async function addLandpulseOffer(payload: LandpulseOfferAddPayload): Promise<string> {
  const response = await assertClient().post('/landpulse/offer/add', {
    offerCategoryId: String(payload.offerCategoryId || '').trim() || '-1',
    offerName: String(payload.offerName || '').trim(),
    countryCode: String(payload.countryCode || 'US').trim() || 'US',
    url: String(payload.url || '').trim(),
    offerSourceId: String(payload.offerSourceId || '').trim(),
    resultUrl: String(payload.resultUrl || '').trim(),
  })
  const data = unwrapMis<unknown>(response.data)
  const offerId = pickCreatedOfferId(data)
  if (!offerId) {
    // 有的环境只回成功不回 id
    return ''
  }
  return offerId
}

/**
 * 先拉详情再回写：
 * - resultUrl：整条新落地链（含 subid 等）
 * - url：只在原 url 上替换文章 id 与 ref
 */
export async function replaceLandpulseOfferResultUrl(
  offerId: string,
  newResultUrl: string,
  rewrite?: { articleId: string; ref?: string | null },
): Promise<LandpulseOfferDetail> {
  const detail = await getLandpulseOfferById(offerId)
  const nextResultUrl = String(newResultUrl || '').trim()
  if (!nextResultUrl) {
    throw new Error('缺少新的 resultUrl')
  }

  const articleId = String(rewrite?.articleId || '').trim()
  const ref = rewrite?.ref
  let nextOfferUrl = detail.url ?? null
  if (articleId) {
    const baseUrl = String(detail.url || '').trim()
    if (baseUrl) {
      const rewritten = rewriteOfferUrlArticleAndRef(baseUrl, articleId, ref)
      if (!rewritten) {
        throw new Error('无法改写 offer.url 中的文章 id / ref')
      }
      nextOfferUrl = rewritten
    }
  }

  await updateLandpulseOffer({
    offerId: detail.offerId || offerId,
    offerCategoryId: detail.offerCategoryId ?? null,
    offerName: String(detail.offerName || '').trim() || offerId,
    url: nextOfferUrl,
    offerSourceId: detail.offerSourceId ?? null,
    campaignId: detail.campaignId ?? null,
    resultUrl: nextResultUrl,
  })
  return {
    ...detail,
    url: nextOfferUrl,
    resultUrl: nextResultUrl,
  }
}
