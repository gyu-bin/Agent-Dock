/**
 * Publish orchestration — approval binding, idempotency, media validation.
 * Scheduler cannot bypass approval. No remote ID → never "published".
 */

import { randomBytes } from 'node:crypto'
import type { ArtifactService } from '../persistence/artifactService.js'
import type { MarketingRepository } from '../marketing/marketingTypes.js'
import type { MarketingChannel } from '../marketing/marketingTypes.js'
import {
  hashMarketingContentAsync,
  publishIdempotencyKey,
} from './contentHash.js'
import { validateMediaArtifacts } from './mediaValidation.js'
import { createSocialError, isSocialError } from './socialErrors.js'
import type { SocialConnectorRegistry } from './socialConnectorRegistry.js'
import type { JsonSocialRepository } from './socialRepository.js'
import type { MediaDeliveryService } from '../mediaDelivery/mediaDeliveryService.js'
import type {
  ContentApprovalToken,
  PublishedPost,
  PublishAttempt,
  SocialChannel,
} from './types.js'
import type { DeliveredMedia } from '../mediaDelivery/types.js'

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

function asSocialChannel(ch: MarketingChannel): SocialChannel | null {
  const allowed: SocialChannel[] = [
    'threads',
    'instagram',
    'x',
    'youtube',
    'reddit',
    'blog',
    'custom',
  ]
  return allowed.includes(ch as SocialChannel) ? (ch as SocialChannel) : null
}

export interface PublishContentInput {
  projectId: string
  contentId: string
  /** Optional override — defaults to content.campaignId */
  campaignId?: string
}

export interface PublishContentResult {
  post?: PublishedPost
  attempt: PublishAttempt
  duplicate: boolean
  campaignStatus?: string
}

export class SocialPublishService {
  constructor(
    private readonly registry: SocialConnectorRegistry,
    private readonly socialRepo: JsonSocialRepository,
    private readonly marketingRepo: MarketingRepository,
    private readonly artifacts: ArtifactService | null = null,
    private readonly mediaDelivery: MediaDeliveryService | null = null,
  ) {}

  getRegistry(): SocialConnectorRegistry {
    return this.registry
  }

  async listPosts(projectId: string): Promise<PublishedPost[]> {
    const snap = await this.socialRepo.load(projectId)
    return snap.posts
  }

  async getPost(
    projectId: string,
    postId: string,
  ): Promise<PublishedPost | null> {
    const snap = await this.socialRepo.load(projectId)
    return snap.posts.find((p) => p.id === postId) ?? null
  }

