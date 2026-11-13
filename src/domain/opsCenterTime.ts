/** Asia/Shanghai calendar day YYYY-MM-DD */
export function shanghaiDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Asia/Shanghai hour 00-23 */
export function shanghaiHour(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = parts.find((part) => part.type === 'hour')?.value || '00'
  return hour.padStart(2, '0')
}

export function shiftShanghaiDay(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  utc.setUTCDate(utc.getUTCDate() + deltaDays)
  return utc.toISOString().slice(0, 10)
}

export function shanghaiDayBounds(day: string): { day: string; startTime: string; endTime: string } {
  return {
    day,
    startTime: `${day} 00:00:00`,
    endTime: `${day} 23:59:59`,
  }
}
