/**
 * BufferPublishService — approval → MediaDelivery → Buffer createPost.
 * Never marks SNS "published" for queue/scheduled/draft.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { ArtifactService } from '../../persistence/artifactService.js'
import type { UsageService } from '../../persistence/usageService.js'
import type { MarketingRepository } from '../../marketing/marketingTypes.js'
import type { MarketingChannel } from '../../marketing/marketingTypes.js'
import type { MediaDeliveryService } from '../../mediaDelivery/mediaDeliveryService.js'
import {
  hashMarketingContentAsync,
  publishIdempotencyKey,
} from '../contentHash.js'
import { validateMediaArtifacts } from '../mediaValidation.js'
import { createSocialError } from '../socialErrors.js'
import type { JsonSocialRepository } from '../socialRepository.js'
import type {
  ContentApprovalToken,
  PublishedPost,
  PublishAttempt,
  SocialChannel,
} from '../types.js'
import type { BufferConnector } from './bufferConnector.js'
import { pickBufferChannelForMarketing } from './channelMapping.js'
import { createBufferError, isBufferError } from './bufferErrors.js'
import {
  bufferStatusToPublishedStatus,
} from './bufferTime.js'
import type {
  BufferPublishMode,
  BufferPublishedRecord,
  ProjectDistributionPrefs,
} from './bufferTypes.js'

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

export function hashBufferPublishBinding(input: {
  contentHash: string
  bufferChannelId: string
  mode: BufferPublishMode
  dueAt?: string | null
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        contentHash: input.contentHash,
        bufferChannelId: input.bufferChannelId,
        mode: input.mode,
        dueAt: input.dueAt ?? null,
      }),
    )
    .digest('hex')
}

export interface BufferPublishInput {
  projectId: string
  contentId: string
  campaignId?: string
  mode: BufferPublishMode
  dueAt?: string
  /** Override mapped channel */
  bufferChannelId?: string
}

export interface BufferPublishResult {
  record: BufferPublishedRecord
  post: PublishedPost
  attempt: PublishAttempt
  duplicate: boolean
}

export class BufferPublishService {
  constructor(
    private readonly buffer: BufferConnector,
    private readonly socialRepo: JsonSocialRepository,
    private readonly marketingRepo: MarketingRepository,
    private readonly artifacts: ArtifactService | null = null,
    private readonly mediaDelivery: MediaDeliveryService | null = null,
    private readonly usage: UsageService | null = null,
  ) {}

  getConnector(): BufferConnector {
    return this.buffer
  }

  async getDistributionPrefs(
    projectId: string,
  ): Promise<ProjectDistributionPrefs> {
    const snap = await this.socialRepo.load(projectId)
    return (
      snap.distribution ?? {
        provider: 'manual',
        bufferChannels: {},
      }
    )
  }

  async setDistributionPrefs(
    projectId: string,
    prefs: ProjectDistributionPrefs,
  ): Promise<ProjectDistributionPrefs> {
    const snap = await this.socialRepo.load(projectId)
    snap.distribution = {
      provider: prefs.provider,
      bufferChannels: { ...prefs.bufferChannels },
    }
    await this.socialRepo.save(snap)
    return snap.distribution
  }