  /**
   * Publish a single MarketingContent after human approval.
   * Enforces: approval → hash match → connector → remote ID.
   */
  async publishContent(
    input: PublishContentInput,
  ): Promise<PublishContentResult> {
    const mSnap = await this.marketingRepo.load(input.projectId)
    const content = mSnap.contents.find((c) => c.id === input.contentId)
    if (!content) {
      throw createSocialError({
        category: 'SOCIAL_INVALID_REQUEST',
        userMessage: '게시할 콘텐츠를 찾을 수 없습니다.',
        technicalSummary: 'content not found',
        status: 404,
      })
    }
    const campaignId = input.campaignId ?? content.campaignId
    const campaign = mSnap.campaigns.find((c) => c.id === campaignId)
    if (!campaign) {
      throw createSocialError({
        category: 'SOCIAL_INVALID_REQUEST',
        userMessage: '캠페인을 찾을 수 없습니다.',
        technicalSummary: 'campaign not found',
        status: 404,
      })
    }

    const channel = asSocialChannel(content.channel)
    if (!channel) {
      throw createSocialError({
        category: 'SOCIAL_INVALID_REQUEST',
        userMessage: '지원하지 않는 채널입니다.',
        technicalSummary: `channel=${content.channel}`,
      })
    }

    const pkg = campaign.publishPackage
    if (!pkg || pkg.approvalStatus !== 'approved') {
      throw createSocialError({
        category: 'SOCIAL_NOT_APPROVED',
        userMessage: '게시 승인이 필요합니다. 승인 없이 게시할 수 없습니다.',
        technicalSummary: 'approvalStatus not approved',
      })
    }

    const tokens = (pkg as { approvalTokens?: ContentApprovalToken[] })
      .approvalTokens
    const token = tokens?.find((t) => t.contentId === content.id)
    if (!token) {
      throw createSocialError({
        category: 'SOCIAL_NOT_APPROVED',
        userMessage: '이 콘텐츠에 대한 게시 승인 토큰이 없습니다.',
        technicalSummary: 'missing approval token',
      })
    }

    const currentHash = await hashMarketingContentAsync(
      content,
      input.projectId,
      this.artifacts,
    )
    if (currentHash !== token.contentHash) {
      throw createSocialError({
        category: 'SOCIAL_HASH_MISMATCH',
        userMessage:
          '승인 이후 콘텐츠가 변경되었습니다. 다시 승인한 뒤 게시하세요.',
        technicalSummary: 'content hash mismatch (TOCTOU)',
      })
    }

    const idempotencyKey = publishIdempotencyKey({
      campaignId,
      contentId: content.id,
      channel,
    })

    const socialSnap = await this.socialRepo.load(input.projectId)

    // Idempotency: already published successfully
    const existing = socialSnap.posts.find(
      (p) =>
        p.idempotencyKey === idempotencyKey && p.status === 'published',
    )
    if (existing) {
      const attempt: PublishAttempt = {
        id: id('pattempt'),
        projectId: input.projectId,
        campaignId,
        contentId: content.id,
        channel,
        idempotencyKey,
        status: 'duplicate',
        contentHash: currentHash,
        approvalHash: token.contentHash,
        publishedPostId: existing.id,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
      socialSnap.attempts.unshift(attempt)
      await this.socialRepo.save(socialSnap)
      return {
        post: existing,
        attempt,
        duplicate: true,
        campaignStatus: campaign.status,
      }
    }

    // Pending attempt with same key — do not double-publish
    const inflight = socialSnap.attempts.find(
      (a) =>
        a.idempotencyKey === idempotencyKey && a.status === 'pending',
    )
    if (inflight) {
      throw createSocialError({
        category: 'SOCIAL_DUPLICATE',
        userMessage: '동일 콘텐츠 게시가 이미 진행 중입니다.',
        technicalSummary: 'pending attempt exists',
      })
    }

    if (!this.registry.isChannelPublishAvailable(channel)) {
      throw createSocialError({
        category: 'SOCIAL_NOT_CONFIGURED',
        userMessage: `${channel} 커넥터가 연결되지 않았습니다.`,
        technicalSummary: `connector unavailable: ${channel}`,
      })
    }

    const mediaIds = content.creativeArtifactIds ?? []
    if (mediaIds.length && this.artifacts) {
      await validateMediaArtifacts({
        projectId: input.projectId,
        mediaArtifactIds: mediaIds,
        artifacts: this.artifacts,
      })
    } else if (mediaIds.length && !this.artifacts) {
      throw createSocialError({
        category: 'SOCIAL_MEDIA_INVALID',
        userMessage: '미디어 검증을 수행할 수 없습니다.',
        technicalSummary: 'no artifact service',
      })
    }

    const publishAttemptId = id('pattempt')
    const attempt: PublishAttempt = {
      id: publishAttemptId,
      projectId: input.projectId,
      campaignId,
      contentId: content.id,
      channel,
      idempotencyKey,
      status: 'pending',
      contentHash: currentHash,
      approvalHash: token.contentHash,
      createdAt: new Date().toISOString(),
    }
    socialSnap.attempts.unshift(attempt)

    // Mark content publishing (not published yet)
    content.status = 'publishing'
    content.updatedAt = new Date().toISOString()
    const chPlan = campaign.channels.find((c) => c.channel === content.channel)
    if (chPlan) chPlan.publishStatus = 'ready'
    await this.marketingRepo.save(mSnap)
    await this.socialRepo.save(socialSnap)

    // Prepare temporary public media URLs AFTER approval (never before)
    const deliveredMedia: DeliveredMedia[] = []
    if (mediaIds.length) {
      if (!this.mediaDelivery?.isAvailable()) {
        throw createSocialError({
          category: 'SOCIAL_MEDIA_INVALID',
          userMessage:
            '미디어 전달 Provider가 없어 이미지 게시를 진행할 수 없습니다.',
          technicalSummary: 'media delivery not configured',
        })
      }
      for (const artifactId of mediaIds) {
        const delivered = await this.mediaDelivery.prepare({
          projectId: input.projectId,
          artifactId,
          purpose: 'social-publish',
          publishAttemptId,
        })
        deliveredMedia.push(delivered)
      }
    }

    const connector = this.registry.getConnector(channel)
    try {
      const validation = await connector.validate({
        projectId: input.projectId,
        campaignId,
        contentId: content.id,
        channel,
        text: content.body,
        title: content.title,
        mediaArtifactIds: mediaIds,
        idempotencyKey,
        publishAttemptId,
        metadata: {
          hashtags: content.hashtags,
          deliveredMedia: deliveredMedia.map((d) => ({
            id: d.id,
            url: d.url,
            mimeType: d.mimeType,
            artifactId: d.artifactId,
            expiresAt: d.expiresAt,
          })),
        },
      })
      if (!validation.ok) {
        throw createSocialError({
          category: 'SOCIAL_INVALID_REQUEST',
          userMessage:
            validation.errors[0]?.message ?? '게시 요청이 올바르지 않습니다.',
          technicalSummary: validation.errors.map((e) => e.code).join(','),
        })
      }

      const result = await connector.publish({
        projectId: input.projectId,
        campaignId,
        contentId: content.id,
        channel,
        text: content.body,
        title: content.title,
        mediaArtifactIds: mediaIds,
        idempotencyKey,
        publishAttemptId,
        metadata: {
          hashtags: content.hashtags,
          deliveredMedia: deliveredMedia.map((d) => ({
            id: d.id,
            url: d.url,
            mimeType: d.mimeType,
            artifactId: d.artifactId,
            expiresAt: d.expiresAt,
          })),
        },
      })

      if (!result.remotePostId?.trim()) {
        throw createSocialError({
          category: 'SOCIAL_UPSTREAM',
          userMessage: '원격 게시 ID를 받지 못해 게시 완료로 처리할 수 없습니다.',
          technicalSummary: 'missing remotePostId',
          status: 502,
        })
      }

      const post: PublishedPost = {
        id: id('spost'),
        projectId: input.projectId,
        campaignId,
        contentId: content.id,
        channel,
        remotePostId: result.remotePostId,
        remoteUrl: result.remoteUrl,
        publishedAt: result.publishedAt,
        status: 'published',
        connectorId: connector.id,
        idempotencyKey,
        publishAttemptId,
      }

      // Re-load to avoid stale writes
      const social2 = await this.socialRepo.load(input.projectId)
      const att = social2.attempts.find((a) => a.id === publishAttemptId)
      if (att) {
        att.status = 'succeeded'
        att.publishedPostId = post.id
        att.completedAt = new Date().toISOString()
      }
      social2.posts.unshift(post)
      await this.socialRepo.save(social2)

      const m2 = await this.marketingRepo.load(input.projectId)
      const c2 = m2.contents.find((c) => c.id === content.id)
      const camp2 = m2.campaigns.find((c) => c.id === campaignId)
      if (c2) {
        c2.status = 'published'
        c2.updatedAt = new Date().toISOString()
      }
      if (camp2) {
        const ch = camp2.channels.find((x) => x.channel === content.channel)
        if (ch) ch.publishStatus = 'published'
        camp2.status = aggregateCampaignStatus(camp2, m2.contents)
        camp2.updatedAt = new Date().toISOString()
      }
      await this.marketingRepo.save(m2)

      return {
        post,
        attempt: att ?? attempt,
        duplicate: false,
        campaignStatus: camp2?.status,
      }
    } catch (err) {
      const socialErr = isSocialError(err)
        ? err
        : createSocialError({
            category: 'SOCIAL_UNKNOWN',
            userMessage: '게시에 실패했습니다.',
            technicalSummary:
              err instanceof Error ? err.message : String(err),
            cause: err,
          })

      const isUnknown =
        socialErr.technicalSummary.includes('THREADS_PUBLISH_UNKNOWN') ||
        socialErr.technicalSummary.includes('ambiguous publish')

      const socialFail = await this.socialRepo.load(input.projectId)
      const att = socialFail.attempts.find((a) => a.id === publishAttemptId)
      if (att) {
        att.status = isUnknown ? 'reconciliation_required' : 'failed'
        att.errorCode = socialErr.category
        att.errorMessage = socialErr.userMessage
        att.completedAt = new Date().toISOString()
      }
      await this.socialRepo.save(socialFail)

      const mFail = await this.marketingRepo.load(input.projectId)
      const cFail = mFail.contents.find((c) => c.id === content.id)
      if (cFail && cFail.status === 'publishing') {
        // Never mark published without remote id — unknown stays failed-ish
        cFail.status = 'failed'
        cFail.updatedAt = new Date().toISOString()
      }
      await this.marketingRepo.save(mFail)

      throw socialErr
    }
  }
}

/**
 * Aggregate channel publish states into campaign status.
 * Never mark completed unless all enabled publishable channels published
 * OR remaining are unavailable (partial ok → partially_published).
 */
export function aggregateCampaignStatus(
  campaign: {
    id: string
    channels: Array<{
      channel: string
      enabled: boolean
      publishStatus: string
      requiredCapabilities?: string[]
    }>
    status: string
  },
  contents: Array<{ campaignId: string; channel: string; status: string }>,
):
  | 'approved'
  | 'partially_published'
  | 'completed'
  | 'blocked'
  | 'awaiting_approval' {
  if (campaign.status === 'awaiting_approval') return 'awaiting_approval'

  const enabled = campaign.channels.filter((c) => c.enabled)
  const related = contents.filter((c) => c.campaignId === campaign.id)

  const publishedChannels = new Set(
    related
      .filter((c) => c.status === 'published')
      .map((c) => c.channel),
  )

  let publishable = 0
  let published = 0
  let unavailable = 0

  for (const ch of enabled) {
    if (ch.publishStatus === 'unavailable') {
      unavailable += 1
      continue
    }
    publishable += 1
    if (
      ch.publishStatus === 'published' ||
      publishedChannels.has(ch.channel)
    ) {
      published += 1
    }
  }

  if (publishable === 0 && unavailable > 0) return 'blocked'
  if (published === 0) return 'approved'
  // Recommended-but-unconnected channels keep campaign from "fully done"
  if (published >= publishable && unavailable === 0) return 'completed'
  return 'partially_published'
}
