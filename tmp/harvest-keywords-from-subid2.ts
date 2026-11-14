/**
 * @deprecated 请改用正式脚本：
 *   npm run seeds:harvest
 *   npm run seeds:harvest -- 2026-11-13
 *   npm run seeds:harvest -- --write-lexicon
 */
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const result = spawnSync('npx', ['tsx', 'scripts/harvest-seed-keywords.ts', ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: true,
})
process.exit(result.status ?? 1)