  async publishToBuffer(
    input: BufferPublishInput,
  ): Promise<BufferPublishResult> {
    const startedAt = new Date().toISOString()
    const t0 = Date.now()

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

    // Approval required for ALL Buffer writes (including draft)
    const pkg = campaign.publishPackage
    if (!pkg || pkg.approvalStatus !== 'approved') {
      throw createSocialError({
        category: 'SOCIAL_NOT_APPROVED',
        userMessage: '게시 승인이 필요합니다. 승인 없이 Buffer로 보낼 수 없습니다.',
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
          '승인 이후 콘텐츠가 변경되었습니다. 다시 승인한 뒤 Buffer로 보내세요.',
        technicalSummary: 'content hash mismatch',
      })
    }

    const state = await this.buffer.refreshState()
    if (!state.available) {
      throw createBufferError({
        category: 'BUFFER_NOT_CONFIGURED',
        userMessage: 'Buffer가 연결되지 않았습니다.',
        technicalSummary: state.errorCategory ?? 'unavailable',
      })
    }

    const prefs = await this.getDistributionPrefs(input.projectId)
    const map = prefs.bufferChannels
    const preferredId =
      input.bufferChannelId ??
      (channel === 'threads'
        ? map.threadsChannelId
        : channel === 'instagram'
          ? map.instagramChannelId
          : channel === 'youtube'
            ? map.youtubeChannelId
            : map.byService?.[channel])

    const bufferChannel = pickBufferChannelForMarketing(
      state.channels,
      channel,
      typeof preferredId === 'string' ? preferredId : undefined,
    )
    if (!bufferChannel) {
      throw createBufferError({
        category: 'BUFFER_INVALID_CHANNEL',
        userMessage: `Buffer에서 ${channel} 채널을 찾을 수 없습니다.`,
        technicalSummary: `no buffer channel for ${channel}`,
      })
    }

    const approvedMode = token.publishMode ?? 'queue'
    const approvedDueAt = token.dueAt ?? null
    if (approvedMode !== input.mode || approvedDueAt !== (input.dueAt ?? null)) {
      throw createSocialError({
        category: 'SOCIAL_HASH_MISMATCH',
        userMessage:
          '승인된 게시 방식/예약 시간과 다릅니다. 다시 승인한 뒤 Buffer로 보내세요.',
        technicalSummary: `mode/dueAt mismatch approved=${approvedMode}/${approvedDueAt} got=${input.mode}/${input.dueAt ?? null}`,
      })
    }
    if (
      token.bufferChannelId &&
      token.bufferChannelId !== bufferChannel.id
    ) {
      throw createSocialError({
        category: 'SOCIAL_HASH_MISMATCH',
        userMessage:
          '승인된 Buffer 채널과 다릅니다. 다시 승인한 뒤 Buffer로 보내세요.',
        technicalSummary: 'bufferChannelId mismatch',
      })
    }
    void hashBufferPublishBinding({
      contentHash: currentHash,
      bufferChannelId: bufferChannel.id,
      mode: input.mode,
      dueAt: input.dueAt ?? null,
    })

    const idempotencyKey = `buf_${publishIdempotencyKey({
      campaignId,
      contentId: content.id,
      channel,
    })}_${input.mode}`

    const socialSnap = await this.socialRepo.load(input.projectId)
    socialSnap.bufferPosts = socialSnap.bufferPosts ?? []

    const existing = socialSnap.bufferPosts.find(
      (p) =>
        p.idempotencyKey === idempotencyKey &&
        p.status !== 'error',
    )
    if (existing) {
      const mapped = socialSnap.posts.find(
        (p) => p.remotePostId === existing.bufferPostId,
      )
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
        publishedPostId: mapped?.id,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
      socialSnap.attempts.unshift(attempt)
      await this.socialRepo.save(socialSnap)
      if (!mapped) {
        throw createBufferError({
          category: 'BUFFER_PUBLISH_UNKNOWN',
          userMessage: '이미 Buffer에 전송된 게시물입니다.',
          technicalSummary: 'duplicate without local post',
        })
      }
      return {
        record: existing,
        post: mapped,
        attempt,
        duplicate: true,
      }
    }

    const mediaIds = content.creativeArtifactIds ?? []
    if (mediaIds.length && this.artifacts) {
      await validateMediaArtifacts({
        projectId: input.projectId,
        mediaArtifactIds: mediaIds,
        artifacts: this.artifacts,
      })
    }

    const imageUrls: string[] = []
    const publishAttemptId = id('pattempt')
    if (mediaIds.length) {
      if (!this.mediaDelivery?.isAvailable()) {
        throw createBufferError({
          category: 'BUFFER_MEDIA_REQUIRED',
          userMessage:
            '이미지를 Buffer에 전달할 미디어 URL을 준비할 수 없습니다.',
          technicalSummary: 'media delivery unavailable',
        })
      }
      for (const artifactId of mediaIds) {
        const delivered = await this.mediaDelivery.prepare({
          projectId: input.projectId,
          artifactId,
          purpose: 'social-publish',
          publishAttemptId,
        })
        imageUrls.push(delivered.url)
      }
    }

    const text = [
      content.title?.trim(),
      content.body.trim(),
      (content.hashtags ?? []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' '),
    ]
      .filter(Boolean)
      .join('\n\n')

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
      createdAt: startedAt,
    }
    socialSnap.attempts.unshift(attempt)
    await this.socialRepo.save(socialSnap)

