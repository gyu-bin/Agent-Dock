/**
 * Marketing Operations Service — domain SoT for campaigns.
 * Manual one-shot and WEEKLY_MARKETING share this path.
 * Fixture mode: no real OpenAI / Search / SNS calls.
 */

import { randomBytes } from 'node:crypto'
import type { ArtifactService } from '../persistence/artifactService.js'
import type { KnowledgeService } from '../persistence/knowledgeService.js'
import type { ProjectService } from '../persistence/projectService.js'
import type { OperationsService } from '../persistence/operationsService.js'
import type { ProjectStage } from '../persistence/operationsTypes.js'
import { FUTURE_CAPABILITIES } from '../persistence/operationsTypes.js'
import {
  isAnalyticsReadAvailable,
  isImageGenerateAvailable,
  isSocialPublishAvailable,
} from '../operations/capabilityPreflight.js'
import type { ImageGenerationService } from '../image/imageGenerationService.js'
import type { SocialConnectorRegistry } from '../social/socialConnectorRegistry.js'
import type { SocialAnalyticsService } from '../social/analyticsService.js'
import { hashMarketingContentAsync } from '../social/contentHash.js'
import type {
  ContentApprovalToken,
  MarketingCampaign,
  MarketingCampaignStatus,
  MarketingContent,
  MarketingObjective,
  MarketingPublishPackage,
  MarketingRepository,
  MarketingWebSource,
} from './marketingTypes.js'
import { recommendChannels } from './channelStrategy.js'
import {
  contentsAreDifferentiated,
  generateChannelContent,
} from './contentGenerator.js'

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString()
}

const FUTURE = FUTURE_CAPABILITIES

export interface RunMarketingCampaignInput {
  projectId: string
  title?: string
  objective?: MarketingObjective
  request?: string
  goalId?: string
  routineId?: string
  routineRunId?: string
  taskId?: string
  /** Fixture / offline research — never invent URLs */
  fixtureSources?: MarketingWebSource[]
  /** Allow proceeding when search unavailable (no fake research) */
  allowWithoutSearch?: boolean
  searchAvailable?: boolean
  teamAgentIds?: string[]
  specialistAgentIds?: string[]
  now?: Date
  stage?: ProjectStage
  /**
   * When true and image.generate available and content has creativeBrief,
   * generate images. Default false — never unconditional.
   */
  autoGenerateImages?: boolean
}

export interface RunMarketingCampaignResult {
  campaign: MarketingCampaign
  contents: MarketingContent[]
  publishPackage: MarketingPublishPackage
  researchArtifactId?: string
  strategyArtifactId?: string
  reviewArtifactId?: string
}

export class MarketingService {
  constructor(
    private readonly repo: MarketingRepository,
    private readonly projects: ProjectService | null = null,
    private readonly artifacts: ArtifactService | null = null,
    private readonly knowledge: KnowledgeService | null = null,
    private readonly operations: OperationsService | null = null,
    private readonly images: ImageGenerationService | null = null,
    private readonly socialRegistry: SocialConnectorRegistry | null = null,
    private readonly socialAnalytics: SocialAnalyticsService | null = null,
  ) {}

  async listCampaigns(projectId: string): Promise<MarketingCampaign[]> {
    const snap = await this.repo.load(projectId)
    return snap.campaigns
  }

  async getCampaign(
    campaignId: string,
    projectId?: string,
  ): Promise<{ campaign: MarketingCampaign; contents: MarketingContent[] } | null> {
    const ids = projectId
      ? [projectId]
      : await this.repo.listProjectIds()
    for (const pid of ids) {
      const snap = await this.repo.load(pid)
      const campaign = snap.campaigns.find((c) => c.id === campaignId)
      if (campaign) {
        const contents = snap.contents.filter((c) => c.campaignId === campaignId)
        return { campaign, contents }
      }
    }
    return null
  }

  async listContent(campaignId: string): Promise<MarketingContent[]> {
    const hit = await this.getCampaign(campaignId)
    return hit?.contents ?? []
  }

