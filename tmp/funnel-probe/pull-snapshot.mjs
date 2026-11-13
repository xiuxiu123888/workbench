import fs from 'fs'
import path from 'path'

const token = process.env.RUOYI_TOKEN
if (!token) {
  console.error('RUOYI_TOKEN missing')
  process.exit(1)
}

const base = 'https://adesmobi.com/ruoyi-back'
const outDir = 'tmp/funnel-probe/snapshot'
fs.mkdirSync(outDir, { recursive: true })

async function get(url) {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })
  const text = await r.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { parseError: true, text: text.slice(0, 200) }
  }
  return { status: r.status, body }
}

const listRes = await get(`${base}/funnel/funnel/list`)
if (listRes.body?.code !== 200) {
  console.error('list_fail', JSON.stringify(listRes.body).slice(0, 300))
  process.exit(1)
}

fs.writeFileSync(path.join(outDir, 'list.json'), JSON.stringify(listRes.body, null, 2))
const funnels = listRes.body.data || []
console.log('funnels', funnels.length)

const details = []
const groups = []
const errors = []
let i = 0

for (const f of funnels) {
  i += 1
  const d = await get(`${base}/funnel/funnel/detail?funnelId=${encodeURIComponent(f.funnelId)}`)
  if (d.body?.code !== 200) {
    errors.push({ type: 'detail', funnelId: f.funnelId, body: d.body })
    continue
  }

  const detail = {
    ...d.body.data,
    platform: f.platform,
    status: f.status,
    autoWeightEnabled: f.autoWeightEnabled,
    autoWeightRuleType: f.autoWeightRuleType,
  }
  details.push(detail)
  fs.writeFileSync(
    path.join(outDir, `detail-${f.funnelId}.json`),
    JSON.stringify({ code: 200, data: detail }, null, 2),
  )

  for (const g of detail.offerGroupList || []) {
    const og = await get(`${base}/funnel/offerGroup/getById?groupId=${encodeURIComponent(g.groupId)}`)
    if (og.body?.code !== 200) {
      errors.push({ type: 'offerGroup', groupId: g.groupId, funnelId: f.funnelId, body: og.body })
      continue
    }

    const data = {
      ...og.body.data,
      funnelId: f.funnelId,
      funnelName: f.funnelName,
      partnerName: f.partnerName,
      urlName: f.urlName,
      urlId: f.urlId,
      platform: f.platform,
    }
    groups.push(data)
    fs.writeFileSync(
      path.join(outDir, `group-${g.groupId}.json`),
      JSON.stringify({ code: 200, data }, null, 2),
    )
  }

  if (i % 15 === 0) console.log(`progress ${i}/${funnels.length} groups ${groups.length}`)
}

fs.writeFileSync(path.join(outDir, 'details.json'), JSON.stringify(details, null, 2))
fs.writeFileSync(path.join(outDir, 'groups.json'), JSON.stringify(groups, null, 2))
fs.writeFileSync(path.join(outDir, 'errors.json'), JSON.stringify(errors, null, 2))

console.log(
  JSON.stringify(
    {
      details: details.length,
      groups: groups.length,
      errors: errors.length,
      offers: groups.reduce((n, g) => n + (g.offerList || []).length, 0),
    },
    null,
    2,
  ),
)
