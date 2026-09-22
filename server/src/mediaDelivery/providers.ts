import { createMediaError, DEFAULT_TTL_SECONDS } from './mediaErrors.js'
import type {
  DeliveredMedia,
  MediaDeliveryProvider,
  MediaDeliveryRecord,
  MediaDeliveryRequest,
  MediaDeliveryState,
  ResolvedArtifactFile,
} from './types.js'

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
    const id = `mdel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const ttl = request.requestedTtlSeconds
    const createdAt = new Date()
    const expiresAt = new Date(
      createdAt.getTime() +
        (ttl != null
          ? Math.min(3600, Math.max(900, ttl)) * 1000
          : DEFAULT_TTL_SECONDS * 1000),
    )
    const remoteKey = `agent-deck/${request.projectId}/${request.artifactId}/${id}${extFor(file.mimeType)}`
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
}

/**
 * Production placeholder — configured via env but upload not implemented this phase.
 * Throws MEDIA_NOT_CONFIGURED-style until real S3 SDK wiring ships.
 */
export class S3CompatibleMediaDeliveryProvider implements MediaDeliveryProvider {
  constructor(
    private readonly cfg: {
      endpoint?: string
      region?: string
      bucket?: string
    },
  ) {}

  getState(): MediaDeliveryState {
    return {
      provider: 's3-compatible',
      configured: true,
      available: false,
      label: 'Media Delivery · S3-compatible (not wired)',
      defaultTtlSeconds: DEFAULT_TTL_SECONDS,
      bucket: this.cfg.bucket,
      region: this.cfg.region,
    }
  }

  async prepare(): Promise<DeliveredMedia> {
    throw createMediaError({
      category: 'MEDIA_NOT_CONFIGURED',
      userMessage:
        'S3-compatible Media Delivery는 설정됐지만 이번 Phase에서 실 업로드가 비활성입니다.',
      technicalSummary: 's3 provider stub — use Fake in fixtures only',
      status: 501,
    })
  }
}

function extFor(mime: string): string {
  if (mime === 'image/png') return '.png'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'video/mp4') return '.mp4'
  if (mime === 'video/webm') return '.webm'
  return '.bin'
}
