import fs from 'node:fs'

const m = JSON.parse(fs.readFileSync('data/ops-center/metrics/2026-11-13/all.json', 'utf8')) as {
  statsList?: Array<Record<string, unknown>>
}
const rows = m.statsList || []
const sample = rows.find((r) => Number(r.revenue) > 1) || rows[0]
const zeroRevHighTraffic = rows
  .filter((r) => Number(r.visits) > 50 && Number(r.revenue || 0) === 0)
  .slice(0, 3)

console.log(
  JSON.stringify(
    {
      keys: Object.keys(sample || {}).sort(),
      sample,
      zeroRevHighTraffic,
    },
    null,
    2,
  ),
)
