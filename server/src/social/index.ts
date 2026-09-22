export type {
  SocialChannel,
  ConnectorStateKind,
  ConnectorCapability,
  ConnectorPolicyMetadata,
  ConnectorState,
  PublishRequest,
  PublishedPostStatus,
  PublishedPost,
  PublishAttemptStatus,
  PublishAttempt,
  PostMetrics,
  AnalyticsSnapshot,
  ContentApprovalToken,
  SocialCredentialHandle,
  SocialOAuthHooks,
  PublishValidationResult,
  PublishResult,
  SocialConnector,
  SocialStoreSnapshot,
  SocialErrorCategory,
  SocialError,
} from './types.js'

export {
  hashMarketingContent,
  hashMarketingContentAsync,
  collectMediaFingerprints,
  publishIdempotencyKey,
} from './contentHash.js'
export { createSocialError, isSocialError } from './socialErrors.js'
export { validateMediaArtifacts } from './mediaValidation.js'
export { UnconfiguredSocialConnector } from './connectors/unconfiguredConnector.js'
export { FakeSocialConnector } from './connectors/fakeConnector.js'
export {
  SocialConnectorRegistry,
  createDefaultSocialRegistry,
} from './socialConnectorRegistry.js'
export {
  JsonSocialRepository,
  socialRepository,
} from './socialRepository.js'
export {
  SocialPublishService,
  aggregateCampaignStatus,
} from './publishService.js'
export { SocialAnalyticsService } from './analyticsService.js'
export {
  ThreadsConnector,
  ThreadsOAuthService,
  getThreadsAppConfig,
  THREADS_SCOPES,
  THREADS_ACCOUNT_KEY,
  extractDeliveredImageUrls,
} from './threads/index.js'
