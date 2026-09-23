/**
 * URL scheme + SSRF-oriented safety for attachment URLs.
 * This phase does not perform arbitrary server fetch.
 */

import { createAttachmentError } from './errors.js'

export function assertSafeHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw createAttachmentError({
      category: 'ATTACHMENT_INVALID_URL',
      userMessage: '올바른 URL이 아닙니다.',
      technicalSummary: 'URL parse failed',
    })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createAttachmentError({
      category: 'ATTACHMENT_INVALID_URL',
      userMessage: 'http/https URL만 첨부할 수 있습니다.',
      technicalSummary: `scheme ${url.protocol}`,
    })
  }
  const host = url.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    isPrivateIp(host)
  ) {
    throw createAttachmentError({
      category: 'ATTACHMENT_INVALID_URL',
      userMessage: '로컬/사설 네트워크 URL은 첨부할 수 없습니다.',
      technicalSummary: `blocked host ${host}`,
    })
  }
  if (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal'
  ) {
    throw createAttachmentError({
      category: 'ATTACHMENT_INVALID_URL',
      userMessage: '메타데이터 엔드포인트 URL은 허용되지 않습니다.',
      technicalSummary: 'metadata host blocked',
    })
  }
  return url
}

function isPrivateIp(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10) return true
  if (a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}
