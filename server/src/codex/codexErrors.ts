/**
 * Classify Codex failures — distinguish Agent Deck vs CLI vs upstream.
 * Never store secrets or chain-of-thought; only short sanitized summaries.
 */

export type CodexErrorCategory =
  | 'CODEX_UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'PROCESS_ERROR'
  | 'INVALID_PATH'
  | 'CANCELLED'
  | 'UNKNOWN'

export interface CodexFailureDiagnostics {
  category: CodexErrorCategory
  /** HTTP status Agent Deck should return */
  httpStatus: number
  /** User-facing Korean message (no raw dumps) */
  userMessageKo: string
  /** Short technical summary for logs/run record (sanitized) */
  technicalSummary: string
  retryable: boolean
  timedOut: boolean
  cancelled: boolean
  exitCode: number | null
  durationMs: number
  attempt: number
  stderrSummary: string
}

const SECRET_RE =
  /(sk-[a-zA-Z0-9_-]{10,}|Bearer\s+\S+|OPENAI_API_KEY|CODEX_API_KEY|api[_-]?key["'\s:=]+\S+)/gi

export function sanitizeSnippet(text: string, max = 500): string {
  return text
    .replace(SECRET_RE, '[redacted]')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Prefer ERROR/warning lines over the echoed prompt dump on stderr. */
export function summarizeStderr(stderr: string, stdout = ''): string {
  const combined = `${stderr}\n${stdout}`
  const errorLines = combined
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        /^(ERROR:|warning:|error:)/i.test(l) ||
        /no credits|rate limit|502|503|504|ECONNRESET|ETIMEDOUT|unauthorized/i.test(
          l,
        ),
    )
  if (errorLines.length > 0) {
    return sanitizeSnippet(errorLines.slice(-8).join(' | '), 400)
  }
  return sanitizeSnippet(stderr || stdout, 400)
}

export function classifyCodexFailure(input: {
  exitCode: number | null
  stdout: string
  stderr: string
  cancelled: boolean
  timedOut: boolean
  durationMs: number
  attempt?: number
  binaryMissing?: boolean
  pathError?: boolean
}): CodexFailureDiagnostics {
  const attempt = input.attempt ?? 1
  const combined = `${input.stderr}\n${input.stdout}`
  const stderrSummary = summarizeStderr(input.stderr, input.stdout)

  if (input.binaryMissing) {
    return {
      category: 'CODEX_UNAVAILABLE',
      httpStatus: 503,
      userMessageKo:
        'Codex CLI를 사용할 수 없습니다. 설치 상태와 CODEX_BIN을 확인해 주세요.',
      technicalSummary: 'Codex binary unavailable',
      retryable: false,
      timedOut: false,
      cancelled: false,
      exitCode: null,
      durationMs: input.durationMs,
      attempt,
      stderrSummary,
    }
  }

  if (input.pathError) {
    return {
      category: 'INVALID_PATH',
      httpStatus: 400,
      userMessageKo: '프로젝트 경로가 유효하지 않거나 접근할 수 없습니다.',
      technicalSummary: sanitizeSnippet(combined, 200),
      retryable: false,
      timedOut: false,
      cancelled: false,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      attempt,
      stderrSummary,
    }
  }

  if (input.timedOut) {
    return {
      category: 'TIMEOUT',
      httpStatus: 504,
      userMessageKo:
        'Codex 실행이 시간 제한을 초과했습니다. 잠시 후 다시 시도해 주세요.',
      technicalSummary: `timeout after ${input.durationMs}ms`,
      retryable: true,
      timedOut: true,
      cancelled: false,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      attempt,
      stderrSummary,
    }
  }

  if (input.cancelled) {
    return {
      category: 'CANCELLED',
      httpStatus: 499,
      userMessageKo: 'Codex 실행이 취소되었습니다.',
      technicalSummary: 'cancelled by user or abort',
      retryable: false,
      timedOut: false,
      cancelled: true,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      attempt,
      stderrSummary,
    }
  }

  // Upstream / model HTTP-ish signals in CLI stderr
  const billingHit =
    /no credits remaining|insufficient.?quota|billing|payment required|exceeded your current quota/i.test(
      combined,
    )
  if (billingHit) {
    return {
      category: 'UPSTREAM_ERROR',
      httpStatus: 502,
      userMessageKo:
        'Codex 서비스가 일시적으로 응답하지 않습니다. (업스트림 크레딧/쿼터 소진)',
      technicalSummary: 'upstream billing/credits exhausted',
      retryable: false,
      timedOut: false,
      cancelled: false,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      attempt,
      stderrSummary,
    }
  }

  const upstreamHit =
    /\b(502|503|504|429)\b/.test(combined) ||
    /bad gateway|gateway timeout|service unavailable|rate limit|overloaded|upstream|ECONNRESET|ETIMEDOUT|fetch failed|network error|cloudflare|Reconnecting\.\.\.|stream disconnected/i.test(
      combined,
    ) ||
    /internal server error|temporarily unavailable/i.test(combined)

  if (upstreamHit) {
    // Rate limit: retryable. Hard disconnect without billing already handled.
    const rateLimited = /\b429\b|rate limit/i.test(combined)
    return {
      category: 'UPSTREAM_ERROR',
      httpStatus: 502,
      userMessageKo:
        'Codex 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.',
      technicalSummary: sanitizeSnippet(
        `upstream signal exit=${input.exitCode} ${stderrSummary}`,
        240,
      ),
      retryable: rateLimited || /Reconnecting|stream disconnected|502|503|504|ECONNRESET|ETIMEDOUT/i.test(combined),
      timedOut: false,
      cancelled: false,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      attempt,
      stderrSummary,
    }
  }

  // Spawn / process failures
  if (
    input.exitCode === null ||
    /ENOENT|EACCES|spawn |not found|cannot execute/i.test(combined)
  ) {
    return {
      category: 'PROCESS_ERROR',
      httpStatus: 500,
      userMessageKo: 'Codex 프로세스 실행 중 오류가 발생했습니다.',
      technicalSummary: sanitizeSnippet(
        `process error exit=${input.exitCode} ${stderrSummary}`,
        240,
      ),
      retryable: false,
      timedOut: false,
      cancelled: false,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      attempt,
      stderrSummary,
    }
  }

  // Auth / config — not retryable
  if (
    input.exitCode !== 0 &&
    /unauthorized|forbidden|invalid.?api.?key|401|403/i.test(combined)
  ) {
    return {
      category: 'CODEX_UNAVAILABLE',
      httpStatus: 503,
      userMessageKo:
        'Codex 인증에 실패했습니다. API 키 설정을 확인해 주세요.',
      technicalSummary: 'auth failure',
      retryable: false,
      timedOut: false,
      cancelled: false,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      attempt,
      stderrSummary,
    }
  }

  // Opaque non-zero: Agent Deck historically mapped these to HTTP 502.
  // Only mark retryable when stderr/stdout hints at transient upstream 5xx.
  if (input.exitCode !== 0 && input.exitCode != null) {
    const softUpstream =
      /error|fail|unavailable|connection|reset|timeout|refused/i.test(
        combined,
      ) && !/usage:|invalid argument|unknown option/i.test(combined)
    return {
      category: softUpstream ? 'UPSTREAM_ERROR' : 'UNKNOWN',
      httpStatus: 502,
      userMessageKo:
        'Codex 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.',
      technicalSummary: sanitizeSnippet(
        `codex exit ${input.exitCode}: ${stderrSummary || '(no stderr)'}`,
        240,
      ),
      // Soft signal only — hard upstreamHit already returned above as retryable
      retryable: softUpstream,
      timedOut: false,
      cancelled: false,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      attempt,
      stderrSummary,
    }
  }

  return {
    category: 'UNKNOWN',
    httpStatus: 500,
    userMessageKo: 'Codex 실행 중 알 수 없는 오류가 발생했습니다.',
    technicalSummary: sanitizeSnippet(combined, 240) || 'unknown',
    retryable: false,
    timedOut: false,
    cancelled: false,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    attempt,
    stderrSummary,
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Short backoff: 800ms, 1600ms */
export function retryBackoffMs(attempt: number): number {
  return 800 * Math.pow(2, Math.max(0, attempt - 1))
}
