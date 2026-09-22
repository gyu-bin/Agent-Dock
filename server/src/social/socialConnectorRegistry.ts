/**
 * SocialConnectorRegistry — MarketingService must not switch(channel).
 * Production defaults: all Unconfigured. Fake never auto-selected.
 */

import { UnconfiguredSocialConnector } from './connectors/unconfiguredConnector.js'
import type {
  ConnectorState,
  SocialChannel,
  SocialConnector,
  ConnectorCapability,
} from './types.js'
import type { CredentialRepository } from '../credentials/types.js'
import { ThreadsConnector } from './threads/threadsConnector.js'

const DEFAULT_CHANNELS: SocialChannel[] = [
  'threads',
  'instagram',
  'x',
  'youtube',
  'reddit',
  'blog',
  'custom',
]

/** Caps declared for future real adapters — not claiming support */
function defaultCaps(channel: SocialChannel): ConnectorCapability[] {
  switch (channel) {
    case 'instagram':
      return ['text.publish', 'image.publish', 'analytics.read']
    case 'youtube':
      return ['video.publish', 'analytics.read']
    case 'threads':
      return ['text.publish']
    case 'x':
    case 'blog':
    case 'custom':
      return ['text.publish', 'analytics.read']
    case 'reddit':
      return ['text.publish']
    default:
      return ['text.publish']
  }
}

export class SocialConnectorRegistry {
  private readonly byChannel = new Map<SocialChannel, SocialConnector>()
  private threadsConnector: ThreadsConnector | null = null

  constructor(seed?: SocialConnector[]) {
    for (const ch of DEFAULT_CHANNELS) {
      this.byChannel.set(
        ch,
        new UnconfiguredSocialConnector(ch, defaultCaps(ch), {
          notes:
            ch === 'reddit'
              ? 'Reddit slot reserved — no real API this phase'
              : undefined,
        }),
      )
    }
    if (seed) {
      for (const c of seed) this.register(c)
    }
  }

  /** Wire real ThreadsConnector (production boot). */
  useThreadsConnector(connector: ThreadsConnector): void {
    this.threadsConnector = connector
    this.register(connector)
  }

  getThreadsConnector(): ThreadsConnector | null {
    return this.threadsConnector
  }

  register(connector: SocialConnector): void {
    this.byChannel.set(connector.channel, connector)
    if (connector instanceof ThreadsConnector) {
      this.threadsConnector = connector
    }
  }

  /** Restore unconfigured (after fixture). */
  unregister(channel: SocialChannel): void {
    if (channel === 'threads') this.threadsConnector = null
    this.byChannel.set(
      channel,
      new UnconfiguredSocialConnector(channel, defaultCaps(channel)),
    )
  }

  getConnector(channel: SocialChannel): SocialConnector {
    const c = this.byChannel.get(channel)
    if (!c) {
      return new UnconfiguredSocialConnector(channel, defaultCaps(channel))
    }
    return c
  }

  listConnectors(): SocialConnector[] {
    return DEFAULT_CHANNELS.map((ch) => this.getConnector(ch))
  }

  listStates(): ConnectorState[] {
    return this.listConnectors().map((c) => c.getState())
  }

  /** Prefer async state when connector supports it (Threads). */
  async listStatesAsync(): Promise<ConnectorState[]> {
    const out: ConnectorState[] = []
    for (const c of this.listConnectors()) {
      if (
        c instanceof ThreadsConnector &&
        typeof c.getStateAsync === 'function'
      ) {
        out.push(await c.getStateAsync())
      } else {
        out.push(c.getState())
      }
    }
    return out
  }

  getCapabilities(channel: SocialChannel): ConnectorCapability[] {
    return this.getConnector(channel).getState().capabilities
  }

  hasAnyPublishAvailable(): boolean {
    return this.listStates().some(
      (s) =>
        s.available &&
        s.configured &&
        (s.capabilities.includes('text.publish') ||
          s.capabilities.includes('image.publish') ||
          s.capabilities.includes('video.publish')),
    )
  }

  async hasAnyPublishAvailableAsync(): Promise<boolean> {
    const states = await this.listStatesAsync()
    return states.some(
      (s) =>
        s.available &&
        s.configured &&
        (s.capabilities.includes('text.publish') ||
          s.capabilities.includes('image.publish') ||
          s.capabilities.includes('video.publish')),
    )
  }

  hasAnyAnalyticsAvailable(): boolean {
    return this.listStates().some(
      (s) =>
        s.available &&
        s.configured &&
        s.capabilities.includes('analytics.read'),
    )
  }

  isChannelPublishAvailable(channel: SocialChannel): boolean {
    const s = this.getConnector(channel).getState()
    return (
      s.available &&
      s.configured &&
      (s.capabilities.includes('text.publish') ||
        s.capabilities.includes('image.publish') ||
        s.capabilities.includes('video.publish'))
    )
  }

  async isChannelPublishAvailableAsync(
    channel: SocialChannel,
  ): Promise<boolean> {
    const c = this.getConnector(channel)
    const s =
      c instanceof ThreadsConnector
        ? await c.getStateAsync()
        : c.getState()
    return (
      s.available &&
      s.configured &&
      (s.capabilities.includes('text.publish') ||
        s.capabilities.includes('image.publish') ||
        s.capabilities.includes('video.publish'))
    )
  }
}

export function createDefaultSocialRegistry(
  credentials?: CredentialRepository,
): SocialConnectorRegistry {
  const registry = new SocialConnectorRegistry()
  if (credentials) {
    registry.useThreadsConnector(new ThreadsConnector(credentials))
  }
  return registry
}
