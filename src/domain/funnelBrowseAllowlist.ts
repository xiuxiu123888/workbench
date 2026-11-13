/** 漏斗总览白名单：仅展示这些漏斗（名称按 ops-center 实际 funnelName） */
export const FUNNEL_BROWSE_ALLOWLIST = [
  'Blinkdrama-sign-v01',
  'Blinkdrama-v01',
  'Blinkdrama-v02',
  'Blinkdrama-v03',
  'Blinkdrama-v04',
  'reader-v01',
  'reader-v02',
  'cd-reader-pb-v01',
  'cd-reader-banner-v01',
  'moboreels-v01',
  'moboreels-v02',
  'moboreels-v03',
  'moboreels-v04',
  'Vibeshort-V01',
  'Vibeshort-v02',
  'Vibeshort-V03',
  'Vibeshort-V04',
  'Vibeshort-V05',
  'Vibeshort-sign-v01',
  'ShortMax-v03',
  'ShortMax-v04',
  'ShortMax-v05',
  'ShortMax-v06',
  'ShortMax-v11',
  'storyreel-v01',
  'storyreel-v02',
  'storyreel-v03',
  'storyreel-v04',
  'storyreel-v05',
  'storyreel-sign-v01',
] as const

const allowSet = new Set(FUNNEL_BROWSE_ALLOWLIST.map((name) => name.toLowerCase()))

export function isAllowedBrowseFunnel(funnelName: string | null | undefined): boolean {
  return allowSet.has(String(funnelName || '').trim().toLowerCase())
}
