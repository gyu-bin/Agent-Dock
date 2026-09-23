/**
 * Media delivery env config — secrets never returned via API.
 */

import {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
} from './mediaErrors.js'
import type { MediaDeliveryProviderId } from './types.js'

export interface S3CompatibleProviderConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  defaultTtlSeconds?: number
}

export function clampTtlSeconds(requested?: number): number {
  const base = requested ?? DEFAULT_TTL_SECONDS
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, base))
}

export function getDefaultMediaTtlSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.MEDIA_DELIVERY_TTL_SECONDS?.trim()
  if (!raw) return DEFAULT_TTL_SECONDS
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_TTL_SECONDS
  return clampTtlSeconds(n)
}

export function getMediaDeliveryProviderId(
  env: NodeJS.ProcessEnv = process.env,
): MediaDeliveryProviderId {
  const raw = (env.MEDIA_DELIVERY_PROVIDER ?? 'unconfigured').trim().toLowerCase()
  if (raw === 'fake') return 'fake'
  if (raw === 's3' || raw === 's3-compatible' || raw === 'r2') {
    return 's3-compatible'
  }
  return 'unconfigured'
}

/** Public-safe config — never includes secret values. */
export function getS3CompatibleConfig(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean
  endpoint?: string
  region?: string
  bucket?: string
  hasAccessKey: boolean
  hasSecretKey: boolean
} {
  const endpoint = env.MEDIA_S3_ENDPOINT?.trim()
  const region = env.MEDIA_S3_REGION?.trim() || 'auto'
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

/**
 * Server-only full config for constructing the S3 provider.
 * Callers must never serialize this into API/settings/logs.
 */
export function getS3CompatibleProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): S3CompatibleProviderConfig | null {
  const endpoint = env.MEDIA_S3_ENDPOINT?.trim()
  const bucket = env.MEDIA_S3_BUCKET?.trim()
  const accessKeyId = env.MEDIA_S3_ACCESS_KEY_ID?.trim()
  const secretAccessKey = env.MEDIA_S3_SECRET_ACCESS_KEY?.trim()
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null
  return {
    endpoint,
    region: env.MEDIA_S3_REGION?.trim() || 'auto',
    bucket,
    accessKeyId,
    secretAccessKey,
    defaultTtlSeconds: getDefaultMediaTtlSeconds(env),
  }
}
