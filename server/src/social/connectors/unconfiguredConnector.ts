/**
 * Unconfigured connector — production default.
 * Never publishes. Never pretends to be connected.
 */

import { createSocialError } from '../socialErrors.js'
import type {
  ConnectorState,
  PublishRequest,
  PublishResult,
  PublishValidationResult,
  SocialChannel,
  SocialConnector,
  ConnectorCapability,
  ConnectorPolicyMetadata,
} from '../types.js'

export class UnconfiguredSocialConnector implements SocialConnector {
  readonly id: string
  readonly channel: SocialChannel
  private readonly caps: ConnectorCapability[]
  private readonly policy: ConnectorPolicyMetadata

  constructor(
    channel: SocialChannel,
    caps: ConnectorCapability[] = ['text.publish'],
    policy: ConnectorPolicyMetadata = {},
  ) {
    this.channel = channel
    this.id = `unconfigured-${channel}`
    this.caps = caps
    this.policy = policy
  }

  getState(): ConnectorState {
    return {
      id: this.id,
      channel: this.channel,
      state: 'unconfigured',
      label: `${labelFor(this.channel)} · 연결 안 됨`,
      capabilities: this.caps,
      policy: this.policy,
      configured: false,
      available: false,
    }
  }

  async validate(_request: PublishRequest): Promise<PublishValidationResult> {
    return {
      ok: false,
      errors: [
        {
          code: 'SOCIAL_NOT_CONFIGURED',
          message: 'SNS 커넥터가 연결되지 않았습니다.',
        },
      ],
    }
  }

  async publish(_request: PublishRequest): Promise<PublishResult> {
    throw createSocialError({
      category: 'SOCIAL_NOT_CONFIGURED',
      userMessage: 'SNS 커넥터가 연결되지 않았습니다. 게시를 진행할 수 없습니다.',
      technicalSummary: `connector unconfigured: ${this.channel}`,
      status: 503,
    })
  }
}

function labelFor(channel: SocialChannel): string {
  switch (channel) {
    case 'threads':
      return 'Threads'
    case 'instagram':
      return 'Instagram'
    case 'x':
      return 'X'
    case 'youtube':
      return 'YouTube'
    case 'reddit':
      return 'Reddit'
    case 'blog':
      return 'Blog'
    default:
      return 'Custom'
  }
}
