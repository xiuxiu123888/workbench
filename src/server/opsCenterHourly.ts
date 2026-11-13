import fs from 'node:fs'
import path from 'node:path'
import {
  compareHourlySnapshots,
  previousHourLabel,
  summarizeHourlySnapshot,
  type HourlyCompareResult,
  type HourlySnapshot,
  type HourlySnapshotMeta,
} from '../domain/opsCenterHourly'
import { opsCenterRoot, readOpsCenterJson } from './opsCenterStore'

function hourlyDir(projectRoot: string, day: string): string {
  return path.join(opsCenterRoot(projectRoot), 'metrics', day, 'hourly')
}

function normalizeHour(hour: string): string {
  const text = String(hour || '').trim()
  if (!/^\d{1,2}$/.test(text)) {
    throw new Error(`非法小时 ${hour}`)
  }
  const n = Number(text)
  if (n < 0 || n > 23) {
    throw new Error(`非法小时 ${hour}`)
  }
  return String(n).padStart(2, '0')
}

export function loadHourlySnapshot(
  projectRoot: string,
  day: string,
  hour: string,
): HourlySnapshot | null {
  const safeHour = normalizeHour(hour)
  return readOpsCenterJson<HourlySnapshot>(projectRoot, `metrics/${day}/hourly/${safeHour}.json`)
}

export function listHourlySnapshots(projectRoot: string, day: string): HourlySnapshotMeta[] {
  const dir = hourlyDir(projectRoot, day)
  if (!fs.existsSync(dir)) {
    return []
  }
  return fs
    .readdirSync(dir)
    .filter((name) => /^\d{2}\.json$/.test(name))
    .map((name) => name.slice(0, 2))
    .sort()
    .map((hour) => {
      const snapshot = loadHourlySnapshot(projectRoot, day, hour)
      if (!snapshot) {
        return null
      }
      return summarizeHourlySnapshot(snapshot)
    })
    .filter((item): item is HourlySnapshotMeta => Boolean(item))
}

export function compareHourlyFromDisk(
  projectRoot: string,
  day: string,
  currentHour: string,
  baselineHour?: string | null,
): HourlyCompareResult {
  const current = loadHourlySnapshot(projectRoot, day, currentHour)
  if (!current) {
    throw new Error(`没有 ${day} ${normalizeHour(currentHour)} 点的小时快照`)
  }

  const baselineKey =
    baselineHour == null || baselineHour === ''
      ? previousHourLabel(current.hour)
      : normalizeHour(baselineHour)
  const baseline = baselineKey ? loadHourlySnapshot(projectRoot, day, baselineKey) : null

  return compareHourlySnapshots(current, baseline)
}
