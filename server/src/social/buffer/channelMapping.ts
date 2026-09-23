/**
 * Map Agent Deck MarketingChannel ↔ Buffer official `service` enum.
 * Uses documented Service values only — no name guessing.
 */

import type { SocialChannel } from '../types.js'
import type { BufferChannelInfo, BufferService } from './bufferTypes.js'

/** Official Buffer Service → Agent Deck channel (when overlapping). */
export function bufferServiceToMarketingChannel(
  service: BufferService,
): SocialChannel | null {
  switch (service) {
    case 'threads':
      return 'threads'
    case 'instagram':
      return 'instagram'
    case 'youtube':
      return 'youtube'
    case 'twitter':
      return 'x'
    default:
      return null
  }
}

export function marketingChannelToBufferService(
  channel: SocialChannel,
): BufferService | null {
  switch (channel) {
    case 'threads':
      return 'threads'
    case 'instagram':
      return 'instagram'
    case 'youtube':
      return 'youtube'
    case 'x':
      return 'twitter'
    default:
      return null
  }
}

export function pickBufferChannelForMarketing(
  channels: BufferChannelInfo[],
  marketingChannel: SocialChannel,
  preferredId?: string,
): BufferChannelInfo | null {
  if (preferredId) {
    const hit = channels.find((c) => c.id === preferredId && c.available)
    if (hit) return hit
  }
  const service = marketingChannelToBufferService(marketingChannel)
  if (!service) return null
  return (
    channels.find((c) => c.service === service && c.available) ?? null
  )
}