    try {
      const created = await this.buffer.createPost({
        channelId: bufferChannel.id,
        text,
        mode: input.mode,
        dueAt: input.dueAt,
        imageUrls,
        aiAssisted: true,
        saveToDraft: input.mode === 'draft',
      })

      const record: BufferPublishedRecord = {
        id: id('bpost'),
        projectId: input.projectId,
        campaignId,
        contentId: content.id,
        marketingChannel: channel,
        bufferChannelId: bufferChannel.id,
        bufferPostId: created.bufferPostId,
        mode: input.mode,
        status: created.status,
        dueAt: created.dueAt,
        createdAt: new Date().toISOString(),
        idempotencyKey,
        publishAttemptId,
      }

      const publishedStatus = bufferStatusToPublishedStatus(
        created.status,
        input.mode,
      )
      // Never map queue/scheduled/draft to SNS "published"
      const post: PublishedPost = {
        id: id('spost'),
        projectId: input.projectId,
        campaignId,
        contentId: content.id,
        channel,
        remotePostId: created.bufferPostId,
        publishedAt: new Date().toISOString(),
        status: publishedStatus,
        connectorId: 'buffer',
        idempotencyKey,
        publishAttemptId,
      }

      attempt.status = 'succeeded'
      attempt.completedAt = new Date().toISOString()
      attempt.publishedPostId = post.id
      socialSnap.bufferPosts.unshift(record)
      socialSnap.posts.unshift(post)
      await this.socialRepo.save(socialSnap)

      content.status =
        publishedStatus === 'buffer_sent' ? 'published' : 'approved'
      content.updatedAt = new Date().toISOString()
      await this.marketingRepo.save(mSnap)

      if (this.usage) {
        await this.usage
          .recordManual({
            projectId: input.projectId,
            taskId: `buffer_${created.bufferPostId}`,
            provider: 'buffer',
            operation: 'buffer.create-post',
            status: 'completed',
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - t0,
            sourceId: created.bufferPostId,
          })
          .catch(() => undefined)
      }

      return { record, post, attempt, duplicate: false }
    } catch (err) {
      attempt.status = 'failed'
      attempt.completedAt = new Date().toISOString()
      attempt.errorCode = isBufferError(err)
        ? err.category
        : 'BUFFER_UNKNOWN'
      attempt.errorMessage = isBufferError(err)
        ? err.userMessage
        : err instanceof Error
          ? err.message
          : String(err)
      await this.socialRepo.save(socialSnap)

      if (this.usage) {
        await this.usage
          .recordManual({
            projectId: input.projectId,
            taskId: `buffer_fail_${content.id}`,
            provider: 'buffer',
            operation: 'buffer.create-post',
            status: 'failed',
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - t0,
            errorCategory: 'UPSTREAM',
            userMessage: attempt.errorMessage,
            technicalSummary: attempt.errorCode,
            sourceId: `fail_${Date.now().toString(36)}`,
          })
          .catch(() => undefined)
      }
      throw err
    }
  }
}
