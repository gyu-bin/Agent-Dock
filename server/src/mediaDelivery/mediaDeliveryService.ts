/**
 * MediaDeliveryService — prepare / revoke / cleanup / reuse / resign.
 * Production never auto-falls back to Fake.
 */

import type { ArtifactService } from '../persistence/artifactService.js'
import type { UsageService } from '../persistence/usageService.js'
import { resolveArtifactMediaFile } from './artifactFileResolver.js'
import {
  clampTtlSeconds,
  getMediaDeliveryProviderId,
  getS3CompatibleProviderConfig,
} from './mediaConfig.js'
import { createMediaError, isMediaError } from './mediaErrors.js'
import {
  JsonMediaDeliveryRepository,
  mediaDeliveryRepository,
} from './mediaDeliveryRepository.js'
import {
  FakeMediaDeliveryProvider,
  S3CompatibleMediaDeliveryProvider,
  UnconfiguredMediaDeliveryProvider,
} from './providers.js'
import type {
  DeliveredMedia,
  MediaDeliveryProvider,
  MediaDeliveryRecord,
  MediaDeliveryRequest,
  MediaDeliveryState,
} from './types.js'

export class MediaDeliveryService {
  constructor(
    private provider: MediaDeliveryProvider,
    private readonly repo: JsonMediaDeliveryRepository,
    private readonly artifacts: ArtifactService | null = null,
    private readonly usage: UsageService | null = null,
  ) {}

  setProvider(provider: MediaDeliveryProvider): void {
    this.provider = provider
  }

  getProvider(): MediaDeliveryProvider {
    return this.provider
  }

  getState(): MediaDeliveryState {
    return this.provider.getState()
  }

  isAvailable(): boolean {
    const s = this.provider.getState()
    return s.configured && s.available
  }

  async prepare(request: MediaDeliveryRequest): Promise<DeliveredMedia> {
    if (!this.isAvailable()) {
      throw createMediaError({
        category: 'MEDIA_NOT_CONFIGURED',
        userMessage: '미디어 전달이 설정되지 않았습니다.',
        technicalSummary: 'provider unavailable',
      })
    }
    if (!this.artifacts) {
      throw createMediaError({
        category: 'MEDIA_ARTIFACT_NOT_FOUND',
        userMessage: 'Artifact 서비스를 사용할 수 없습니다.',
        technicalSummary: 'no artifact service',
      })
    }

    // Reuse active delivery for same publishAttempt + artifact (re-sign, no re-upload)
    if (request.publishAttemptId) {
      const existing = await this.findReusable(
        request.projectId,
        request.artifactId,
        request.publishAttemptId,
        request.requestedTtlSeconds,
      )
      if (existing) return existing
    }

    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    try {
      const file = await resolveArtifactMediaFile({
        projectId: request.projectId,
        artifactId: request.artifactId,
        artifacts: this.artifacts,
        expectedMimeTypes: request.expectedMimeTypes,
        maxBytes: request.maxBytes,
      })

      const ttl = clampTtlSeconds(request.requestedTtlSeconds)
      const delivered = await this.provider.prepare(
        { ...request, requestedTtlSeconds: ttl },
        file,
      )

      const snap = await this.repo.load(request.projectId)
      const record: MediaDeliveryRecord = {
        id: delivered.id,
        projectId: delivered.projectId,
        artifactId: delivered.artifactId,
        provider: delivered.provider,
        remoteKey: delivered.remoteKey,
        mimeType: delivered.mimeType,
        bytes: delivered.bytes,
        createdAt: delivered.createdAt,
        expiresAt: delivered.expiresAt,
        status: 'active',
        publishAttemptId: request.publishAttemptId,
        // Production signed URLs are transient — never persist
        urlHint: delivered.provider === 'fake' ? delivered.url : undefined,
      }
      snap.deliveries.unshift(record)
      await this.repo.save(snap)

      if (this.usage) {
        await this.usage.recordManual({
          projectId: request.projectId,
          taskId: `media_${delivered.id}`,
          provider: 'media-delivery',
          operation: 'media.prepare',
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
          sourceId: delivered.id,
        })
      }

      return delivered
    } catch (err) {
      if (this.usage) {
        const mediaErr = isMediaError(err)
          ? err
          : createMediaError({
              category: 'MEDIA_UNKNOWN',
              userMessage: '미디어 전달 준비에 실패했습니다.',
              technicalSummary:
                err instanceof Error ? err.message : String(err),
            })
        await this.usage
          .recordManual({
            projectId: request.projectId,
            taskId: `media_fail_${request.artifactId}`,
            provider: 'media-delivery',
            operation: 'media.prepare',
            status: 'failed',
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - t0,
            errorCategory:
              mediaErr.category === 'MEDIA_TOO_LARGE' ||
              mediaErr.category === 'MEDIA_UNSUPPORTED_TYPE' ||
              mediaErr.category === 'MEDIA_PATH_VIOLATION' ||
              mediaErr.category === 'MEDIA_OWNERSHIP'
                ? 'INVALID_REQUEST'
                : mediaErr.category === 'MEDIA_NOT_CONFIGURED'
                  ? 'AUTH'
                  : 'UPSTREAM',
            userMessage: mediaErr.userMessage,
            technicalSummary: mediaErr.technicalSummary,
            sourceId: `fail_${Date.now().toString(36)}`,
          })
          .catch(() => undefined)
      }
      throw err
    }
  }

