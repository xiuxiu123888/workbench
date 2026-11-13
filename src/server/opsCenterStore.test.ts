import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertOpsCenterRelativePath, readOpsCenterJson, writeOpsCenterJson } from './opsCenterStore'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('opsCenterStore', () => {
  it('writes and reads json under data/ops-center', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-center-'))
    tempRoots.push(root)
    writeOpsCenterJson(root, 'raw/list.json', { ok: true })
    expect(readOpsCenterJson<{ ok: boolean }>(root, 'raw/list.json')).toEqual({ ok: true })
    expect(fs.existsSync(path.join(root, 'data', 'ops-center', 'raw', 'list.json'))).toBe(true)
  })

  it('rejects path escape', () => {
    expect(() => assertOpsCenterRelativePath('../secret.json')).toThrow('非法路径')
    expect(() => assertOpsCenterRelativePath('other/x.json')).toThrow('只允许写入')
  })

  it('allows offer replace log path', () => {
    expect(assertOpsCenterRelativePath('offer-replace-log.json')).toBe('offer-replace-log.json')
  })

  it('allows seed-lexicon and offer-tags paths', () => {
    expect(assertOpsCenterRelativePath('seed-lexicon/by-category.json')).toBe(
      'seed-lexicon/by-category.json',
    )
    expect(assertOpsCenterRelativePath('seed-lexicon/meta.json')).toBe('seed-lexicon/meta.json')
    expect(assertOpsCenterRelativePath('offer-tags/by-offer.json')).toBe('offer-tags/by-offer.json')
  })

  it('allows optimize-batches paths', () => {
    expect(assertOpsCenterRelativePath('optimize-batches/index.json')).toBe(
      'optimize-batches/index.json',
    )
    expect(assertOpsCenterRelativePath('optimize-batches/opt-1.json')).toBe(
      'optimize-batches/opt-1.json',
    )
  })

  it('writes seed lexicon under data/ops-center', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-center-'))
    tempRoots.push(root)
    writeOpsCenterJson(root, 'seed-lexicon/by-category.json', { categories: [] })
    expect(readOpsCenterJson<{ categories: unknown[] }>(root, 'seed-lexicon/by-category.json')).toEqual({
      categories: [],
    })
  })
})
