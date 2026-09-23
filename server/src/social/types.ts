/**
 * Social Connector Foundation — domain types.
 * No real SNS API / OAuth / credentials in this phase.
 */

export type SocialChannel =
  | 'threads'
  | 'instagram'
  | 'x'
  | 'youtube'
  | 'reddit'
  | 'blog'
  | 'custom'

export type ConnectorStateKind =
  | 'unconfigured'
  | 'configured'
  | 'available'
  | 'degraded'
  | 'disabled'

/** Connector-declared capabilities (platform adapter contract). */
export type ConnectorCapability =
  | 'text.publish'
  | 'image.publish'
  | 'video.publish'
  | 'analytics.read'

export interface ConnectorPolicyMetadata {
  /** Filled from official docs when real connector ships — leave empty now */
  requirements?: string[]
  supportedMedia?: string[]
  supportsAnalytics?: boolean
  supportsScheduling?: boolean
  notes?: string
}

export interface ConnectorState {
  id: string
  channel: SocialChannel
  state: ConnectorStateKind
  label: string
  capabilities: ConnectorCapability[]
  policy: ConnectorPolicyMetadata
  /** Never include tokens / secrets */
  configured: boolean
  available: boolean
  /** Runtime connection details (non-secret) */
  connection?: {
    status:
      | 'unconfigured'
      | 'connecting'
      | 'connected'
      | 'expired'
      | 'error'
      | 'disabled'
    username?: string
    profileId?: string
  }
}

export interface PublishRequest {
  projectId: string
  campaignId: string
  contentId: string
  channel: SocialChannel
  text?: string
  title?: string
  mediaArtifactIds?: string[]
  link?: string
  metadata?: Record<string, unknown>
  /** Agent Deck idempotency — required for duplicate defense */
  idempotencyKey: string
  publishAttemptId: string
}

export type PublishedPostStatus =
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled'
  | 'unknown'
  /** Buffer distribution — not SNS live publish */
  | 'buffer_draft'
  | 'buffer_queued'
  | 'buffer_scheduled'
  | 'buffer_sent'
  | 'buffer_failed'

export interface PublishedPost {
  id: string
  projectId: string
  campaignId: string
  contentId: string
  channel: SocialChannel
  remotePostId: string
  remoteUrl?: string
  publishedAt: string
  status: PublishedPostStatus
  connectorId: string
  idempotencyKey: string
  publishAttemptId: string
}

export type PublishAttemptStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'duplicate'
  | 'unknown'
  | 'reconciliation_required'

export interface PublishAttempt {
  id: string
  projectId: string
  campaignId: string
  contentId: string
  channel: SocialChannel
  idempotencyKey: string
  status: PublishAttemptStatus
  contentHash: string
  approvalHash: string
  errorCode?: string
  errorMessage?: string
  publishedPostId?: string
  createdAt: string
  completedAt?: string
}

export interface PostMetrics {
  publishedPostId: string
  collectedAt: string
  impressions?: number
  views?: number
  likes?: number
  comments?: number
  shares?: number
  clicks?: number
  saves?: number
  /** Platform-native names preserved */
  rawMetrics?: Record<string, number | string | null>
}

export interface AnalyticsSnapshot {
  id: string
  projectId: string
  publishedPostId: string
  campaignId: string
  metrics: PostMetrics
  artifactId?: string
  createdAt: string
}

/** Approval binding — TOCTOU defense */
export interface ContentApprovalToken {
  contentId: string
  contentHash: string
  approvedAt: string
  channel: SocialChannel
  /** Distribution binding — default queue; change requires re-approval */
  publishMode?: 'queue' | 'now' | 'scheduled' | 'draft'
  dueAt?: string | null
  bufferChannelId?: string
}

export interface SocialCredentialHandle {
  connectorId: string
  /** Opaque ref only — never the token itself */
  credentialRef?: string
  expiresAt?: string
}

/**
 * Future OAuth surface — not implemented this phase.
 */
export interface SocialOAuthHooks {
  connect?(): Promise<{ authUrl: string }>
  callback?(_input: { code: string; state?: string }): Promise<void>
  refresh?(): Promise<void>
  disconnect?(): Promise<void>
}

export interface PublishValidationResult {
  ok: boolean
  errors: Array<{ code: string; message: string }>
}

export interface PublishResult {
  remotePostId: string
  remoteUrl?: string
  publishedAt: string
}

export interface SocialConnector extends SocialOAuthHooks {
  id: string
  channel: SocialChannel

  getState(): ConnectorState

  validate(request: PublishRequest): Promise<PublishValidationResult>

  publish(request: PublishRequest): Promise<PublishResult>

  getMetrics?(publishedPost: PublishedPost): Promise<PostMetrics>
}

export interface SocialStoreSnapshot {
  version: 1
  projectId: string
  posts: PublishedPost[]
  attempts: PublishAttempt[]
  analytics: AnalyticsSnapshot[]
  /** Buffer distribution prefs + accepted posts (no API keys) */
  distribution?: import('./buffer/bufferTypes.js').ProjectDistributionPrefs
  bufferPosts?: import('./buffer/bufferTypes.js').BufferPublishedRecord[]
}

export type SocialErrorCategory =
  | 'SOCIAL_NOT_CONFIGURED'
  | 'SOCIAL_NOT_APPROVED'
  | 'SOCIAL_HASH_MISMATCH'
  | 'SOCIAL_DUPLICATE'
  | 'SOCIAL_MEDIA_INVALID'
  | 'SOCIAL_OWNERSHIP'
  | 'SOCIAL_UPSTREAM'
  | 'SOCIAL_INVALID_REQUEST'
  | 'SOCIAL_CANCELLED'
  | 'SOCIAL_UNKNOWN'

export interface SocialError {
  category: SocialErrorCategory
  userMessage: string
  technicalSummary: string
  status: number
  retryable: boolean
  cause?: unknown
}