  /**
   * Re-sign an existing delivery's remote object (no re-upload).
   */
  async signExisting(
    projectId: string,
    deliveryId: string,
    ttlSeconds?: number,
  ): Promise<DeliveredMedia> {
    const snap = await this.repo.load(projectId)
    const rec = snap.deliveries.find((d) => d.id === deliveryId)
    if (!rec || rec.projectId !== projectId) {
      throw createMediaError({
        category: 'MEDIA_ARTIFACT_NOT_FOUND',
        userMessage: 'Delivery를 찾을 수 없습니다.',
        technicalSummary: 'delivery not found',
        status: 404,
      })
    }
    if (rec.status === 'revoked') {
      throw createMediaError({
        category: 'MEDIA_SIGN_FAILED',
        userMessage: '해제된 Delivery는 재서명할 수 없습니다.',
        technicalSummary: 'delivery revoked',
      })
    }
    return this.resignRecord(snap, rec, ttlSeconds)
  }

  async revoke(projectId: string, deliveryId: string): Promise<void> {
    const snap = await this.repo.load(projectId)
    const rec = snap.deliveries.find((d) => d.id === deliveryId)
    if (!rec || rec.projectId !== projectId) {
      throw createMediaError({
        category: 'MEDIA_ARTIFACT_NOT_FOUND',
        userMessage: 'Delivery를 찾을 수 없습니다.',
        technicalSummary: 'delivery not found',
        status: 404,
      })
    }
    try {
      if (this.provider.revoke) {
        await this.provider.revoke(deliveryId, rec)
      } else if (rec.remoteKey && this.provider.deleteRemoteObject) {
        await this.provider.deleteRemoteObject(rec.remoteKey)
      }
    } catch (err) {
      if (isMediaError(err)) throw err
      throw createMediaError({
        category: 'MEDIA_REVOKE_FAILED',
        userMessage: '미디어 전달 해제에 실패했습니다.',
        technicalSummary:
          err instanceof Error ? err.message : 'revoke failed',
        cause: err,
      })
    }
    rec.status = 'revoked'
    await this.repo.save(snap)
  }

  async cleanupExpired(
    now: Date = new Date(),
  ): Promise<{ expired: number; revoked: number }> {
    const projectIds = await this.repo.listProjectIds()
    let expired = 0
    let revoked = 0
    const nowMs = now.getTime()
    for (const projectId of projectIds) {
      const snap = await this.repo.load(projectId)
      let dirty = false
      for (const d of snap.deliveries) {
        if (d.status !== 'active') continue
        if (Date.parse(d.expiresAt) <= nowMs) {
          d.status = 'expired'
          expired += 1
          dirty = true
          try {
            if (d.remoteKey && this.provider.deleteRemoteObject) {
              await this.provider.deleteRemoteObject(d.remoteKey)
              revoked += 1
            }
          } catch {
            // must not damage other projects — continue
          }
        }
      }
      if (dirty) await this.repo.save(snap)
    }
    return { expired, revoked }
  }

  async listDeliveries(projectId: string): Promise<MediaDeliveryRecord[]> {
    const snap = await this.repo.load(projectId)
    return snap.deliveries
  }

