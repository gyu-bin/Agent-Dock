import type { ProjectRoutine, RoutineSchedule } from './operationsTypes'

/**
 * Scheduler interface — client helpers mirror server scheduleUtils.
 * Daemon lives on the server (RoutineSchedulerRuntime).
 */
export interface RoutineScheduler {
  getDueRoutines(
    routines: ProjectRoutine[],
    now: Date,
  ): ProjectRoutine[]
  calculateNextRun(schedule: RoutineSchedule, now: Date): string | null
}

const DOW_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function resolveTimezone(schedule: RoutineSchedule, fallback = 'UTC'): string {
  return schedule.timezone?.trim() || fallback
}

function parseTime(time: string | undefined): { h: number; m: number } {
  if (!time) return { h: 9, m: 0 }
  const [hs, ms] = time.split(':')
  return { h: Number(hs) || 9, m: Number(ms) || 0 }
}

function getZonedParts(
  date: Date,
  timeZone: string,
): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  dow: number
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  })
  const parts = fmt.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0'
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    dow: DOW_MAP[get('weekday')] ?? 0,
  }
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  for (let i = 0; i < 4; i++) {
    const parts = getZonedParts(new Date(utc), timeZone)
    const asIfUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
      0,
    )
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
    const delta = desired - asIfUtc
    if (delta === 0) break
    utc += delta
  }
  return new Date(utc)
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + delta))
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  }
}

function occurrenceAt(
  schedule: RoutineSchedule,
  year: number,
  month: number,
  day: number,
): Date {
  const { h, m } = parseTime(schedule.time)
  const tz = resolveTimezone(schedule)
  return zonedTimeToUtc(year, month, day, h, m, tz)
}

/**
 * Deterministic next-run calculator (injectable `now`, IANA timezone).
 */
export function calculateNextRun(
  schedule: RoutineSchedule,
  now: Date,
): string | null {
  const tz = resolveTimezone(schedule)
  const parts = getZonedParts(now, tz)

  if (schedule.kind === 'daily') {
    let cand = occurrenceAt(schedule, parts.year, parts.month, parts.day)
    if (cand.getTime() <= now.getTime()) {
      const n = addCalendarDays(parts.year, parts.month, parts.day, 1)
      cand = occurrenceAt(schedule, n.year, n.month, n.day)
    }
    return cand.toISOString()
  }

  if (schedule.kind === 'weekly') {
    const days = schedule.daysOfWeek?.length
      ? [...schedule.daysOfWeek].sort((a, b) => a - b)
      : [1]
    for (let offset = 0; offset < 14; offset++) {
      const n = addCalendarDays(parts.year, parts.month, parts.day, offset)
      const cand = occurrenceAt(schedule, n.year, n.month, n.day)
      const candParts = getZonedParts(cand, tz)
      if (days.includes(candParts.dow) && cand.getTime() > now.getTime()) {
        return cand.toISOString()
      }
    }
    return null
  }

  if (schedule.kind === 'monthly') {
    const { h, m } = parseTime(schedule.time)
    let cand = occurrenceAt(schedule, parts.year, parts.month, parts.day)
    if (cand.getTime() <= now.getTime()) {
      let y = parts.year
      let mo = parts.month + 1
      if (mo > 12) {
        mo = 1
        y += 1
      }
      const lastTry = zonedTimeToUtc(y, mo, parts.day, h, m, tz)
      if (
        getZonedParts(lastTry, tz).day === parts.day &&
        lastTry.getTime() > now.getTime()
      ) {
        cand = lastTry
      } else {
        cand = occurrenceAt(schedule, y, mo, Math.min(parts.day, 28))
      }
    }
    return cand.toISOString()
  }

  return null
}

export function getDueRoutines(
  routines: ProjectRoutine[],
  now: Date,
): ProjectRoutine[] {
  const t = now.getTime()
  return routines.filter((r) => {
    if (r.status !== 'active') return false
    if (r.trigger !== 'scheduled') return false
    if (!r.nextRunAt) return false
    return new Date(r.nextRunAt).getTime() <= t
  })
}

export const defaultRoutineScheduler: RoutineScheduler = {
  getDueRoutines,
  calculateNextRun,
}
