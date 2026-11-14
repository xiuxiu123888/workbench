import fs from 'node:fs'

const t = fs.readFileSync('.env.local', 'utf8').replace(/^\uFEFF/, '')
const keys: string[] = []
for (const line of t.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  keys.push(`${m[1]} len=${v.length}`)
}
console.log(keys.join('\n'))