  /** Rebuild DeliveredMedia view; expired/revoked must not be treated as active */
  toDeliveredMedia(
    record: MediaDeliveryRecord,
    now = new Date(),
  ): DeliveredMedia | null {
    const expired = Date.parse(record.expiresAt) <= now.getTime()
    const status =
      record.status === 'revoked'
        ? 'revoked'
        : expired || record.status === 'expired'
          ? 'expired'
          : 'active'
    if (status !== 'active') return null
    const url =
      record.urlHint ??
      (record.provider === 'fake'
        ? `https://media.invalid/${record.id}`
        : '')
    if (!url) return null
    return {
      id: record.id,
      projectId: record.projectId,
      artifactId: record.artifactId,
      provider: record.provider,
      url,
      mimeType: record.mimeType,
      bytes: record.bytes,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      status: 'active',
      remoteKey: record.remoteKey,
      publishAttemptId: record.publishAttemptId,
    }
  }

  private async findReusable(
    projectId: string,
    artifactId: string,
    publishAttemptId: string,
    requestedTtlSeconds?: number,
  ): Promise<DeliveredMedia | null> {
    const snap = await this.repo.load(projectId)
    const now = new Date()
    for (const d of snap.deliveries) {
      if (
        d.artifactId !== artifactId ||
        d.publishAttemptId !== publishAttemptId ||
        d.status !== 'active'
      ) {
        continue
      }
      // Still within TTL window — return (re-sign for production without urlHint)
      if (Date.parse(d.expiresAt) > now.getTime()) {
        const cached = this.toDeliveredMedia(d, now)
        if (cached) return cached
        if (d.remoteKey && this.provider.resign) {
          return this.resignRecord(snap, d, requestedTtlSeconds)
        }
      }
      // Object may still exist but URL/TTL expired → re-sign same remoteKey
      // (do not re-upload). Extend expiresAt.
      if (d.remoteKey && this.provider.resign) {
        return this.resignRecord(snap, d, requestedTtlSeconds)
      }
    }
    return null
  }

  private async resignRecord(
    snap: Awaited<ReturnType<JsonMediaDeliveryRepository['load']>>,
    rec: MediaDeliveryRecord,
    ttlSeconds?: number,
  ): Promise<DeliveredMedia> {
    if (!this.provider.resign) {
      throw createMediaError({
        category: 'MEDIA_SIGN_FAILED',
        userMessage: '이 Provider는 URL 재서명을 지원하지 않습니다.',
        technicalSummary: 'resign not supported',
      })
    }
    const ttl = clampTtlSeconds(ttlSeconds)
    const signed = await this.provider.resign(rec, ttl)
    rec.expiresAt = signed.expiresAt
    rec.status = 'active'
    if (rec.provider === 'fake') {
      rec.urlHint = signed.url
    }
    await this.repo.save(snap)
    return {
      id: rec.id,
      projectId: rec.projectId,
      artifactId: rec.artifactId,
      provider: rec.provider,
      url: signed.url,
      mimeType: rec.mimeType,
      bytes: rec.bytes,
      createdAt: rec.createdAt,
      expiresAt: signed.expiresAt,
      status: 'active',
      remoteKey: rec.remoteKey,
      publishAttemptId: rec.publishAttemptId,
    }
  }
}

export function createMediaDeliveryService(deps: {
  artifacts?: ArtifactService | null
  usage?: UsageService | null
  repo?: JsonMediaDeliveryRepository
  /** Explicit provider (fixtures). Never auto-fake in production. */
  provider?: MediaDeliveryProvider
}): MediaDeliveryService {
  return new MediaDeliveryService(
    deps.provider ?? createDefaultMediaProvider(),
    deps.repo ?? mediaDeliveryRepository,
    deps.artifacts ?? null,
    deps.usage ?? null,
  )
}

export function createDefaultMediaProvider(
  env: NodeJS.ProcessEnv = process.env,
): MediaDeliveryProvider {
  const id = getMediaDeliveryProviderId(env)
  if (id === 'fake') {
    return new FakeMediaDeliveryProvider()
  }
  if (id === 's3-compatible') {
    const full = getS3CompatibleProviderConfig(env)
    if (full) {
      return new S3CompatibleMediaDeliveryProvider(full)
    }
    // Selected but incomplete — no Fake fallback; report s3-compatible unavailable
    return new S3CompatibleMediaDeliveryProvider({
      endpoint: env.MEDIA_S3_ENDPOINT?.trim() || '',
      region: env.MEDIA_S3_REGION?.trim() || 'auto',
      bucket: env.MEDIA_S3_BUCKET?.trim() || '',
      accessKeyId: '',
      secretAccessKey: '',
      defaultTtlSeconds: undefined,
    })
  }
  return new UnconfiguredMediaDeliveryProvider()
}
