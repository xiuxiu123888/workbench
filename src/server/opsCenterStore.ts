import fs from 'node:fs'
import path from 'node:path'

export function opsCenterRoot(projectRoot: string): string {
  return path.join(projectRoot, 'data', 'ops-center')
}

export function assertOpsCenterRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error('非法路径')
  }
  if (
    normalized !== 'meta.json' &&
    normalized !== 'report.json' &&
    normalized !== 'offer-replace-log.json' &&
    normalized !== 'funnel-offer-drafts.json' &&
    !normalized.startsWith('raw/') &&
    !normalized.startsWith('metrics/') &&
    !normalized.startsWith('hourly/') &&
    !normalized.startsWith('seed-lexicon/') &&
    !normalized.startsWith('offer-tags/') &&
    !normalized.startsWith('optimize-batches/')
  ) {
    throw new Error(
      '只允许写入 raw/、metrics/、hourly/、seed-lexicon/、offer-tags/、optimize-batches/、meta.json、report.json、offer-replace-log.json、funnel-offer-drafts.json',
    )
  }
  return normalized
}

export function writeOpsCenterJson(projectRoot: string, relativePath: string, data: unknown): string {
  const safe = assertOpsCenterRelativePath(relativePath)
  const full = path.join(opsCenterRoot(projectRoot), safe)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, JSON.stringify(data, null, 2), 'utf8')
  return safe
}

export function readOpsCenterJson<T>(projectRoot: string, relativePath: string): T | null {
  const safe = assertOpsCenterRelativePath(relativePath)
  const full = path.join(opsCenterRoot(projectRoot), safe)
  if (!fs.existsSync(full)) {
    return null
  }
  return JSON.parse(fs.readFileSync(full, 'utf8')) as T
}

export function listOpsCenterMetricDays(projectRoot: string): string[] {
  const dir = path.join(opsCenterRoot(projectRoot), 'metrics')
  if (!fs.existsSync(dir)) {
    return []
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}
