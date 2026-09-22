/**
 * ThreadsConnector — official Meta Threads API publish path.
 * Implements SocialConnector. No MarketingService platform switch.
 *
 * Image publish: official API requires public image_url.
 * Local generated files are NOT public → text-only in this Pilot.
 */

import type { CredentialRepository } from '../../credentials/types.js'
import type {
  ConnectorState,
  PublishRequest,
  PublishResult,
  PublishValidationResult,
  SocialConnector,
} from '../types.js'
import { createThreadsError } from './threadsErrors.js'
import {
  buildThreadsPermalink,
  createTextContainer,
  publishContainer,
} from './threadsApi.js'
import { getThreadsAppConfig } from './threadsConfig.js'
import { ThreadsOAuthService } from './threadsOAuth.js'

const TEXT_LIMIT = 500

export class ThreadsConnector implements SocialConnector {
  readonly id = 'threads'
  readonly channel = 'threads' as const
  private readonly oauth: ThreadsOAuthService
  /** Injected API override for fixtures — never used in production boot */
  private publishImpl:
    | ((req: PublishRequest) => Promise<PublishResult>)
    | null = null

  private cache: {
    connected: boolean
    status:
      | 'unconfigured'
      | 'connecting'
      | 'connected'
      | 'expired'
      | 'error'
      | 'disabled'
    username?: string
    profileId?: string
  } = { connected: false, status: 'unconfigured' }

  constructor(private readonly credentials: CredentialRepository) {
    this.oauth = new ThreadsOAuthService(credentials)
  }

  getOAuth(): ThreadsOAuthService {
    return this.oauth
  }

  /** Refresh non-secret connection cache (boot / OAuth / disconnect). */
  async refreshConnectionCache(): Promise<void> {
    const cfg = getThreadsAppConfig()
    const conn = await this.oauth.getPublicConnection()
    if (!cfg.configured) {
      this.cache = { connected: false, status: 'unconfigured' }
      return
    }
    if (conn.status === 'expired') {
      this.cache = {
        connected: false,
        status: 'expired',
        username: conn.username,
        profileId: conn.profileId,
      }
      return
    }
    if (conn.status === 'error') {
      this.cache = {
        connected: false,
        status: 'error',
        username: conn.username,
        profileId: conn.profileId,
      }
      return
    }
    if (conn.connected) {
      this.cache = {
        connected: true,
        status: 'connected',
        username: conn.username,
        profileId: conn.profileId,
      }
      return
    }
    this.cache = { connected: false, status: 'unconfigured' }
  }

  /** Fixture-only: replace real Graph publish */
  setFixturePublish(
    impl: ((req: PublishRequest) => Promise<PublishResult>) | null,
  ): void {
    this.publishImpl = impl
  }

  getState(): ConnectorState {
    const cfg = getThreadsAppConfig()
    const connected = this.cache.connected
    const expired = this.cache.status === 'expired'
    let state: ConnectorState['state'] = 'unconfigured'
    if (!cfg.configured) state = 'unconfigured'
    else if (expired || this.cache.status === 'error') state = 'degraded'
    else if (connected) state = 'available'
    else state = 'configured'

    return {
      id: this.id,
      channel: this.channel,
      state,
      label: connected
        ? `Threads · @${this.cache.username ?? this.cache.profileId ?? 'connected'}`
        : expired
          ? 'Threads · 인증 만료'
          : cfg.configured
            ? 'Threads · 연결 안 됨'
            : 'Threads · 앱 미설정',
      capabilities: ['text.publish'],
      policy: {
        requirements: ['threads_basic', 'threads_content_publish'],
        supportedMedia: ['TEXT'],
        supportsAnalytics: false,
        supportsScheduling: false,
        notes:
          'IMAGE requires public image_url (Meta). Local generated files not published this Pilot.',
      },
      configured: connected || cfg.configured,
      available: connected,
      connection: {
        status: this.cache.status,
        username: this.cache.username,
        profileId: this.cache.profileId,
      },
    }
  }

  async getStateAsync(): Promise<ConnectorState> {
    await this.refreshConnectionCache()
    return this.getState()
  }

  async validate(request: PublishRequest): Promise<PublishValidationResult> {
    const errors: PublishValidationResult['errors'] = []
    if (request.channel !== 'threads') {
      errors.push({
        code: 'THREADS_INVALID_CONTENT',
        message: 'Threads 채널이 아닙니다.',
      })
    }
    const text = request.text?.trim() ?? ''
    if (!text) {
      errors.push({
        code: 'THREADS_INVALID_CONTENT',
        message: '본문이 비어 있습니다.',
      })
    }
    if (text.length > TEXT_LIMIT) {
      errors.push({
        code: 'THREADS_INVALID_CONTENT',
        message: `본문이 ${TEXT_LIMIT}자를 초과합니다.`,
      })
    }
    // Image publish not enabled this Pilot — require MediaDelivery later.
    // Adapter point: metadata.deliveredMedia[].url → image_url when enabled.
    if (request.mediaArtifactIds?.length) {
      const urls = extractDeliveredImageUrls(request)
      if (!urls.length) {
        errors.push({
          code: 'THREADS_MEDIA_URL_REQUIRED',
          message:
            '이미지 게시는 Media Delivery 공개 URL이 필요합니다. 이번 Pilot은 텍스트만 지원합니다.',
        })
      } else {
        // Future: enable IMAGE container with urls[0]. Still blocked this phase.
        errors.push({
          code: 'THREADS_MEDIA_URL_REQUIRED',
          message:
            'Threads 이미지 게시는 아직 활성화되지 않았습니다 (text-only Pilot).',
        })
      }
    }
    return { ok: errors.length === 0, errors }
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (this.publishImpl) {
      return this.publishImpl(request)
    }

    const validation = await this.validate(request)
    if (!validation.ok) {
      throw createThreadsError({
        code: 'THREADS_INVALID_CONTENT',
        userMessage:
          validation.errors[0]?.message ?? '게시 내용이 올바르지 않습니다.',
        technicalSummary: validation.errors.map((e) => e.code).join(','),
      })
    }

    const auth = await this.oauth.getValidAccessToken()
    const text = request.text!.trim()
    const link =
      typeof request.link === 'string' && /^https?:\/\//i.test(request.link)
        ? request.link
        : undefined

    const container = await createTextContainer({
      userId: auth.userId,
      accessToken: auth.accessToken,
      text,
      linkAttachment: link,
    })

    const published = await publishContainer({
      userId: auth.userId,
      accessToken: auth.accessToken,
      creationId: container.id,
    })

    return {
      remotePostId: published.id,
      remoteUrl: buildThreadsPermalink(auth.username, published.id),
      publishedAt: new Date().toISOString(),
    }
  }
}

/** Future Threads IMAGE adapter — reads MediaDelivery URLs only (never local paths). */
export function extractDeliveredImageUrls(
  request: PublishRequest,
): string[] {
  const raw = request.metadata?.deliveredMedia
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const url = (item as { url?: unknown }).url
      return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null
    })
    .filter((u): u is string => Boolean(u))
}
