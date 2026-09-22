export type {
  MarketingObjective,
  MarketingCampaignStatus,
  MarketingChannel,
  ChannelPublishStatus,
  MarketingContentType,
  MarketingContentStatus,
  MarketingCreativeBrief,
  MarketingChannelPlan,
  MarketingContent,
  MarketingPublishPackage,
  MarketingCampaign,
  MarketingWebSource,
  MarketingStoreSnapshot,
  MarketingRepository,
  ContentApprovalToken,
} from './marketingTypes.js'

export { JsonMarketingRepository, marketingRepository } from './marketingRepository.js'
export { MarketingService } from './marketingService.js'
export type {
  RunMarketingCampaignInput,
  RunMarketingCampaignResult,
} from './marketingService.js'
export { recommendChannels } from './channelStrategy.js'
export {
  generateChannelContent,
  contentsAreDifferentiated,
} from './contentGenerator.js'
