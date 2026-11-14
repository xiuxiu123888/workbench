import fs from 'node:fs'

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync('.env.local', 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

const env = loadEnvLocal()
const metrics = JSON.parse(fs.readFileSync('data/ops-center/metrics/2026-11-13/all.json', 'utf8')) as {
  statsList: Array<{ url?: string }>
}
const url = metrics.statsList.find((x) => String(x.url || '').includes('/detail/'))?.url || ''
const aid = url.match(/\/detail\/(\d+)/)?.[1]
if (!aid) throw new Error('no article')
console.log('aid', aid)

const res = await fetch(`${env.VITE_ARTICLE_API_TARGET.replace(/\/$/, '')}/article/detail`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.VITE_ARTICLE_TOKEN}`,
  },
  body: JSON.stringify({ id: aid }),
})
const body = (await res.json()) as { code?: number; data?: Record<string, unknown> }
const d = body.data || {}
const keys = Object.keys(d)
console.log(
  JSON.stringify(
    {
      keys: keys.filter((k) => /cat|class|type|lang|title|cate/i.test(k)),
      articleCategoryId: d.articleCategoryId,
      categoryId: d.categoryId,
      langId: d.langId,
      title: d.title,
    },
    null,
    2,
  ),
)
