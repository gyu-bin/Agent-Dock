import type { ObservabilityErrorCategory } from './usageTypes.js'

/**
 * Map provider-specific error labels into the shared observability taxonomy.
 * Provider raw text stays in technicalSummary; userMessage is separate.
 */
export function normalizeErrorCategory(
  raw: string | undefined | null,
): ObservabilityErrorCategory | undefined {
  if (!raw) return undefined
  const s = raw.trim().toUpperCase().replace(/[\s-]+/g, '_')

  if (
    s === 'RATE_LIMIT' ||
    s === 'AUTH' ||
    s === 'QUOTA' ||
    s === 'TIMEOUT' ||
    s === 'UPSTREAM' ||
    s === 'INVALID_REQUEST' ||
    s === 'CANCELLED' ||
    s === 'UNKNOWN'
  ) {
    return s
  }

  // Codex hardening categories
  if (s === 'CODEX_UNAVAILABLE') return 'AUTH'
  if (s === 'UPSTREAM_ERROR') return 'UPSTREAM'
  if (s === 'PROCESS_ERROR') return 'UPSTREAM'
  if (s === 'INVALID_PATH') return 'INVALID_REQUEST'

  if (/RATE.?LIMIT|429/.test(s)) return 'RATE_LIMIT'
  if (/AUTH|UNAUTHORIZED|FORBIDDEN|401|403/.test(s)) return 'AUTH'
  if (/QUOTA|BILLING|CREDIT|PAYMENT/.test(s)) return 'QUOTA'
  if (/TIMEOUT|TIMED.?OUT|504/.test(s)) return 'TIMEOUT'
  if (/CANCEL/.test(s)) return 'CANCELLED'
  if (/INVALID|400|BAD.?REQUEST/.test(s)) return 'INVALID_REQUEST'
  if (/UPSTREAM|502|503|NETWORK|ECONN|OVERLOAD/.test(s)) return 'UPSTREAM'

  return 'UNKNOWN'
}

export function classifyFromMessage(
  message: string | undefined | null,
): ObservabilityErrorCategory {
  if (!message) return 'UNKNOWN'
  return normalizeErrorCategory(message) ?? 'UNKNOWN'
}
