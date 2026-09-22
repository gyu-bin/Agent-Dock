/**
 * Timezone-aware schedule helpers for Routine Scheduler.
 * Never rely on process OS timezone for wall-clock math.
 */

import type {
  StoredProjectRoutine,
  StoredRoutineSchedule,
} from '../persistence/operationsTypes.js'

const DOW_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function resolveTimezone(
  schedule: StoredRoutineSchedule | undefined,
  fallback = 'UTC',
): string {
  return schedule?.timezone?.trim() || fallback
}

function parseTime(time: string | undefined): { h: number; m: number } {
  if (!time) return { h: 9, m: 0 }
  const [hs, ms] = time.split(':')
  return { h: Number(hs) || 9, m: Number(ms) || 0 }
}

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  dow: number
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
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
  const weekday = get('weekday')
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    dow: DOW_MAP[weekday] ?? 0,
  }
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
export function zonedTimeToUtc(
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
  schedule: StoredRoutineSchedule,
  year: number,
  month: number,
  day: number,
): Date {
  const { h, m } = parseTime(schedule.time)
  const tz = resolveTimezone(schedule)
  return zonedTimeToUtc(year, month, day, h, m, tz)
}

/**
 * Next scheduled occurrence strictly after `now` (occurrence-based, no wall-clock drift).
 */
export function calculateNextRun(
  schedule: StoredRoutineSchedule,
  now: Date,
): string | null {
  const tz = resolveTimezone(schedule)
  const parts = getZonedParts(now, tz)
  const { h, m } = parseTime(schedule.time)

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
      if (
        days.includes(candParts.dow) &&
        cand.getTime() > now.getTime()
      ) {
        return cand.toISOString()
      }
    }
    return null
  }

  if (schedule.kind === 'monthly') {
    let cand = occurrenceAt(schedule, parts.year, parts.month, parts.day)
    if (cand.getTime() <= now.getTime()) {
      let y = parts.year
      let mo = parts.month + 1
      if (mo > 12) {
        mo = 1
        y += 1
      }
      cand = occurrenceAt(schedule, y, mo, Math.min(parts.day, 28))
      // Prefer same day-of-month when possible
      const lastTry = zonedTimeToUtc(y, mo, parts.day, h, m, tz)
      if (
        getZonedParts(lastTry, tz).day === parts.day &&
        lastTry.getTime() > now.getTime()
      ) {
        cand = lastTry
      }
    }
    return cand.toISOString()
  }

  return null
}

/**
 * Most recent scheduled occurrence at or before `now` (for catch-up).
 */
export function getMostRecentOccurrence(
  schedule: StoredRoutineSchedule,
  now: Date,
): string | null {
  const tz = resolveTimezone(schedule)
  const parts = getZonedParts(now, tz)

  if (schedule.kind === 'daily') {
    let cand = occurrenceAt(schedule, parts.year, parts.month, parts.day)
    if (cand.getTime() > now.getTime()) {
      const n = addCalendarDays(parts.year, parts.month, parts.day, -1)
      cand = occurrenceAt(schedule, n.year, n.month, n.day)
    }
    return cand.toISOString()
  }

  if (schedule.kind === 'weekly') {
    const days = schedule.daysOfWeek?.length
      ? [...schedule.daysOfWeek].sort((a, b) => a - b)
      : [1]
    for (let offset = 0; offset < 14; offset++) {
      const n = addCalendarDays(parts.year, parts.month, parts.day, -offset)
      const cand = occurrenceAt(schedule, n.year, n.month, n.day)
      const candParts = getZonedParts(cand, tz)
      if (
        days.includes(candParts.dow) &&
        cand.getTime() <= now.getTime()
      ) {
        return cand.toISOString()
      }
    }
    return null
  }

  if (schedule.kind === 'monthly') {
    let cand = occurrenceAt(schedule, parts.year, parts.month, parts.day)
    if (cand.getTime() > now.getTime()) {
      let y = parts.year
      let mo = parts.month - 1
      if (mo < 1) {
        mo = 12
        y -= 1
      }
      cand = zonedTimeToUtc(y, mo, parts.day, parseTime(schedule.time).h, parseTime(schedule.time).m, tz)
    }
    return cand.toISOString()
  }

  return null
}

export function occurrenceKey(routineId: string, scheduledFor: string): string {
  return `${routineId}::${scheduledFor}`
}

export function getDueRoutines(
  routines: StoredProjectRoutine[],
  now: Date,
): StoredProjectRoutine[] {
  const t = now.getTime()
  return routines.filter((r) => {
    if (r.status !== 'active') return false
    if (r.trigger !== 'scheduled') return false
    if (!r.nextRunAt) return false
    return new Date(r.nextRunAt).getTime() <= t
  })
}

/** True when nextRunAt is older than the most recent occurrence (missed ≥1). */
export function isCatchUp(
  schedule: StoredRoutineSchedule,
  nextRunAt: string | undefined,
  now: Date,
): boolean {
  if (!nextRunAt) return false
  const recent = getMostRecentOccurrence(schedule, now)
  if (!recent) return false
  return new Date(nextRunAt).getTime() < new Date(recent).getTime()
}
