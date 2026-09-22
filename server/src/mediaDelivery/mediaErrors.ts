import type { MediaDeliveryError, MediaErrorCategory } from './types.js'

export function createMediaError(input: {
  category: MediaErrorCategory
  userMessage: string
  technicalSummary: string
  status?: number
  retryable?: boolean
  cause?: unknown
}): MediaDeliveryError {
  return {
    category: input.category,
    userMessage: input.userMessage,
    technicalSummary: input.technicalSummary,
    status: input.status ?? defaultStatus(input.category),
    retryable: input.retryable ?? false,
    cause: input.cause,
  }
}

function defaultStatus(c: MediaErrorCategory): number {
  switch (c) {
    case 'MEDIA_NOT_CONFIGURED':
      return 503
    case 'MEDIA_ARTIFACT_NOT_FOUND':
      return 404
    case 'MEDIA_OWNERSHIP':
    case 'MEDIA_PATH_VIOLATION':
    case 'MEDIA_UNSUPPORTED_TYPE':
    case 'MEDIA_TOO_LARGE':
      return 400
    case 'MEDIA_UPLOAD_FAILED':
    case 'MEDIA_SIGN_FAILED':
      return 502
    case 'MEDIA_REVOKE_FAILED':
      return 500
    default:
      return 500
  }
}

export function isMediaError(err: unknown): err is MediaDeliveryError {
  return Boolean(err && typeof err === 'object' && 'category' in err)
}

export const DEFAULT_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export const FUTURE_VIDEO_MIMES = ['video/mp4', 'video/webm'] as const

export const ALLOWED_MEDIA_MIMES = [
  ...DEFAULT_IMAGE_MIMES,
  ...FUTURE_VIDEO_MIMES,
] as const

export const DEFAULT_TTL_SECONDS = 30 * 60
export const MIN_TTL_SECONDS = 15 * 60
export const MAX_TTL_SECONDS = 60 * 60
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
