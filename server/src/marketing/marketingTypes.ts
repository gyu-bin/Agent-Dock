/** Marketing Operations domain types (server). */

export type MarketingObjective =
  | 'awareness'
  | 'acquisition'
  | 'launch'
  | 'update'
  | 'engagement'
  | 'retention'
  | 'custom'

export type MarketingCampaignStatus =
  | 'researching'
  | 'planning'
  | 'creating'
  | 'reviewing'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'partially_published'
  | 'completed'
  | 'blocked'

export type MarketingChannel =
  | 'threads'
  | 'instagram'
  | 'x'
  | 'reddit'
  | 'youtube'
  | 'blog'
  | 'community'
  | 'custom'

export type ChannelPublishStatus =
  | 'draft'
  | 'ready'
  | 'approved'
  | 'unavailable'
  | 'published'

export type MarketingContentType =
  | 'post'
  | 'thread'
  | 'image_post'
  | 'short_video'
  | 'article'
  | 'community_post'
  | 'update'

export type MarketingContentStatus =
  | 'draft'
  | 'reviewed'
  | 'approved'
  | 'rejected'
  | 'publishing'
  | 'published'
  | 'failed'

/** Bound at human approval — publish requires matching content hash */
export interface ContentApprovalToken {
  contentId: string
  contentHash: string
  approvedAt: string
  channel: MarketingChannel
}

export interface MarketingCreativeBrief {
  format: string
  aspectRatio?: string
  subject: string
  headline?: string
  visualDirection: string
  requiredText?: string
  avoid?: string[]
  /** Never claim image was generated when tool unavailable */
  imageToolStatus: 'unavailable' | 'available' | 'not_needed'
}

export interface MarketingChannelPlan {
  channel: MarketingChannel
  enabled: boolean
  rationale: string
  audienceFit: string
  contentTypes: MarketingContentType[]
  cadence?: string
  risks?: string[]
  requiredCapabilities: string[]
  publishStatus: ChannelPublishStatus
  score?: number
}

export interface MarketingContent {
  id: string
  campaignId: string
  channel: MarketingChannel
  type: MarketingContentType
  title?: string
  body: string
  hashtags?: string[]
  callToAction?: string
  creativeBrief?: MarketingCreativeBrief
  /** Generated image artifacts (versions) */
  creativeArtifactIds?: string[]
  sourceArtifactIds: string[]
  status: MarketingContentStatus
  createdAt: string
  updatedAt: string
}

export interface MarketingPublishPackage {
  campaignId: string
  contentIds: string[]
  channels: MarketingChannel[]
  creativeBriefIds: string[]
  reviewArtifactId?: string
  strategyArtifactId?: string
  researchArtifactId?: string
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'changes_requested'
  /** Set on approve — invalidated when content changes */
  approvalTokens?: ContentApprovalToken[]
  unavailableActions: Array<{
    action: string
    capability: string
    reason: string
  }>
}

export interface MarketingCampaign {
  id: string
  projectId: string
  goalId?: string
  routineId?: string
  routineRunId?: string
  taskId?: string
  title: string
  objective: MarketingObjective
  status: MarketingCampaignStatus
  targetAudience?: string
  positioning?: string
  keyMessages: string[]
  contentPillars: string[]
  channels: MarketingChannelPlan[]
  artifactIds: string[]
  sourceIds: string[]
  contentIds: string[]
  publishPackage?: MarketingPublishPackage
  assignedAgentIds?: string[]
  blockedReason?: string
  previousCampaignIds?: string[]
  stageHint?: string
  createdAt: string
  updatedAt: string
}

export interface MarketingWebSource {
  id: string
  title: string
  url: string
  domain: string
  snippet?: string
}

export interface MarketingStoreSnapshot {
  version: 1
  projectId: string
  campaigns: MarketingCampaign[]
  contents: MarketingContent[]
}

export interface MarketingRepository {
  load(projectId: string): Promise<MarketingStoreSnapshot>
  save(snapshot: MarketingStoreSnapshot): Promise<void>
  listProjectIds(): Promise<string[]>
  deleteProject(projectId: string): Promise<void>
}
