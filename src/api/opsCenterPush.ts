export async function pushOpsCenterTextToFeishu(text: string): Promise<string> {
  const response = await fetch('/local-api/feishu-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  let message = '发送分析报告到飞书失败'
  try {
    const body = (await response.json()) as { message?: string }
    if (body.message) {
      message = body.message
    }
  } catch {
    // keep fallback
  }
  if (!response.ok) {
    throw new Error(message)
  }
  return message
}
