/**
 * Marketing Operations — client types (mirror server).
 */

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

export interface MarketingChannelPlan {
  channel: MarketingChannel
  enabled: boolean
  rationale: string
  audienceFit: string
  contentTypes: string[]
  publishStatus: string
  requiredCapabilities: string[]
}

export interface MarketingCreativeBrief {
  format: string
  aspectRatio?: string
  subject: string
  headline?: string
  visualDirection: string
  requiredText?: string
  avoid?: string[]
  imageToolStatus: 'unavailable' | 'available' | 'not_needed'
}

export interface MarketingContent {
  id: string
  campaignId: string
  channel: MarketingChannel
  type: string
  title?: string
  body: string
  hashtags?: string[]
  callToAction?: string
  creativeBrief?: MarketingCreativeBrief
  creativeArtifactIds?: string[]
  sourceArtifactIds: string[]
  status: string
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
  approvalStatus: string
  approvalTokens?: Array<{
    contentId: string
    contentHash: string
    approvedAt: string
    channel: MarketingChannel
  }>
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
  createdAt: string
  updatedAt: string
}
