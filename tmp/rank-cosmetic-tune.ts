import fs from 'node:fs'
import { summarizeTuneBySeed, verdictOfItem } from '../src/domain/offerOptimizeBatch'

const batch = JSON.parse(
  fs.readFileSync('data/ops-center/optimize-batches/opt-cosmetic-20261113.json', 'utf8'),
) as { items: any[] }

const rows = batch.items.map((i) => {
  const v = verdictOfItem(i)
  const s = i.after || i.before
  return {
    verdict: v,
    offerId: i.offerId,
    offer: i.offerName,
    funnel: i.funnelName,
    partner: i.partner,
    seed: i.plannedSeedRef || i.afterRef,
    beforeRef: i.beforeRef,
    rpm: Number(s.funnelRpm || 0),
    second: Number(s.secondHopPct || 0),
    fc: Number(s.funnelClicks || 0),
    ad: Number(s.adClicks || 0),
    rev: Number(s.revenue || 0),
  }
})

const bad = rows.filter((r) => r.verdict === 'bad').sort((a, b) => b.fc - a.fc)
const watch = rows.filter((r) => r.verdict === 'watch').sort((a, b) => b.fc - a.fc)
const good = rows.filter((r) => r.verdict === 'good')

console.log(
  JSON.stringify(
    {
      counts: { good: good.length, watch: watch.length, bad: bad.length },
      seedSummary: summarizeTuneBySeed(batch.items),
      adjustPriority: [...bad, ...watch].slice(0, 20),
    },
    null,
    2,
  ),
)