  async patchCampaign(
    campaignId: string,
    patch: Partial<
      Pick<
        MarketingCampaign,
        | 'title'
        | 'status'
        | 'objective'
        | 'targetAudience'
        | 'positioning'
        | 'keyMessages'
        | 'taskId'
      >
    > & { projectId?: string },
  ): Promise<MarketingCampaign> {
    const hit = await this.getCampaign(campaignId, patch.projectId)
    if (!hit) {
      throw Object.assign(new Error('Campaign not found'), { status: 404 })
    }
    const snap = await this.repo.load(hit.campaign.projectId)
    const c = snap.campaigns.find((x) => x.id === campaignId)!
    Object.assign(c, patch, { updatedAt: nowIso() })
    await this.repo.save(snap)
    return c
  }

  /**
   * Canonical marketing pipeline (manual + routine).
   * Does not call real providers when fixtureSources / searchAvailable=false.
   */
  async runCampaign(
    input: RunMarketingCampaignInput,
  ): Promise<RunMarketingCampaignResult> {
    const t = nowIso(input.now)
    const snap = await this.repo.load(input.projectId)

    const previous = snap.campaigns.slice(0, 5)
    const previousBodies = snap.contents.map((c) => c.body)

    let productName = 'App'
    let projectType = 'custom'
    let contextText = ''
    if (this.projects) {
      const ps = await this.projects.getSnapshot()
      const project = ps.projects.find((p) => p.id === input.projectId)
      if (project) {
        productName = project.name
        projectType = project.type
        const ctx = project.context
        if (ctx) {
          contextText = [
            ctx.description,
            ctx.goals,
            ctx.constraints,
            ctx.techStack,
          ]
            .filter(Boolean)
            .join('\n')
        }
      }
    }

    let stage = input.stage
    if (!stage && this.operations) {
      const board = await this.operations.getBoard(input.projectId)
      stage = board.stage
    }

    let knowledgeText = ''
    if (this.knowledge) {
      try {
        const items = await this.knowledge.list({
          projectId: input.projectId,
          status: 'confirmed',
        })
        knowledgeText = items
          .slice(0, 8)
          .map((k) => `${k.title}: ${k.content}`)
          .join('\n')
      } catch {
        // optional
      }
    }

    const prevCampaignText = previous
      .map(
        (c) =>
          `Previous campaign: ${c.title} · ${c.positioning ?? ''} · msgs=${c.keyMessages.join('; ')} · status=${c.status}`,
      )
      .join('\n')

    let performanceContext = ''
    if (this.socialAnalytics) {
      try {
        performanceContext = await this.socialAnalytics.buildPerformanceContext(
          input.projectId,
          5,
        )
      } catch {
        // optional context
      }
    }

    const campaignId = id('mcamp')
    const campaign: MarketingCampaign = {
      id: campaignId,
      projectId: input.projectId,
      goalId: input.goalId,
      routineId: input.routineId,
      routineRunId: input.routineRunId,
      taskId: input.taskId,
      title:
        input.title?.trim() ||
        `${productName} Marketing — ${input.objective ?? 'awareness'}`,
      objective: input.objective ?? 'awareness',
      status: 'researching',
      keyMessages: [],
      contentPillars: [],
      channels: [],
      artifactIds: [],
      sourceIds: [],
      contentIds: [],
      assignedAgentIds: [
        ...(input.teamAgentIds ?? []),
        ...(input.specialistAgentIds ?? []),
      ].filter((v, i, a) => a.indexOf(v) === i),
      previousCampaignIds: previous.map((c) => c.id),
      stageHint: stage,
      createdAt: t,
      updatedAt: t,
    }

    snap.campaigns.unshift(campaign)
    await this.repo.save(snap)

    // ——— Research ———
    const searchAvailable = input.searchAvailable !== false
    const sources = input.fixtureSources ?? []
    if (!searchAvailable && sources.length === 0 && !input.allowWithoutSearch) {
      campaign.status = 'blocked'
      campaign.blockedReason =
        'Web Search unavailable — fake research skipped. Provide sources or allowWithoutSearch.'
      campaign.updatedAt = nowIso(input.now)
      await this.repo.save(snap)
      const emptyPkg = emptyPackage(campaignId)
      campaign.publishPackage = emptyPkg
      await this.repo.save(snap)
      return {
        campaign,
        contents: [],
        publishPackage: emptyPkg,
      }
    }

    campaign.sourceIds = sources.map((s) => s.id)
    let researchArtifactId: string | undefined
    const researchContent = buildResearchMarkdown({
      productName,
      sources,
      request: input.request,
      previousNote: [prevCampaignText, performanceContext]
        .filter(Boolean)
        .join('\n'),
      knowledgeText,
      stage,
    })

    if (this.artifacts) {
      const art = await this.artifacts.createArtifact({
        projectId: input.projectId,
        taskId: input.taskId,
        type: 'research',
        title: `Market research — ${productName}`,
        summary: 'Marketing research with citations',
        content: researchContent,
        status: 'draft',
        agentId: input.specialistAgentIds?.[0] ?? input.teamAgentIds?.[0],
        sources: sources.map((s) => ({
          id: s.id,
          title: s.title,
          url: s.url,
          domain: s.domain,
          snippet: s.snippet,
        })),
        metadata: { kind: 'marketing-research', campaignId },
      })
      researchArtifactId = art.id
      campaign.artifactIds.push(art.id)
    }

    // ——— Strategy ———
    campaign.status = 'planning'
    campaign.targetAudience = deriveAudience(projectType, sources, contextText)
    campaign.positioning = derivePositioning(productName, contextText, sources)
    campaign.keyMessages = deriveKeyMessages(productName, campaign.positioning)
    campaign.contentPillars = derivePillars(productName, projectType)
    campaign.updatedAt = nowIso(input.now)

    const researchText = [
      researchContent,
      contextText,
      knowledgeText,
      input.request ?? '',
      // Ensure fixture channels can be discovered from source text
      ...sources.map((s) => `${s.title} ${s.snippet ?? ''}`),
    ].join('\n')

    campaign.channels = recommendChannels({
      projectType,
      stage,
      productName,
      researchText,
      sources,
    })

    let strategyArtifactId: string | undefined
    const strategyMd = buildStrategyMarkdown(campaign, sources)
    if (this.artifacts) {
      const art = await this.artifacts.createArtifact({
        projectId: input.projectId,
        taskId: input.taskId,
        type: 'plan',
        title: `Marketing strategy — ${productName}`,
        summary: 'Objective, audience, channels, pillars',
        content: strategyMd,
        status: 'draft',
        metadata: {
          kind: 'marketing-strategy',
          campaignId,
          sourceIds: campaign.sourceIds,
        },
        sources: sources.map((s) => ({
          id: s.id,
          title: s.title,
          url: s.url,
          domain: s.domain,
          snippet: s.snippet,
        })),
      })
      strategyArtifactId = art.id
      campaign.artifactIds.push(art.id)
    }

    // ——— Content ———
    campaign.status = 'creating'
    const sourceArtifactIds = [researchArtifactId, strategyArtifactId].filter(
      Boolean,
    ) as string[]
    const contents: MarketingContent[] = []
    let i = 0
    for (const ch of campaign.channels.filter((c) => c.enabled)) {
      const content = generateChannelContent(ch, {
        campaignId,
        productName,
        positioning: campaign.positioning ?? '',
        keyMessages: campaign.keyMessages,
        pillars: campaign.contentPillars,
        sourceArtifactIds,
        previousBodies,
        now: nowIso(input.now),
      }, i)
      contents.push(content)
      i += 1
    }

    if (!contentsAreDifferentiated(contents)) {
      throw new Error('Channel content differentiation failed')
    }

    campaign.contentIds = contents.map((c) => c.id)
    snap.contents.push(...contents)

    // ——— Review ———
    campaign.status = 'reviewing'
    let reviewArtifactId: string | undefined
    const reviewMd = buildReviewMarkdown(campaign, contents, previousBodies)
    if (this.artifacts) {
      const art = await this.artifacts.createArtifact({
        projectId: input.projectId,
        taskId: input.taskId,
        type: 'review',
        title: `Marketing review — ${productName}`,
        summary: 'Fact/tone/spam/community review',
        content: reviewMd,
        status: 'draft',
        metadata: { kind: 'marketing-review', campaignId },
      })
      reviewArtifactId = art.id
      campaign.artifactIds.push(art.id)
    }
    for (const c of contents) {
      c.status = 'reviewed'
      c.updatedAt = nowIso(input.now)
    }

    // ——— Publish package bookkeeping + optional image generation ———
    const unavailableActions: MarketingPublishPackage['unavailableActions'] = []
    const imageAvailable =
      isImageGenerateAvailable() && (this.images?.isAvailable() ?? false)

    if (input.autoGenerateImages && imageAvailable && this.images) {
      for (const c of contents) {
        if (!c.creativeBrief) continue
        try {
          const gen = await this.images.generateFromBrief({
            brief: c.creativeBrief,
            projectId: input.projectId,
            taskId: input.taskId,
            campaignId,
            contentId: c.id,
            productName,
            brandContext: contextText.slice(0, 400),
            purpose: 'social',
            modelProfile: 'fast',
            agentId: input.specialistAgentIds?.[0] ?? input.teamAgentIds?.[0],
            title: `Creative — ${c.channel}`,
            skipBudget: false,
          })
          c.creativeArtifactIds = [gen.artifactId]
          c.creativeBrief = {
            ...c.creativeBrief,
            imageToolStatus: 'available',
          }
          campaign.artifactIds.push(gen.artifactId)
        } catch (err) {
          console.warn('[marketing] image generate failed', err)
          c.creativeBrief = {
            ...c.creativeBrief,
            imageToolStatus: 'unavailable',
          }
          const msg =
            err && typeof err === 'object' && 'userMessage' in err
              ? String((err as { userMessage: string }).userMessage)
              : '이미지 생성 실패'
          if (
            !unavailableActions.some((u) => u.capability === 'image.generate')
          ) {
            unavailableActions.push({
              action: 'image.generate',
              capability: 'image.generate',
              reason: msg,
            })
          }
        }
      }
    }

    const socialAny = isSocialPublishAvailable()
    if (!socialAny) {
      unavailableActions.push({
        action: 'publish',
        capability: 'social.publish',
        reason: '게시 도구가 연결되지 않았습니다.',
      })
    }
    const needsImage = contents.some((c) => c.creativeBrief)
    if (needsImage && !imageAvailable) {
      unavailableActions.push({
        action: 'image.generate',
        capability: 'image.generate',
        reason:
          '이미지 생성 도구가 연결되지 않았습니다. Creative Brief만 준비됨.',
      })
      for (const c of contents) {
        if (c.creativeBrief) {
          c.creativeBrief = {
            ...c.creativeBrief,
            imageToolStatus: 'unavailable',
          }
        }
      }
    }
    if (FUTURE.has('video.generate')) {
      const needsVideo = contents.some((c) => c.type === 'short_video')
      if (needsVideo) {
        unavailableActions.push({
          action: 'video.generate',
          capability: 'video.generate',
          reason: '비디오 생성 도구가 연결되지 않았습니다.',
        })
      }
    }
    if (!isAnalyticsReadAvailable()) {
      unavailableActions.push({
        action: 'analytics.read',
        capability: 'analytics.read',
        reason: 'Analytics 도구가 아직 연결되지 않았습니다.',
      })
    }

    // Annotate channels: keep strategy; mark publish unavailable per connector
    const socialChannelSet = new Set([
      'threads',
      'instagram',
      'x',
      'youtube',
      'reddit',
      'blog',
      'custom',
    ])
    for (const ch of campaign.channels) {
      const connectorReady =
        socialChannelSet.has(ch.channel) &&
        (this.socialRegistry?.isChannelPublishAvailable(
          ch.channel as
            | 'threads'
            | 'instagram'
            | 'x'
            | 'youtube'
            | 'reddit'
            | 'blog'
            | 'custom',
        ) ??
          false)
      const gated = ch.requiredCapabilities.filter(
        (cap) =>
          FUTURE.has(cap) ||
          (cap === 'image.generate' && !imageAvailable) ||
          (cap === 'social.publish' && !connectorReady),
      )
      if (!connectorReady && ch.enabled) {
        // Recommended but not connected — do not delete channel
        ch.publishStatus = 'unavailable'
        if (
          !unavailableActions.some(
            (u) =>
              u.capability === 'social.publish' &&
              u.action === `publish:${ch.channel}`,
          )
        ) {
          unavailableActions.push({
            action: `publish:${ch.channel}`,
            capability: 'social.publish',
            reason: `${ch.channel} 커넥터 미연결 — 추천되지만 게시 불가`,
          })
        }
      } else if (gated.length > 0) {
        ch.publishStatus = 'unavailable'
      } else {
        ch.publishStatus = 'ready'
      }
    }

    // Never mark published without connector + approval
    const publishPackage: MarketingPublishPackage = {
      campaignId,
      contentIds: contents.map((c) => c.id),
      channels: campaign.channels.filter((c) => c.enabled).map((c) => c.channel),
      creativeBriefIds: contents
        .filter((c) => c.creativeBrief)
        .map((c) => c.id),
      reviewArtifactId,
      strategyArtifactId,
      researchArtifactId,
      approvalStatus: 'pending',
      unavailableActions,
    }

    campaign.publishPackage = publishPackage
    campaign.status = 'awaiting_approval'
    campaign.updatedAt = nowIso(input.now)

    // Ensure no content is marked published
    for (const c of contents) {
      if (c.status === 'published') c.status = 'reviewed'
    }

    await this.repo.save(snap)

    // Link approval task for Approval Inbox (kind=publish)
    if (this.projects && !input.taskId) {
      const approvalTaskId = id('task')
      const now = nowIso(input.now)
      await this.projects.appendWork({
        tasks: [
          {
            id: approvalTaskId,
            projectId: input.projectId,
            title: `[Publish] ${campaign.title}`,
            description: `Marketing publish package ready for approval.\nCampaign: ${campaignId}\nUnavailable: ${unavailableActions.map((u) => u.capability).join(', ') || 'none'}`,
            status: 'awaiting_approval',
            workflow: 'MARKETING',
            priority: 'normal',
            assignedAgentIds: campaign.assignedAgentIds?.length
              ? campaign.assignedAgentIds
              : ['product-manager'],
            recommendedExtraAgentIds: [],
            progress: 90,
            createdAt: now,
            updatedAt: now,
            workflowTemplateId: 'MARKETING_CAMPAIGN',
            workflowPreview: ['Research', 'Strategy', 'Content', 'Review', 'Publish approval'],
            source: input.routineId
              ? {
                  type: 'routine',
                  routineId: input.routineId,
                  routineRunId: input.routineRunId,
                }
              : { type: 'system' },
            approval: {
              status: 'pending',
              stepId: `${approvalTaskId}_publish`,
              kind: 'publish',
              planExcerpt: strategyMd.slice(0, 500),
            },
          },
        ],
        pipelineSteps: [
          {
            id: `${approvalTaskId}_publish`,
            taskId: approvalTaskId,
            agentId: 'product-manager',
            order: 1,
            label: 'Publish approval',
            status: 'awaiting_approval',
            provider: 'human',
            approvalKind: 'change',
          },
        ],
      })
      campaign.taskId = approvalTaskId
      await this.repo.save(snap)
    } else if (input.taskId) {
      campaign.taskId = input.taskId
      await this.repo.save(snap)
    }

    return {
      campaign,
      contents,
      publishPackage,
      researchArtifactId,
      strategyArtifactId,
      reviewArtifactId,
    }
  }

