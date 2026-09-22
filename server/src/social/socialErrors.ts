import type { SocialError, SocialErrorCategory } from './types.js'

export function createSocialError(input: {
  category: SocialErrorCategory
  userMessage: string
  technicalSummary: string
  status?: number
  retryable?: boolean
  cause?: unknown
}): SocialError {
  return {
    category: input.category,
    userMessage: input.userMessage,
    technicalSummary: input.technicalSummary,
    status: input.status ?? defaultStatus(input.category),
    retryable: input.retryable ?? false,
    cause: input.cause,
  }
}

function defaultStatus(c: SocialErrorCategory): number {
  switch (c) {
    case 'SOCIAL_NOT_CONFIGURED':
      return 503
    case 'SOCIAL_NOT_APPROVED':
    case 'SOCIAL_HASH_MISMATCH':
    case 'SOCIAL_DUPLICATE':
    case 'SOCIAL_MEDIA_INVALID':
    case 'SOCIAL_OWNERSHIP':
    case 'SOCIAL_INVALID_REQUEST':
      return 400
    case 'SOCIAL_UPSTREAM':
      return 502
    case 'SOCIAL_CANCELLED':
      return 499
    default:
      return 500
  }
}

export function isSocialError(err: unknown): err is SocialError {
  return Boolean(err && typeof err === 'object' && 'category' in err)
}
