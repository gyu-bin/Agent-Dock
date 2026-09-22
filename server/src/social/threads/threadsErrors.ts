import { createSocialError } from '../socialErrors.js'
import type { SocialError } from '../types.js'
import { redactSecrets } from '../../credentials/redact.js'

export type ThreadsErrorCode =
  | 'THREADS_NOT_CONNECTED'
  | 'THREADS_AUTH_EXPIRED'
  | 'THREADS_PERMISSION'
  | 'THREADS_RATE_LIMIT'
  | 'THREADS_INVALID_CONTENT'
  | 'THREADS_UPSTREAM'
  | 'THREADS_PUBLISH_UNKNOWN'
  | 'THREADS_UNKNOWN'
  | 'THREADS_OAUTH'
  | 'THREADS_MEDIA_URL_REQUIRED'

export function createThreadsError(input: {
  code: ThreadsErrorCode
  userMessage: string
  technicalSummary: string
  status?: number
  retryable?: boolean
  cause?: unknown
}): SocialError {
  const mapped = mapToSocialCategory(input.code)
  return createSocialError({
    category: mapped,
    userMessage: input.userMessage,
    technicalSummary: redactSecrets(
      `${input.code}: ${input.technicalSummary}`,
    ),
    status: input.status ?? defaultStatus(input.code),
    retryable: input.retryable ?? false,
    cause: input.cause,
  })
}

function mapToSocialCategory(
  code: ThreadsErrorCode,
): SocialError['category'] {
  switch (code) {
    case 'THREADS_NOT_CONNECTED':
      return 'SOCIAL_NOT_CONFIGURED'
    case 'THREADS_AUTH_EXPIRED':
    case 'THREADS_PERMISSION':
      return 'SOCIAL_NOT_CONFIGURED'
    case 'THREADS_RATE_LIMIT':
      return 'SOCIAL_UPSTREAM'
    case 'THREADS_INVALID_CONTENT':
    case 'THREADS_MEDIA_URL_REQUIRED':
    case 'THREADS_OAUTH':
      return 'SOCIAL_INVALID_REQUEST'
    case 'THREADS_PUBLISH_UNKNOWN':
      return 'SOCIAL_UPSTREAM'
    case 'THREADS_UPSTREAM':
      return 'SOCIAL_UPSTREAM'
    default:
      return 'SOCIAL_UNKNOWN'
  }
}

function defaultStatus(code: ThreadsErrorCode): number {
  switch (code) {
    case 'THREADS_NOT_CONNECTED':
    case 'THREADS_AUTH_EXPIRED':
      return 401
    case 'THREADS_PERMISSION':
      return 403
    case 'THREADS_RATE_LIMIT':
      return 429
    case 'THREADS_INVALID_CONTENT':
    case 'THREADS_MEDIA_URL_REQUIRED':
    case 'THREADS_OAUTH':
      return 400
    case 'THREADS_PUBLISH_UNKNOWN':
    case 'THREADS_UPSTREAM':
      return 502
    default:
      return 500
  }
}

export function classifyThreadsHttpError(
  status: number,
  bodyText: string,
): SocialError {
  const safe = redactSecrets(bodyText).slice(0, 500)
  let code: ThreadsErrorCode = 'THREADS_UPSTREAM'
  let userMessage = 'Threads 요청에 실패했습니다.'
  let retryable = false

  if (status === 401) {
    code = 'THREADS_AUTH_EXPIRED'
    userMessage = 'Threads 인증이 만료되었습니다. 다시 연결하세요.'
  } else if (status === 403) {
    code = 'THREADS_PERMISSION'
    userMessage = 'Threads 게시 권한이 없습니다.'
  } else if (status === 429) {
    code = 'THREADS_RATE_LIMIT'
    userMessage = 'Threads 게시 한도에 도달했습니다. 잠시 후 다시 시도하세요.'
    retryable = true
  } else if (status >= 400 && status < 500) {
    code = 'THREADS_INVALID_CONTENT'
    userMessage = 'Threads가 게시 내용을 거부했습니다.'
  } else if (status >= 500) {
    code = 'THREADS_UPSTREAM'
    userMessage = 'Threads 서버 오류가 발생했습니다.'
    retryable = true
  }

  return createThreadsError({
    code,
    userMessage,
    technicalSummary: `HTTP ${status}: ${safe}`,
    status,
    retryable,
  })
}