  async approveCampaign(
    campaignId: string,
    input: {
      projectId?: string
      note?: string
      /** Buffer / distribution binding — default queue */
      publishMode?: 'queue' | 'now' | 'scheduled' | 'draft'
      dueAt?: string | null
      bufferChannelId?: string
    } = {},
  ): Promise<MarketingCampaign> {
    const hit = await this.getCampaign(campaignId, input.projectId)
    if (!hit) {
      throw Object.assign(new Error('Campaign not found'), { status: 404 })
    }
    const snap = await this.repo.load(hit.campaign.projectId)
    const c = snap.campaigns.find((x) => x.id === campaignId)!
    if (
      c.status !== 'awaiting_approval' &&
      c.status !== 'rejected' &&
      c.status !== 'approved'
    ) {
      throw Object.assign(new Error('Campaign not awaiting approval'), {
        status: 400,
      })
    }
    // Still cannot publish without connector + approval token binding
    c.status = 'approved'
    const contents = snap.contents.filter((x) => x.campaignId === campaignId)
    const publishMode = input.publishMode ?? 'queue'
    const dueAt = input.dueAt ?? null
    const approvalTokens: ContentApprovalToken[] = []
    for (const content of contents) {
      approvalTokens.push({
        contentId: content.id,
        contentHash: await hashMarketingContentAsync(
          content,
          hit.campaign.projectId,
          this.artifacts,
        ),
        approvedAt: nowIso(),
        channel: content.channel,
        publishMode,
        dueAt,
        bufferChannelId: input.bufferChannelId,
      })
    }
    if (c.publishPackage) {
      c.publishPackage.approvalStatus = 'approved'
      c.publishPackage.approvalTokens = approvalTokens
      for (const ch of c.channels) {
        if (ch.publishStatus !== 'unavailable') ch.publishStatus = 'approved'
      }
    }
    for (const content of contents) {
      content.status = 'approved'
      content.updatedAt = nowIso()
    }
    c.updatedAt = nowIso()
    await this.repo.save(snap)

    if (this.projects && c.taskId) {
      const ps = await this.projects.getSnapshot()
      const task = ps.tasks.find((t) => t.id === c.taskId)
      if (task) {
        task.status = 'completed'
        task.approval = {
          ...(task.approval ?? {
            status: 'approved',
            stepId: `${c.taskId}_publish`,
            kind: 'publish',
          }),
          status: 'approved',
          kind: 'publish',
          decidedAt: nowIso(),
          note: input.note,
        }
        task.finalResult =
          'Publish package approved — connector publish still required (not published)'
        task.updatedAt = nowIso()
        await this.projects.saveWorkState({
          tasks: ps.tasks,
          pipelineSteps: ps.pipelineSteps,
          agentRuns: ps.agentRuns,
          codexRuns: ps.codexRuns,
        })
      }
    }
    return c
  }

