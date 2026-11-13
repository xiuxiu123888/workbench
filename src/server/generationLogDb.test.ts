import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGenerationRecord } from '../domain/generationLog'
import { importLegacyGenerationLog, openGenerationLog } from './generationLogDb'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-log-'))
  dirs.push(dir)
  return dir
}

describe('生成记录数据库', () => {
  it('按时间倒序保存，并保留 ref 原文', () => {
    const store = openGenerationLog(path.join(tempDir(), 'data', 'generation-log.db'))
    const older = createGenerationRecord(
      {
        sourceArticleId: '12',
        newArticleId: '90',
        title: '旧标题',
        linkRef: 'Older',
        url: 'https://vitafluxly.com/detail/90?channel=1',
        siteName: 'vitafluxly.com',
        articleAccount: 'A1',
        afsAccount: 'AFS1',
        ok: true,
        message: '完成',
      },
      1,
      'old',
    )
    const newer = createGenerationRecord(
      {
        sourceArticleId: '34',
        newArticleId: '99',
        title: '新标题',
        linkRef: 'Drain Cleaning ',
        url: 'https://vitafluxly.com/detail/99?channel=5949606886',
        siteName: 'vitafluxly.com',
        articleAccount: 'A1',
        afsAccount: 'AFS1',
        ok: false,
        message: '复制失败',
      },
      2,
      'new',
    )
    store.insert(older)
    store.insert(newer)

    const listed = store.list()
    expect(listed.map((item) => item.id)).toEqual(['new', 'old'])
    expect(listed[0]?.linkRef).toBe('Drain Cleaning ')
    expect(listed[0]?.channel).toBe('5949606886')
    expect(listed[0]?.ok).toBe(false)

    store.clear()
    expect(store.list()).toEqual([])
    store.close()
  })

  it('空数据库会导入旧的 JSON 记录', () => {
    const dir = tempDir()
    const jsonPath = path.join(dir, 'generation-log.json')
    const record = createGenerationRecord(
      {
        sourceArticleId: '12',
        newArticleId: '99',
        title: '原标题',
        linkRef: 'Keep me ',
        url: 'https://vitafluxly.com/detail/99?channel=8',
        siteName: 'vitafluxly.com',
        articleAccount: 'A1',
        afsAccount: 'AFS1',
        ok: true,
        message: '完成',
      },
      3,
      'legacy',
    )
    fs.writeFileSync(jsonPath, JSON.stringify([record]), 'utf8')

    const store = openGenerationLog(path.join(dir, 'generation-log.db'))
    importLegacyGenerationLog(store, jsonPath)
    importLegacyGenerationLog(store, jsonPath)
    expect(store.list()).toEqual([record])
    store.close()
  })
})
