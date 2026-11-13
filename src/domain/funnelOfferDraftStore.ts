export type FunnelOfferDraftStatus = 'running' | 'ready' | 'failed'

export interface FunnelOfferDraftJob {
  key: string
  funnelId: string
  funnelName: string
  offerId: string
  offerName: string
  groupId: string
  groupName: string
  oldLandingUrl: string | null
  channelId: string | null
  categoryName: string | null
  seedKeyword: string
  taskId: string
  itemId?: string | number
  articleId?: string
  /** 已按旧链拼好的新落地 URL（预览直接打开） */
  newLandingUrl?: string | null
  status: FunnelOfferDraftStatus
  note: string
  updatedAt: string
}

export const FUNNEL_OFFER_DRAFT_KEY = 'workbench.funnel-offer-drafts.v1'
export const FUNNEL_OFFER_DRAFT_LIMIT = 500

export function draftKey(funnelId: string, offerId: string): string {
  return `${funnelId}:${offerId}`
}

export function loadFunnelOfferDrafts(
  storage: Pick<Storage, 'getItem'> = localStorage,
): FunnelOfferDraftJob[] {
  try {
    const text = storage.getItem(FUNNEL_OFFER_DRAFT_KEY)
    if (!text) {
      return []
    }
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item): item is FunnelOfferDraftJob => Boolean(item && typeof item === 'object' && (item as FunnelOfferDraftJob).key))
      .slice(0, FUNNEL_OFFER_DRAFT_LIMIT)
  } catch {
    return []
  }
}

export function saveFunnelOfferDrafts(
  jobs: FunnelOfferDraftJob[],
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(FUNNEL_OFFER_DRAFT_KEY, JSON.stringify(jobs.slice(0, FUNNEL_OFFER_DRAFT_LIMIT)))
}

export function upsertFunnelOfferDraft(
  jobs: FunnelOfferDraftJob[],
  next: FunnelOfferDraftJob,
): FunnelOfferDraftJob[] {
  return [next, ...jobs.filter((job) => job.key !== next.key)].slice(0, FUNNEL_OFFER_DRAFT_LIMIT)
}

/** 去掉 seedKeyword / newLandingUrl.ref 中的数字 0（产文/投放侧不要带 0） */
export function stripZeroFromDraftRef(text: string): string {
  return String(text || '')
    .replace(/0%/gi, '')
    .replace(/0/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+%/g, '%')
    .replace(/%\s+/g, '%')
    .trim()
}

export function sanitizeDraftRefZeros(job: FunnelOfferDraftJob): FunnelOfferDraftJob {
  const seed = String(job.seedKeyword || '')
  let nextSeed = seed
  let nextUrl = job.newLandingUrl == null ? job.newLandingUrl : String(job.newLandingUrl)
  let changed = false

  if (seed.includes('0')) {
    nextSeed = stripZeroFromDraftRef(seed)
    changed = nextSeed !== seed
  }

  if (nextUrl && nextUrl.includes('ref=')) {
    try {
      const u = new URL(nextUrl)
      const ref = u.searchParams.get('ref') || ''
      if (ref.includes('0')) {
        const cleaned = stripZeroFromDraftRef(ref)
        if (cleaned && cleaned !== ref) {
          u.searchParams.set('ref', cleaned)
          nextUrl = u.toString().replace(/%7Bhit%7D/gi, '{hit}')
          if (!nextSeed || nextSeed.includes('0')) {
            nextSeed = cleaned
          }
          changed = true
        }
      }
    } catch {
      // ignore bad url
    }
  }

  if (!changed) {
    return job
  }
  return {
    ...job,
    seedKeyword: nextSeed,
    newLandingUrl: nextUrl,
    updatedAt: new Date().toISOString(),
  }
}

export function sanitizeDraftJobsRefZeros(jobs: FunnelOfferDraftJob[]): FunnelOfferDraftJob[] {
  return jobs.map((job) => sanitizeDraftRefZeros(job))
}

/** 按 key 合并；同 key 取 updatedAt 更新的一方 */
export function mergeFunnelOfferDrafts(
  local: FunnelOfferDraftJob[],
  remote: FunnelOfferDraftJob[],
): FunnelOfferDraftJob[] {
  const map = new Map<string, FunnelOfferDraftJob>()
  for (const job of remote) {
    if (job?.key) {
      map.set(job.key, job)
    }
  }
  for (const job of local) {
    if (!job?.key) {
      continue
    }
    const prev = map.get(job.key)
    // 仅当 local 严格更新才覆盖；时间相同保留 remote，避免浏览器旧缓存把磁盘改动盖回去
    if (!prev || String(job.updatedAt || '') > String(prev.updatedAt || '')) {
      map.set(job.key, job)
    }
  }
  return [...map.values()]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, FUNNEL_OFFER_DRAFT_LIMIT)
}
