import fs from 'node:fs'
import path from 'node:path'

const nameRe = /-A17-/i
const byId = new Map<string, string>()
const byName = new Set<string>()
const sources = new Map<string, number>()

function walk(dir: string) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      walk(p)
      continue
    }
    if (!ent.name.endsWith('.json')) continue
    let text = ''
    try {
      text = fs.readFileSync(p, 'utf8')
    } catch {
      continue
    }
    if (!text.includes('A17')) continue
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      continue
    }
    const stack: unknown[] = [json]
    while (stack.length) {
      const cur = stack.pop()
      if (Array.isArray(cur)) {
        for (const item of cur) stack.push(item)
        continue
      }
      if (!cur || typeof cur !== 'object') continue
      const rec = cur as Record<string, unknown>
      const name = String(rec.offerName ?? rec.name ?? '')
      const id = String(rec.offerId ?? (nameRe.test(name) ? rec.id ?? '' : '')).trim()
      if (nameRe.test(name)) {
        byName.add(name)
        if (id) byId.set(id, name)
        sources.set(p, (sources.get(p) || 0) + 1)
      }
      for (const v of Object.values(rec)) {
        if (v && typeof v === 'object') stack.push(v)
      }
    }
  }
}

walk('data/ops-center')

const out = {
  uniqueOfferNames: byName.size,
  uniqueOfferIds: byId.size,
  names: [...byName].sort(),
  idSample: [...byId.entries()].slice(0, 30),
}
fs.writeFileSync('tmp/a17-offer-count.json', JSON.stringify(out, null, 2))
console.log(
  JSON.stringify(
    {
      uniqueOfferNames: out.uniqueOfferNames,
      uniqueOfferIds: out.uniqueOfferIds,
      names: out.names,
    },
    null,
    2,
  ),
)
