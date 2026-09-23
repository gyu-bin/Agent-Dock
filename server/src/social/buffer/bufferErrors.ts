import type { BufferError, BufferErrorCategory } from './bufferTypes.js'

export function createBufferError(input: {
  category: BufferErrorCategory
  userMessage: string
  technicalSummary: string
  status?: number
  retryable?: boolean
  cause?: unknown
}): BufferError {
  return {
    category: input.category,
    userMessage: input.userMessage,
    technicalSummary: redact(input.technicalSummary),
    status: input.status ?? defaultStatus(input.category),
    retryable: input.retryable ?? false,
    cause: input.cause,
  }
}

export function isBufferError(err: unknown): err is BufferError {
  if (!err || typeof err !== 'object' || !('category' in err)) return false
  const cat = String((err as { category: unknown }).category)
  return cat.startsWith('BUFFER_')
}

function defaultStatus(c: BufferErrorCategory): number {
  switch (c) {
    case 'BUFFER_NOT_CONFIGURED':
    case 'BUFFER_AUTH':
      return 401
    case 'BUFFER_PERMISSION':
      return 403
    case 'BUFFER_INVALID_CHANNEL':
    case 'BUFFER_INVALID_CONTENT':
    case 'BUFFER_MEDIA_REQUIRED':
      return 400
    case 'BUFFER_RATE_LIMIT':
      return 429
    case 'BUFFER_UPSTREAM':
    case 'BUFFER_PUBLISH_UNKNOWN':
      return 502
    default:
      return 500
  }
}

export function redact(text: string, max = 280): string {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/bapi_[a-zA-Z0-9_-]+/gi, '[redacted]')
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
    .slice(0, max)
}

export function classifyBufferHttp(
  status: number,
  bodyText: string,
): BufferError {
  const tech = redact(bodyText)
  if (status === 401 || status === 403) {
    return createBufferError({
      category: status === 403 ? 'BUFFER_PERMISSION' : 'BUFFER_AUTH',
      userMessage:
        status === 403
          ? 'Buffer API 권한이 없습니다.'
          : 'Buffer API Key가 유효하지 않습니다.',
      technicalSummary: tech || `HTTP ${status}`,
      status,
    })
  }
  if (status === 429) {
    return createBufferError({
      category: 'BUFFER_RATE_LIMIT',
      userMessage: 'Buffer 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
      technicalSummary: tech || `HTTP ${status}`,
      status,
      retryable: true,
    })
  }
  if (status >= 500) {
    return createBufferError({
      category: 'BUFFER_UPSTREAM',
      userMessage: 'Buffer 서비스에 일시적인 문제가 있습니다.',
      technicalSummary: tech || `HTTP ${status}`,
      status,
      retryable: true,
    })
  }
  return createBufferError({
    category: 'BUFFER_UNKNOWN',
    userMessage: 'Buffer 요청에 실패했습니다.',
    technicalSummary: tech || `HTTP ${status}`,
    status,
  })
}
