import { channelFromUrl } from './campaignForm'

export const GENERATION_LOG_LIMIT = 400

export interface GenerationDraft {
  sourceArticleId: string
  newArticleId: string
  title: string
  linkRef: string
  url: string
  siteName: string
  articleAccount: string
  afsAccount: string
  ok: boolean
  message: string
}

export interface GenerationRecord extends GenerationDraft {
  id: string
  createdAt: number
  channel: string
}

export function createGenerationRecord(draft: GenerationDraft, createdAt: number, id?: string): GenerationRecord {
  const url = draft.url.trim()
  return {
    id: id || `${createdAt}-${draft.sourceArticleId.trim()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    sourceArticleId: draft.sourceArticleId.trim(),
    newArticleId: draft.newArticleId.trim(),
    title: draft.title.trim(),
    linkRef: draft.linkRef,
    url,
    channel: channelFromUrl(url),
    siteName: draft.siteName.trim(),
    articleAccount: draft.articleAccount.trim(),
    afsAccount: draft.afsAccount.trim(),
    ok: draft.ok,
    message: draft.message.trim(),
  }
}

export function normalizeGenerationLog(raw: unknown): GenerationRecord[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const records: GenerationRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const row = item as Partial<GenerationRecord>
    if (typeof row.id !== 'string' || !row.id || typeof row.createdAt !== 'number' || !row.sourceArticleId) {
      continue
    }
    records.push(
      createGenerationRecord(
        {
          sourceArticleId: String(row.sourceArticleId),
          newArticleId: String(row.newArticleId ?? ''),
          title: String(row.title ?? ''),
          linkRef: String(row.linkRef ?? ''),
          url: String(row.url ?? ''),
          siteName: String(row.siteName ?? ''),
          articleAccount: String(row.articleAccount ?? ''),
          afsAccount: String(row.afsAccount ?? ''),
          ok: Boolean(row.ok),
          message: String(row.message ?? ''),
        },
        row.createdAt,
        row.id,
      ),
    )
  }
  return records
}

export function prependGenerationRecord(
  current: GenerationRecord[],
  record: GenerationRecord,
  limit = GENERATION_LOG_LIMIT,
): GenerationRecord[] {
  return [record, ...current].slice(0, limit)
}

export function filterGenerationLog(records: GenerationRecord[], query: string): GenerationRecord[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return records
  }
  return records.filter((record) =>
    [
      record.sourceArticleId,
      record.newArticleId,
      record.title,
      record.linkRef,
      record.url,
      record.channel,
      record.siteName,
      record.articleAccount,
      record.afsAccount,
      record.message,
    ]
      .join('\n')
      .toLowerCase()
      .includes(needle),
  )
}