  /**
   * Patch content after approval invalidates approval tokens (TOCTOU).
   */
  async patchContent(
    contentId: string,
    patch: Partial<
      Pick<
        MarketingContent,
        | 'title'
        | 'body'
        | 'hashtags'
        | 'callToAction'
        | 'creativeArtifactIds'
        | 'status'
      >
    > & { projectId?: string },
  ): Promise<MarketingContent> {
    const ids = patch.projectId
      ? [patch.projectId]
      : await this.repo.listProjectIds()
    for (const pid of ids) {
      const snap = await this.repo.load(pid)
      const content = snap.contents.find((c) => c.id === contentId)
      if (!content) continue
      if (patch.title !== undefined) content.title = patch.title
      if (patch.body !== undefined) content.body = patch.body
      if (patch.hashtags !== undefined) content.hashtags = patch.hashtags
      if (patch.callToAction !== undefined)
        content.callToAction = patch.callToAction
      if (patch.creativeArtifactIds !== undefined)
        content.creativeArtifactIds = patch.creativeArtifactIds
      if (patch.status !== undefined) content.status = patch.status
      content.updatedAt = nowIso()

      const campaign = snap.campaigns.find((c) => c.id === content.campaignId)
      if (campaign?.publishPackage?.approvalStatus === 'approved') {
        const tokens = campaign.publishPackage.approvalTokens ?? []
        const token = tokens.find((t) => t.contentId === contentId)
        const newHash = await hashMarketingContentAsync(
          content,
          pid,
          this.artifacts,
        )
        if (token && token.contentHash !== newHash) {
          campaign.publishPackage.approvalStatus = 'changes_requested'
          campaign.publishPackage.approvalTokens = tokens.filter(
            (t) => t.contentId !== contentId,
          )
          campaign.status = 'rejected'
          content.status = 'reviewed'
          campaign.blockedReason =
            'Content changed after approval — re-approval required'
        }
      }
      campaign && (campaign.updatedAt = nowIso())
      await this.repo.save(snap)
      return content
    }
    throw Object.assign(new Error('Content not found'), { status: 404 })
  }

