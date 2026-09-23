/**
 * Buffer GraphQL distribution types.
 * Buffer is a distribution aggregator — not a SocialChannel enum value.
 */

import type { SocialChannel } from '../types.js'

export type BufferPublishMode = 'queue' | 'now' | 'scheduled' | 'draft'

/** Maps to official ShareMode */
export type BufferShareMode =
  | 'addToQueue'
  | 'shareNow'
  | 'customScheduled'

/** Official PostStatus subset we mirror */
export type BufferPostStatus =
  | 'draft'
  | 'needs_approval'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'error'

export type BufferService =
  | 'threads'
  | 'instagram'
  | 'youtube'
  | 'twitter'
  | 'facebook'
  | 'linkedin'
  | 'tiktok'
  | 'pinterest'
  | 'mastodon'
  | 'bluesky'
  | 'googlebusiness'
  | 'startPage'
  | string

export interface BufferChannelInfo {
  id: string
  name: string
  service: BufferService
  /** Display username / handle when API provides it */
  displayName?: string
  organizationId: string
  available: boolean
}

export interface BufferAccountState {
  configured: boolean
  available: boolean
  label: string
  accountId?: string
  organizations: Array<{ id: string; name?: string }>
  channels: BufferChannelInfo[]
  lastCheckedAt?: string
  errorCategory?: string
}

export interface ProjectBufferChannelMap {
  threadsChannelId?: string
  instagramChannelId?: string
  youtubeChannelId?: string
  /** Extra service → channelId */
  byService?: Record<string, string>
}

export type ProjectDistributionProvider = 'manual' | 'buffer'

export interface ProjectDistributionPrefs {
  provider: ProjectDistributionProvider
  bufferChannels: ProjectBufferChannelMap
}

export interface BufferCreatePostInput {
  channelId: string
  text: string
  mode: BufferPublishMode
  dueAt?: string
  /** Media delivery temporary URLs */
  imageUrls?: string[]
  videoUrls?: string[]
  aiAssisted?: boolean
  saveToDraft?: boolean
}

export interface BufferCreatePostResult {
  bufferPostId: string
  channelId: string
  status: BufferPostStatus
  dueAt?: string | null
  text?: string
}

export interface BufferPublishedRecord {
  id: string
  projectId: string
  campaignId: string
  contentId: string
  /** Agent Deck marketing channel */
  marketingChannel: SocialChannel
  bufferChannelId: string
  bufferPostId: string
  mode: BufferPublishMode
  status: BufferPostStatus
  dueAt?: string | null
  createdAt: string
  idempotencyKey: string
  publishAttemptId: string
}

export type BufferErrorCategory =
  | 'BUFFER_NOT_CONFIGURED'
  | 'BUFFER_AUTH'
  | 'BUFFER_PERMISSION'
  | 'BUFFER_INVALID_CHANNEL'
  | 'BUFFER_INVALID_CONTENT'
  | 'BUFFER_RATE_LIMIT'
  | 'BUFFER_UPSTREAM'
  | 'BUFFER_PUBLISH_UNKNOWN'
  | 'BUFFER_MEDIA_REQUIRED'
  | 'BUFFER_UNKNOWN'

export interface BufferError {
  category: BufferErrorCategory
  userMessage: string
  technicalSummary: string
  status: number
  retryable: boolean
  cause?: unknown
}

/** Injectable GraphQL transport for fixtures */
export type BufferGraphQLFn = (input: {
  query: string
  variables?: Record<string, unknown>
}) => Promise<{
  data?: unknown
  errors?: Array<{ message?: string }>
  httpStatus: number
}>
