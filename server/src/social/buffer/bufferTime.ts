/**
 * Asia/Seoul (and other IANA) local wall-clock → UTC ISO for Buffer dueAt.
 * Does not rely on process timezone.
 */

export function localWallTimeToUtcIso(input: {
  /** YYYY-MM-DD */
  date: string
  /** HH:mm or HH:mm:ss */
  time: string
  timeZone: string
}): string {
  const time = input.time.length === 5 ? `${input.time}:00` : input.time
  const localStamp = `${input.date}T${time}`
  // Interpret as UTC first, then adjust by timezone offset at that instant
  const guess = new Date(`${localStamp}Z`)
  if (Number.isNaN(guess.getTime())) {
    throw new Error(`invalid local datetime: ${localStamp}`)
  }
  const offsetMs = getTimeZoneOffsetMs(input.timeZone, guess)
  const utc = new Date(guess.getTime() - offsetMs)
  // Re-check offset around DST boundaries
  const offset2 = getTimeZoneOffsetMs(input.timeZone, utc)
  if (offset2 !== offsetMs) {
    return new Date(guess.getTime() - offset2).toISOString()
  }
  return utc.toISOString()
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = dtf.formatToParts(date)
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - date.getTime()
}

/** Map Buffer post status → Agent Deck PublishedPost-compatible status */
export function bufferStatusToPublishedStatus(
  status: string,
  mode?: 'queue' | 'now' | 'scheduled' | 'draft',
):
  | 'buffer_draft'
  | 'buffer_queued'
  | 'buffer_scheduled'
  | 'buffer_sent'
  | 'buffer_failed'
  | 'failed' {
  if (mode === 'draft' || status === 'draft' || status === 'needs_approval') {
    return 'buffer_draft'
  }
  if (mode === 'queue' || status === 'sending') {
    // Queue acceptance ≠ SNS published
    return 'buffer_queued'
  }
  switch (status) {
    case 'scheduled':
      return mode === 'now' ? 'buffer_queued' : 'buffer_scheduled'
    case 'sent':
      return 'buffer_sent'
    case 'error':
      return 'buffer_failed'
    default:
      return mode === 'scheduled' ? 'buffer_scheduled' : 'buffer_queued'
  }
}
