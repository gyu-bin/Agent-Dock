/**
 * Media Delivery providers.
 * Production: S3-compatible (Cloudflare R2 etc.) private object + signed GET.
 * Fake: fixture only — never production fallback.
 */

import { readFile } from 'node:fs/promises'
import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  clampTtlSeconds,
  type S3CompatibleProviderConfig,
} from './mediaConfig.js'
import { createMediaError, DEFAULT_TTL_SECONDS } from './mediaErrors.js'
import type {
  DeliveredMedia,
  MediaDeliveryProvider,
  MediaDeliveryRecord,
  MediaDeliveryRequest,
  MediaDeliveryState,
  ResolvedArtifactFile,
} from './types.js'

export type { S3CompatibleProviderConfig }

export class UnconfiguredMediaDeliveryProvider implements MediaDeliveryProvider {
  getState(): MediaDeliveryState {
    return {
      provider: 'unconfigured',
      configured: false,
      available: false,
      label: 'Media Delivery · 설정 필요',
      defaultTtlSeconds: DEFAULT_TTL_SECONDS,
    }
  }

  async prepare(): Promise<DeliveredMedia> {
    throw createMediaError({
      category: 'MEDIA_NOT_CONFIGURED',
      userMessage:
        '미디어 전달 Provider가 설정되지 않았습니다. 로컬 서버를 공개하지 않습니다.',
      technicalSummary: 'MEDIA_DELIVERY_PROVIDER unconfigured',
    })
  }
}

/**
 * Fixture-only. Never auto-selected in production.
 * URL: https://media.invalid/{deliveryId}
 */
export class FakeMediaDeliveryProvider implements MediaDeliveryProvider {
  getState(): MediaDeliveryState {
    return {
      provider: 'fake',
      configured: true,
      available: true,
      label: 'Media Delivery · Fake (fixture)',
      defaultTtlSeconds: DEFAULT_TTL_SECONDS,
    }
  }

  async prepare(
    request: MediaDeliveryRequest,
    file: ResolvedArtifactFile,
  ): Promise<DeliveredMedia> {
    const id = newDeliveryId()
    const ttl = clampTtlSeconds(request.requestedTtlSeconds)
    const createdAt = new Date()
    const expiresAt = new Date(createdAt.getTime() + ttl * 1000)
    const remoteKey = buildRemoteObjectKey({
      projectId: request.projectId,
      artifactId: request.artifactId,
      deliveryId: id,
      mimeType: file.mimeType,
    })
    return {
      id,
      projectId: request.projectId,
      artifactId: request.artifactId,
      provider: 'fake',
      url: `https://media.invalid/${id}`,
      mimeType: file.mimeType,
      bytes: file.bytes,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'active',
      remoteKey,
      publishAttemptId: request.publishAttemptId,
    }
  }

  async revoke(
    _deliveryId: string,
    _record: MediaDeliveryRecord,
  ): Promise<void> {
    // no-op for fake
  }

  async deleteRemoteObject(_remoteKey: string): Promise<void> {
    // no-op
  }

  async resign(
    record: MediaDeliveryRecord,
    ttlSeconds?: number,
  ): Promise<{ url: string; expiresAt: string }> {
    const ttl = clampTtlSeconds(ttlSeconds)
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
    return {
      url: record.urlHint ?? `https://media.invalid/${record.id}`,
      expiresAt,
    }
  }
}

/** Injectable object storage ops — production uses AWS SDK; fixtures mock these. */
export interface S3MediaObjectOps {
  putObject(input: {
    key: string
    body: Buffer
    contentType: string
    metadata: Record<string, string>
    signal?: AbortSignal
  }): Promise<void>
  getSignedGetUrl(key: string, expiresInSeconds: number): Promise<string>
  deleteObject(key: string, signal?: AbortSignal): Promise<void>
  headBucket?(signal?: AbortSignal): Promise<void>
}

/**
 * Production S3-compatible Media Delivery (Cloudflare R2 etc.).
 * Private bucket + temporary signed GET only.
 */
export class S3CompatibleMediaDeliveryProvider implements MediaDeliveryProvider {
  private readonly ops: S3MediaObjectOps
  private readonly bucket: string
  private readonly region: string
  private readonly endpoint: string
  private readonly defaultTtl: number
  private readonly fullyConfigured: boolean