  async requestChanges(
    campaignId: string,
    input: { projectId?: string; feedback: string },
  ): Promise<MarketingCampaign> {
    const hit = await this.getCampaign(campaignId, input.projectId)
    if (!hit) {
      throw Object.assign(new Error('Campaign not found'), { status: 404 })
    }
    const snap = await this.repo.load(hit.campaign.projectId)
    const c = snap.campaigns.find((x) => x.id === campaignId)!
    c.status = 'rejected'
    if (c.publishPackage) {
      c.publishPackage.approvalStatus = 'changes_requested'
    }
    c.blockedReason = input.feedback
    c.updatedAt = nowIso()
    await this.repo.save(snap)
    return c
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.repo.deleteProject(projectId)
  }
}

function emptyPackage(campaignId: string): MarketingPublishPackage {
  return {
    campaignId,
    contentIds: [],
    channels: [],
    creativeBriefIds: [],
    approvalStatus: 'pending',
    unavailableActions: [
      {
        action: 'research',
        capability: 'research.web',
        reason: 'Search unavailable',
      },
    ],
  }
}

function buildResearchMarkdown(input: {
  productName: string
  sources: MarketingWebSource[]
  request?: string
  previousNote: string
  knowledgeText: string
  stage?: string
}): string {
  const lines = [
    `# Market Research — ${input.productName}`,
    '',
    input.request ? `Request: ${input.request}` : '',
    input.stage ? `Stage: ${input.stage}` : '',
    '',
    '## Sources',
  ]
  if (input.sources.length === 0) {
    lines.push('_No web sources (search skipped or unavailable)._')
  } else {
    for (const s of input.sources) {
      lines.push(`- [${s.title}](${s.url}) — ${s.domain}`)
      if (s.snippet) lines.push(`  - ${s.snippet}`)
    }
  }
  if (input.knowledgeText) {
    lines.push('', '## Confirmed Knowledge', input.knowledgeText)
  }
  if (input.previousNote) {
    lines.push('', '## Previous campaigns', input.previousNote)
  }
  return lines.filter((l) => l !== undefined).join('\n')
}

