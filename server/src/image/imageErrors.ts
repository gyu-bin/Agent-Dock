/** Image generation errors — never include secrets. */

import type { ImageErrorCategory, ImageGenerationError } from './types.js'

export function createImageError(input: {
  category: ImageErrorCategory
  userMessage: string
  technicalSummary: string
  status?: number
  retryable?: boolean
  cause?: unknown
}): ImageGenerationError {
  const err = new Error(input.userMessage) as ImageGenerationError
  err.category = input.category
  err.userMessage = input.userMessage
  err.technicalSummary = sanitizeTechnical(input.technicalSummary)
  err.status = input.status
  err.retryable = input.retryable ?? false
  if (input.cause instanceof Error) err.cause = input.cause
  return err
}

function sanitizeTechnical(text: string, max = 240): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'api_key=[redacted]')
    .slice(0, max)
}

export function classifyImageHttpError(
  status: number,
  bodyText: string,
): ImageGenerationError {
  const tech = sanitizeTechnical(bodyText)
  if (status === 401 || status === 403) {
    return createImageError({
      category: 'IMAGE_NOT_CONFIGURED',
      userMessage: '이미지 생성 API 인증에 실패했습니다. API Key를 확인하세요.',
      technicalSummary: tech || `HTTP ${status}`,
      status,
      retryable: false,
    })
  }
  if (status === 429) {
    const quota = /quota|billing|insufficient/i.test(bodyText)
    return createImageError({
      category: quota ? 'IMAGE_QUOTA' : 'IMAGE_RATE_LIMIT',
      userMessage: quota
        ? '이미지 생성 할당량이 부족합니다.'
        : '이미지 생성 요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
      technicalSummary: tech || `HTTP ${status}`,
      status,
      retryable: !quota,
    })
  }
  if (status === 400) {
    return createImageError({
      category: 'IMAGE_INVALID_REQUEST',
      userMessage: '이미지 생성 요청이 올바르지 않습니다.',
      technicalSummary: tech || `HTTP ${status}`,
      status,
      retryable: false,
    })
  }
  if (status >= 500) {
    return createImageError({
      category: 'IMAGE_UPSTREAM',
      userMessage: '이미지 생성 서비스에 일시적인 문제가 있습니다.',
      technicalSummary: tech || `HTTP ${status}`,
      status,
      retryable: true,
    })
  }
  return createImageError({
    category: 'IMAGE_UNKNOWN',
    userMessage: '이미지 생성에 실패했습니다.',
    technicalSummary: tech || `HTTP ${status}`,
    status,
    retryable: false,
  })
}
