export type SeedLexiconItem = {
  keyword: string
  regionId?: string | null
  ref?: string | null
  intentKeyword?: string | null
}

export type SeedLexiconCategory = {
  categoryKey: string
  categoryId?: number | null
  seeds: SeedLexiconItem[]
}

export type SeedLexiconFile = {
  updatedAt: string
  categories: SeedLexiconCategory[]
}

export type OfferTagRecord = {
  categoryKey: string
  note?: string | null
}

export type OfferTagsFile = {
  updatedAt: string
  offers: Record<string, OfferTagRecord>
}

export function emptySeedLexicon(now = new Date()): SeedLexiconFile {
  return {
    updatedAt: now.toISOString(),
    categories: [],
  }
}

export function emptyOfferTags(now = new Date()): OfferTagsFile {
  return {
    updatedAt: now.toISOString(),
    offers: {},
  }
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeSeed(raw: Partial<SeedLexiconItem> | null | undefined): SeedLexiconItem | null {
  const keyword = cleanText(raw?.keyword)
  if (!keyword) {
    return null
  }
  const intent = cleanText(raw?.intentKeyword) || keyword
  const ref = cleanText(raw?.ref) || keyword
  const regionId = cleanText(raw?.regionId) || null
  return {
    keyword,
    intentKeyword: intent,
    ref,
    regionId,
  }
}

/** 合并同 categoryKey，去空词；保持稳定顺序 */
export function normalizeSeedLexicon(raw: Partial<SeedLexiconFile> | null | undefined): SeedLexiconFile {
  const map = new Map<string, SeedLexiconCategory>()
  for (const row of raw?.categories || []) {
    const categoryKey = cleanText(row?.categoryKey)
    if (!categoryKey) {
      continue
    }
    const categoryId =
      row?.categoryId == null || Number.isNaN(Number(row.categoryId)) ? null : Number(row.categoryId)
    const existing = map.get(categoryKey) || {
      categoryKey,
      categoryId,
      seeds: [] as SeedLexiconItem[],
    }
    if (existing.categoryId == null && categoryId != null) {
      existing.categoryId = categoryId
    }
    // 同品类下：国家 + 关键词 才算重复（同词不同国家保留）
    const seen = new Set(
      existing.seeds.map((item) => `${String(item.regionId || '').toLowerCase()}::${item.keyword.toLowerCase()}`),
    )
    for (const seed of row?.seeds || []) {
      const next = normalizeSeed(seed)
      if (!next) {
        continue
      }
      const key = `${String(next.regionId || '').toLowerCase()}::${next.keyword.toLowerCase()}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      existing.seeds.push(next)
    }
    map.set(categoryKey, existing)
  }
  return {
    updatedAt: cleanText(raw?.updatedAt) || new Date().toISOString(),
    categories: [...map.values()],
  }
}

export function normalizeOfferTags(raw: Partial<OfferTagsFile> | null | undefined): OfferTagsFile {
  const offers: Record<string, OfferTagRecord> = {}
  for (const [offerId, row] of Object.entries(raw?.offers || {})) {
    const id = cleanText(offerId)
    const categoryKey = cleanText(row?.categoryKey)
    if (!id || !categoryKey) {
      continue
    }
    offers[id] = {
      categoryKey,
      note: cleanText(row?.note) || null,
    }
  }
  return {
    updatedAt: cleanText(raw?.updatedAt) || new Date().toISOString(),
    offers,
  }
}

export function listSeedsForCategories(
  lexicon: SeedLexiconFile,
  categoryKeys?: string[] | null,
  regionIds?: string[] | null,
): Array<SeedLexiconItem & { categoryKey: string; categoryId?: number | null }> {
  const allow =
    categoryKeys && categoryKeys.length > 0
      ? new Set(categoryKeys.map((item) => item.trim()).filter(Boolean))
      : null
  const regions =
    regionIds && regionIds.length > 0
      ? new Set(regionIds.map((item) => item.trim().toUpperCase()).filter(Boolean))
      : null
  const out: Array<SeedLexiconItem & { categoryKey: string; categoryId?: number | null }> = []
  for (const category of lexicon.categories) {
    if (allow && !allow.has(category.categoryKey)) {
      continue
    }
    for (const seed of category.seeds) {
      const region = String(seed.regionId || '').trim().toUpperCase()
      if (regions && !regions.has(region)) {
        continue
      }
      out.push({
        ...seed,
        categoryKey: category.categoryKey,
        categoryId: category.categoryId ?? null,
      })
    }
  }
  return out
}

/** 词库里出现过的国家/地区代码 */
export function listSeedRegions(lexicon: SeedLexiconFile): string[] {
  const set = new Set<string>()
  for (const category of lexicon.categories) {
    for (const seed of category.seeds) {
      const region = cleanText(seed.regionId)
      if (region) {
        set.add(region.toUpperCase())
      }
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}