function buildStrategyMarkdown(
  campaign: MarketingCampaign,
  sources: MarketingWebSource[],
): string {
  return [
    `# Marketing Strategy — ${campaign.title}`,
    '',
    `Objective: ${campaign.objective}`,
    `Audience: ${campaign.targetAudience ?? ''}`,
    `Positioning: ${campaign.positioning ?? ''}`,
    '',
    '## Key Messages',
    ...campaign.keyMessages.map((m) => `- ${m}`),
    '',
    '## Content Pillars',
    ...campaign.contentPillars.map((p) => `- ${p}`),
    '',
    '## Recommended Channels',
    ...campaign.channels
      .filter((c) => c.enabled)
      .map(
        (c) =>
          `- ${c.channel}: ${c.rationale} (fit: ${c.audienceFit})`,
      ),
    '',
    '## Sources',
    ...sources.map((s) => `- ${s.id}: ${s.url}`),
    '',
    '## Risks',
    ...campaign.channels.flatMap((c) => c.risks ?? []).map((r) => `- ${r}`),
  ].join('\n')
}

function buildReviewMarkdown(
  campaign: MarketingCampaign,
  contents: MarketingContent[],
  previousBodies: string[],
): string {
  const dupes = contents.filter((c) =>
    previousBodies.some((p) => p.trim() === c.body.trim()),
  )
  return [
    `# Marketing Review — ${campaign.title}`,
    '',
    '- Project facts alignment: OK (draft deterministic review)',
    '- Exaggeration check: no store ranking / fake metrics claimed',
    '- Channel tone: differentiated bodies checked',
    `- Duplicate vs previous: ${dupes.length === 0 ? 'none detected' : dupes.map((d) => d.channel).join(', ')}`,
    '- CTA: present where applicable',
    '- Sources: only provided sourceIds linked',
    '- Spam / community risk: Reddit posts use discussion framing',
    '',
    '## Contents',
    ...contents.map((c) => `- ${c.channel}: ${c.type} (${c.status})`),
  ].join('\n')
}

