/**
 * Analytics collection → PostMetrics → marketing-performance Artifact.
 * Missing platform metrics stay undefined — never fake as 0.
 */

import type { ArtifactService } from '../persistence/artifactService.js'
import { createSocialError } from './socialErrors.js'
import type { SocialConnectorRegistry } from './socialConnectorRegistry.js'
import type { JsonSocialRepository } from './socialRepository.js'
import type { AnalyticsSnapshot, PostMetrics, PublishedPost } from './types.js'
import { randomBytes } from 'node:crypto'

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

export class SocialAnalyticsService {
  constructor(
    private readonly registry: SocialConnectorRegistry,
    private readonly socialRepo: JsonSocialRepository,
    private readonly artifacts: ArtifactService | null = null,
  ) {}

  async collectMetrics(input: {
    projectId: string
    publishedPostId: string
  }): Promise<{ metrics: PostMetrics; snapshot: AnalyticsSnapshot; artifactId?: string }> {
    const snap = await this.socialRepo.load(input.projectId)
    const post = snap.posts.find((p) => p.id === input.publishedPostId)
    if (!post || post.projectId !== input.projectId) {
      throw createSocialError({
        category: 'SOCIAL_INVALID_REQUEST',
        userMessage: '게시글을 찾을 수 없습니다.',
        technicalSummary: 'post not found or isolation',
        status: 404,
      })
    }
    if (post.status !== 'published') {
      throw createSocialError({
        category: 'SOCIAL_INVALID_REQUEST',
        userMessage: '게시 완료된 글만 지표를 수집할 수 있습니다.',
        technicalSummary: `status=${post.status}`,
      })
    }

    const connector = this.registry.getConnector(post.channel)
    if (!connector.getMetrics) {
      throw createSocialError({
        category: 'SOCIAL_NOT_CONFIGURED',
        userMessage: '이 채널은 Analytics를 지원하지 않습니다.',
        technicalSummary: 'getMetrics not implemented',
      })
    }
    const state = connector.getState()
    if (!state.available || !state.capabilities.includes('analytics.read')) {
      throw createSocialError({
        category: 'SOCIAL_NOT_CONFIGURED',
        userMessage: 'Analytics 커넥터가 연결되지 않았습니다.',
        technicalSummary: 'analytics unavailable',
      })
    }

    const metrics = await connector.getMetrics(post)
    // Normalize: do not coerce missing to 0
    const normalized = normalizeMetrics(metrics, post)

    let artifactId: string | undefined
    if (this.artifacts) {
      const art = await this.artifacts.createArtifact({
        projectId: input.projectId,
        type: 'marketing-performance',
        title: `Performance — ${post.channel} ${post.remotePostId}`,
        summary: summarizeMetrics(normalized),
        contentType: 'json',
        content: JSON.stringify(
          {
            publishedPostId: post.id,
            campaignId: post.campaignId,
            contentId: post.contentId,
            channel: post.channel,
            remotePostId: post.remotePostId,
            metrics: normalized,
          },
          null,
          2,
        ),
        status: 'final',
        metadata: {
          kind: 'marketing-performance',
          campaignId: post.campaignId,
          publishedPostId: post.id,
          channel: post.channel,
        },
      })
      artifactId = art.id
    }

    const snapshot: AnalyticsSnapshot = {
      id: id('asnap'),
      projectId: input.projectId,
      publishedPostId: post.id,
      campaignId: post.campaignId,
      metrics: normalized,
      artifactId,
      createdAt: new Date().toISOString(),
    }
    snap.analytics.unshift(snapshot)
    await this.socialRepo.save(snap)

    return { metrics: normalized, snapshot, artifactId }
  }

  async getLatestMetrics(
    projectId: string,
    publishedPostId: string,
  ): Promise<PostMetrics | null> {
    const snap = await this.socialRepo.load(projectId)
    const hit = snap.analytics.find((a) => a.publishedPostId === publishedPostId)
    return hit?.metrics ?? null
  }

  /** Context snippets for next campaign — no extra AI call */
  async buildPerformanceContext(
    projectId: string,
    limit = 5,
  ): Promise<string> {
    const snap = await this.socialRepo.load(projectId)
    const lines: string[] = []
    for (const a of snap.analytics.slice(0, limit)) {
      const m = a.metrics
      lines.push(
        [
          `Previous performance (${a.campaignId} / ${a.publishedPostId}):`,
          m.impressions != null ? `impressions=${m.impressions}` : null,
          m.likes != null ? `likes=${m.likes}` : null,
          m.comments != null ? `comments=${m.comments}` : null,
          m.shares != null ? `shares=${m.shares}` : null,
          m.views != null ? `views=${m.views}` : null,
        ]
          .filter(Boolean)
          .join(' '),
      )
    }
    return lines.join('\n')
  }
}

function normalizeMetrics(
  metrics: PostMetrics,
  post: PublishedPost,
): PostMetrics {
  return {
    publishedPostId: post.id,
    collectedAt: metrics.collectedAt || new Date().toISOString(),
    impressions: metrics.impressions,
    views: metrics.views,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    clicks: metrics.clicks,
    saves: metrics.saves,
    rawMetrics: metrics.rawMetrics,
  }
}

function summarizeMetrics(m: PostMetrics): string {
  const parts = [
    m.impressions != null ? `imp ${m.impressions}` : null,
    m.likes != null ? `likes ${m.likes}` : null,
    m.comments != null ? `comments ${m.comments}` : null,
  ].filter(Boolean)
  return parts.join(' · ') || 'performance snapshot'
}