  constructor(
    cfg: S3CompatibleProviderConfig,
    /** Fixture/test injection — never used for production secrets */
    opsOverride?: S3MediaObjectOps,
  ) {
    this.bucket = cfg.bucket
    this.region = cfg.region || 'auto'
    this.endpoint = cfg.endpoint
    this.defaultTtl = cfg.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS
    this.fullyConfigured = Boolean(
      cfg.endpoint &&
        cfg.bucket &&
        cfg.accessKeyId &&
        cfg.secretAccessKey,
    )
    this.ops =
      opsOverride ??
      createAwsS3MediaOps({
        endpoint: cfg.endpoint,
        region: this.region,
        bucket: cfg.bucket,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      })
  }

  getState(): MediaDeliveryState {
    return {
      provider: 's3-compatible',
      configured: this.fullyConfigured,
      available: this.fullyConfigured,
      label: this.fullyConfigured
        ? 'Media Delivery · Cloudflare R2 / S3'
        : 'Media Delivery · S3 설정 필요',
      defaultTtlSeconds: this.defaultTtl,
      // name only — never credentials
      bucket: this.fullyConfigured ? this.bucket : undefined,
      region: this.fullyConfigured ? this.region : undefined,
    }
  }

  async prepare(
    request: MediaDeliveryRequest,
    file: ResolvedArtifactFile,
  ): Promise<DeliveredMedia> {
    if (!this.fullyConfigured) {
      throw createMediaError({
        category: 'MEDIA_NOT_CONFIGURED',
        userMessage: 'S3-compatible Media Delivery 설정이 완료되지 않았습니다.',
        technicalSummary: 'missing endpoint/bucket/credentials',
      })
    }

    const id = newDeliveryId()
    const ttl = clampTtlSeconds(
      request.requestedTtlSeconds ?? this.defaultTtl,
    )
    const createdAt = new Date()
    const expiresAt = new Date(createdAt.getTime() + ttl * 1000)
    const remoteKey = buildRemoteObjectKey({
      projectId: request.projectId,
      artifactId: request.artifactId,
      deliveryId: id,
      mimeType: file.mimeType,
    })

    let body: Buffer
    try {
      body = await readFile(file.absolutePath)
    } catch (err) {
      throw createMediaError({
        category: 'MEDIA_PATH_VIOLATION',
        userMessage: '미디어 파일을 읽을 수 없습니다.',
        technicalSummary: sanitizeErr(err),
        cause: err,
      })
    }

    await this.putWithRetry({
      key: remoteKey,
      body,
      contentType: file.mimeType,
      metadata: {
        // ids only — no prompts/secrets
        'agent-deck-project': sanitizeMeta(request.projectId),
        'agent-deck-artifact': sanitizeMeta(request.artifactId),
        'agent-deck-delivery': sanitizeMeta(id),
      },
    })

    let url: string
    try {
      url = await this.ops.getSignedGetUrl(remoteKey, ttl)
    } catch (err) {
      // best-effort cleanup of orphan object
      try {
        await this.ops.deleteObject(remoteKey)
      } catch {
        /* ignore */
      }
      throw createMediaError({
        category: 'MEDIA_SIGN_FAILED',
        userMessage: '임시 미디어 URL을 만들지 못했습니다.',
        technicalSummary: sanitizeErr(err),
        cause: err,
        retryable: isTransient(err),
      })
    }

    return {
      id,
      projectId: request.projectId,
      artifactId: request.artifactId,
      provider: 's3-compatible',
      url,
      mimeType: file.mimeType,
      bytes: file.bytes,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'active',
      remoteKey,
      publishAttemptId: request.publishAttemptId,
    }
  }

  async resign(
    record: MediaDeliveryRecord,
    ttlSeconds?: number,
  ): Promise<{ url: string; expiresAt: string }> {
    if (!record.remoteKey) {
      throw createMediaError({
        category: 'MEDIA_SIGN_FAILED',
        userMessage: '재서명할 원격 객체가 없습니다.',
        technicalSummary: 'missing remoteKey',
      })
    }
    const ttl = clampTtlSeconds(ttlSeconds ?? this.defaultTtl)
    try {
      const url = await this.ops.getSignedGetUrl(record.remoteKey, ttl)
      return {
        url,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      }
    } catch (err) {
      throw createMediaError({
        category: 'MEDIA_SIGN_FAILED',
        userMessage: '임시 미디어 URL 재서명에 실패했습니다.',
        technicalSummary: sanitizeErr(err),
        cause: err,
        retryable: isTransient(err),
      })
    }
  }

  async revoke(
    _deliveryId: string,
    record: MediaDeliveryRecord,
  ): Promise<void> {
    if (record.remoteKey) {
      await this.deleteRemoteObject(record.remoteKey)
    }
  }