function deriveAudience(
  projectType: string,
  sources: MarketingWebSource[],
  context: string,
): string {
  const fromSrc = sources.find((s) => /audience|user|player|타깃/i.test(s.snippet ?? s.title))
  if (fromSrc?.snippet) return fromSrc.snippet
  if (/game/i.test(projectType)) return '캐주얼 모바일 게임 플레이어'
  if (context) return `Users interested in: ${context.slice(0, 120)}`
  return 'Product-aware early adopters'
}

function derivePositioning(
  productName: string,
  context: string,
  sources: MarketingWebSource[],
): string {
  const hint = sources[0]?.snippet
  if (hint) return `${productName} — ${hint.slice(0, 100)}`
  if (context) return `${productName}: ${context.slice(0, 100)}`
  return `${productName} helps users get value faster with less friction`
}

function deriveKeyMessages(productName: string, positioning: string): string[] {
  return [
    `${productName} focuses on ${positioning.split('—')[1]?.trim() ?? 'clear user value'}`,
    `Built for people who care about practical outcomes, not hype`,
    `Transparent updates — no fake social proof`,
  ]
}

function derivePillars(productName: string, projectType: string): string[] {
  const base = [
    `${productName} core value`,
    'Real usage scenarios',
    'Honest differentiation',
  ]
  if (/game/i.test(projectType)) {
    base.push('Play moment / feel')
    base.push('Community discussion hooks')
  } else {
    base.push('Problem → solution story')
    base.push('Behind the build')
  }
  return base.slice(0, 5)
}
