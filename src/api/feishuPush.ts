export async function pushDailyToFeishu(kind: 'today' | 'yesterday'): Promise<string> {
  const response = await fetch('/local-api/feishu-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  })
  let message = kind === 'yesterday' ? '发送昨日到飞书失败' : '发送今日到飞书失败'
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
