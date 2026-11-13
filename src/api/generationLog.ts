import { normalizeGenerationLog, type GenerationRecord } from '../domain/generationLog'

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body = (await response.json()) as { message?: string }
    if (body.message) {
      message = body.message
    }
  } catch {
    message = fallback
  }
  throw new Error(message)
}

export async function fetchGenerationLog(): Promise<GenerationRecord[]> {
  const response = await fetch('/local-api/generation-log')
  if (!response.ok) {
    return readError(response, '读取本地生成记录失败')
  }
  return normalizeGenerationLog(await response.json())
}

export async function insertGenerationRecord(record: GenerationRecord): Promise<GenerationRecord> {
  const response = await fetch('/local-api/generation-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  })
  if (!response.ok) {
    return readError(response, '写入本地生成记录失败')
  }
  const [saved] = normalizeGenerationLog([await response.json()])
  if (!saved) {
    throw new Error('写入本地生成记录失败')
  }
  return saved
}

export async function clearGenerationRecords(): Promise<void> {
  const response = await fetch('/local-api/generation-log', { method: 'DELETE' })
  if (!response.ok) {
    return readError(response, '清空本地生成记录失败')
  }
}
