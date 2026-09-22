/**
 * Fake Social Connector — fixtures / tests ONLY.
 * Production must NEVER auto-fallback to this.
 */

import { randomBytes } from 'node:crypto'
import { createSocialError } from '../socialErrors.js'
import type {
  ConnectorCapability,
  ConnectorState,
  PostMetrics,
  PublishedPost,
  PublishRequest,
  PublishResult,
  PublishValidationResult,
  SocialChannel,
  SocialConnector,
} from '../types.js'

export class FakeSocialConnector implements SocialConnector {
  readonly id: string
  readonly channel: SocialChannel
  private readonly caps: ConnectorCapability[]
  private forceFail = false

  constructor(
    channel: SocialChannel,
    caps: ConnectorCapability[] = ['text.publish', 'analytics.read'],
  ) {
    this.channel = channel
    this.id = `fake-${channel}`
    this.caps = caps
  }

  /** Fixture helper — next publish throws upstream error */
  setForceFail(fail: boolean): void {
    this.forceFail = fail
  }

  getState(): ConnectorState {
    return {
      id: this.id,
      channel: this.channel,
      state: 'available',
      label: `${this.channel} · Fake (fixture)`,
      capabilities: this.caps,
      policy: {
        supportsAnalytics: this.caps.includes('analytics.read'),
        supportsScheduling: false,
      },
      configured: true,
      available: true,
    }
  }

  async validate(request: PublishRequest): Promise<PublishValidationResult> {
    const errors: PublishValidationResult['errors'] = []
    const delivered = Array.isArray(request.metadata?.deliveredMedia)
      ? (request.metadata!.deliveredMedia as unknown[])
      : []
    if (!request.text?.trim() && delivered.length === 0) {
      errors.push({
        code: 'SOCIAL_INVALID_REQUEST',
        message: 'text 또는 delivered media가 필요합니다.',
      })
    }
    return { ok: errors.length === 0, errors }
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (this.forceFail) {
      throw createSocialError({
        category: 'SOCIAL_UPSTREAM',
        userMessage: '게시 중 오류가 발생했습니다 (fixture).',
        technicalSummary: 'forced fake connector failure',
        status: 502,
        retryable: true,
      })
    }
    const validation = await this.validate(request)
    if (!validation.ok) {
      throw createSocialError({
        category: 'SOCIAL_INVALID_REQUEST',
        userMessage: validation.errors[0]?.message ?? '게시 요청이 올바르지 않습니다.',
        technicalSummary: validation.errors.map((e) => e.code).join(','),
      })
    }
    const delivered = Array.isArray(request.metadata?.deliveredMedia)
      ? (request.metadata!.deliveredMedia as Array<{ url?: string }>)
      : []
    const remotePostId = `fake_${this.channel}_${randomBytes(4).toString('hex')}`
    return {
      remotePostId,
      remoteUrl: `https://example.test/${this.channel}/${remotePostId}`,
      publishedAt: new Date().toISOString(),
      // Connectors never upload; they only receive URLs
      ...(delivered[0]?.url
        ? { /* metadata carried via PublishedPost optional fields later */ }
        : {}),
    }
  }

  async getMetrics(publishedPost: PublishedPost): Promise<PostMetrics> {
    return {
      publishedPostId: publishedPost.id,
      collectedAt: new Date().toISOString(),
      impressions: 120,
      likes: 7,
      comments: 2,
      shares: undefined,
      views: undefined,
      clicks: undefined,
      saves: undefined,
      rawMetrics: {
        fake_impressions: 120,
        fake_likes: 7,
        fake_comments: 2,
      },
    }
  }
}