  async deleteRemoteObject(remoteKey: string): Promise<void> {
    try {
      await this.ops.deleteObject(remoteKey)
    } catch (err) {
      throw createMediaError({
        category: 'MEDIA_REVOKE_FAILED',
        userMessage: '원격 미디어 삭제에 실패했습니다.',
        technicalSummary: sanitizeErr(err),
        cause: err,
        retryable: isTransient(err),
      })
    }
  }

  /** Non-destructive preflight when supported */
  async preflight(): Promise<void> {
    if (!this.ops.headBucket) return
    try {
      await this.ops.headBucket()
    } catch (err) {
      throw createMediaError({
        category: 'MEDIA_NOT_CONFIGURED',
        userMessage: '미디어 저장소에 접근할 수 없습니다. 설정을 확인하세요.',
        technicalSummary: sanitizeErr(err),
        cause: err,
      })
    }
  }

  private async putWithRetry(input: {
    key: string
    body: Buffer
    contentType: string
    metadata: Record<string, string>
  }): Promise<void> {
    const maxAttempts = 3 // initial + 2 retries
    let lastErr: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.ops.putObject({
          key: input.key,
          body: input.body,
          contentType: input.contentType,
          metadata: input.metadata,
        })
        return
      } catch (err) {
        lastErr = err
        if (!isTransient(err) || attempt === maxAttempts - 1) {
          throw createMediaError({
            category: 'MEDIA_UPLOAD_FAILED',
            userMessage: '미디어 업로드에 실패했습니다.',
            technicalSummary: sanitizeErr(err),
            cause: err,
            retryable: isTransient(err),
          })
        }
      }
    }
    throw createMediaError({
      category: 'MEDIA_UPLOAD_FAILED',
      userMessage: '미디어 업로드에 실패했습니다.',
      technicalSummary: sanitizeErr(lastErr),
      cause: lastErr,
    })
  }
}

export function buildRemoteObjectKey(input: {
  projectId: string
  artifactId: string
  deliveryId: string
  mimeType: string
}): string {
  const projectId = sanitizePathSegment(input.projectId)
  const artifactId = sanitizePathSegment(input.artifactId)
  const deliveryId = sanitizePathSegment(input.deliveryId)
  return `agent-deck/${projectId}/${artifactId}/${deliveryId}${extFor(input.mimeType)}`
}

export function createAwsS3MediaOps(cfg: {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}): S3MediaObjectOps {
  const client = new S3Client({
    region: cfg.region || 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    // R2 / many S3-compatible stores expect path-style
    forcePathStyle: true,
    // Avoid AWS SDK default flexible checksums that break some R2 endpoints
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })

  return {
    async putObject(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }),
        input.signal ? { abortSignal: input.signal } : undefined,
      )
    },
    async getSignedGetUrl(key, expiresInSeconds) {
      const command = new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
      })
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds })
    },
    async deleteObject(key, signal) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
        }),
        signal ? { abortSignal: signal } : undefined,
      )
    },
    async headBucket(signal) {
      await client.send(
        new HeadBucketCommand({ Bucket: cfg.bucket }),
        signal ? { abortSignal: signal } : undefined,
      )
    },
  }
}

function newDeliveryId(): string {
  return `mdel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function extFor(mime: string): string {
  if (mime === 'image/png') return '.png'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'video/mp4') return '.mp4'
  if (mime === 'video/webm') return '.webm'
  return '.bin'
}

function sanitizePathSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'x'
}

function sanitizeMeta(s: string): string {
  return s.replace(/[^\w.-]/g, '_').slice(0, 128)
}

function sanitizeErr(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/AKIA[A-Z0-9]+/g, '[redacted]')
    .replace(/SecretAccessKey[=:]\S+/gi, 'SecretAccessKey=[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 240)
}

function isTransient(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as {
    name?: string
    Code?: string
    $metadata?: { httpStatusCode?: number }
    message?: string
  }
  const code = e.name ?? e.Code ?? ''
  const status = e.$metadata?.httpStatusCode
  if (status === 401 || status === 403) return false
  if (/AccessDenied|InvalidAccessKey|SignatureDoesNotMatch|NoSuchBucket|InvalidBucket/i.test(code)) {
    return false
  }
  if (/AccessDenied|InvalidAccessKey|SignatureDoesNotMatch|NoSuchBucket/i.test(e.message ?? '')) {
    return false
  }
  if (status != null && status >= 500) return true
  if (/Timeout|ECONNRESET|ETIMEDOUT|NetworkingError|Throttl|SlowDown|ServiceUnavailable/i.test(code)) {
    return true
  }
  if (status === 429) return true
  return false
}
