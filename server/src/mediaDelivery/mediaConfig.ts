/**
 * Media delivery env config — secrets never returned via API.
 */

import {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
} from './mediaErrors.js'
import type { MediaDeliveryProviderId } from './types.js'

export function clampTtlSeconds(requested?: number): number {
  const base = requested ?? DEFAULT_TTL_SECONDS
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, base))
}

export function getMediaDeliveryProviderId(
  env: NodeJS.ProcessEnv = process.env,
): MediaDeliveryProviderId {
  const raw = (env.MEDIA_DELIVERY_PROVIDER ?? 'unconfigured').trim().toLowerCase()
  if (raw === 'fake') return 'fake'
  if (raw === 's3' || raw === 's3-compatible') return 's3-compatible'
  return 'unconfigured'
}

export function getS3CompatibleConfig(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean
  endpoint?: string
  region?: string
  bucket?: string
  /** Never expose these outside server */
  hasAccessKey: boolean
  hasSecretKey: boolean
} {
  const endpoint = env.MEDIA_S3_ENDPOINT?.trim()
  const region = env.MEDIA_S3_REGION?.trim()
  const bucket = env.MEDIA_S3_BUCKET?.trim()
  const access = env.MEDIA_S3_ACCESS_KEY_ID?.trim()
  const secret = env.MEDIA_S3_SECRET_ACCESS_KEY?.trim()
  return {
    configured: Boolean(endpoint && bucket && access && secret),
    endpoint,
    region,
    bucket,
    hasAccessKey: Boolean(access),
    hasSecretKey: Boolean(secret),
  }
}
