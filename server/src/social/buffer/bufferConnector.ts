/**
 * BufferConnector — distribution aggregator over GraphQL API.
 * Not registered as a SocialChannel; used via BufferPublishService.
 */

import { BufferApi, createLiveBufferGraphQL } from './bufferApi.js'
import { getBufferApiKey, hasBufferApiKey } from './bufferConfig.js'
import { createBufferError, isBufferError } from './bufferErrors.js'
import type {
  BufferAccountState,
  BufferCreatePostInput,
  BufferCreatePostResult,
  BufferGraphQLFn,
} from './bufferTypes.js'

export class BufferConnector {
  private cached: BufferAccountState | null = null
  private readonly api: BufferApi | null

  constructor(
    private readonly gqlOverride?: BufferGraphQLFn,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    if (gqlOverride) {
      this.api = new BufferApi(gqlOverride)
    } else {
      this.api = BufferApi.fromEnv(env)
    }
  }

  /** Fixture helper */
  static withFakeGraphQL(fn: BufferGraphQLFn): BufferConnector {
    return new BufferConnector(fn)
  }

  isKeyPresent(): boolean {
    return Boolean(this.gqlOverride) || hasBufferApiKey(this.env)
  }

  getCachedState(): BufferAccountState {
    if (this.cached) return this.cached
    if (!this.isKeyPresent()) {
      return {
        configured: false,
        available: false,
        label: 'Buffer · 설정 필요',
        organizations: [],
        channels: [],
      }
    }
    return {
      configured: true,
      available: false,
      label: 'Buffer · 확인 필요',
      organizations: [],
      channels: [],
    }
  }

  /**
   * Live preflight: account + orgs + channels.
   * env presence alone never sets available=true.
   */
  async refreshState(): Promise<BufferAccountState> {
    if (!this.api) {
      this.cached = {
        configured: false,
        available: false,
        label: 'Buffer · 설정 필요',
        organizations: [],
        channels: [],
      }
      return this.cached
    }
    try {
      const data = await this.api.fetchAccountAndChannels()
      this.cached = {
        configured: true,
        available: true,
        label: 'Buffer · 연결됨',
        accountId: data.accountId,
        organizations: data.organizations,
        channels: data.channels,
        lastCheckedAt: new Date().toISOString(),
      }
      return this.cached
    } catch (err) {
      const cat = isBufferError(err) ? err.category : 'BUFFER_UNKNOWN'
      this.cached = {
        configured: true,
        available: false,
        label: 'Buffer · 연결 실패',
        organizations: [],
        channels: [],
        lastCheckedAt: new Date().toISOString(),
        errorCategory: cat,
      }
      return this.cached
    }
  }

  async createPost(
    input: BufferCreatePostInput,
  ): Promise<BufferCreatePostResult> {
    if (!this.api) {
      throw createBufferError({
        category: 'BUFFER_NOT_CONFIGURED',
        userMessage: 'Buffer API Key가 설정되지 않았습니다.',
        technicalSummary: 'no api',
      })
    }
    const state = this.cached ?? (await this.refreshState())
    if (!state.available) {
      throw createBufferError({
        category: 'BUFFER_NOT_CONFIGURED',
        userMessage: 'Buffer가 사용 가능하지 않습니다.',
        technicalSummary: state.errorCategory ?? 'unavailable',
      })
    }
    return this.api.createPost(input)
  }

  async getPost(postId: string) {
    if (!this.api) {
      throw createBufferError({
        category: 'BUFFER_NOT_CONFIGURED',
        userMessage: 'Buffer API Key가 설정되지 않았습니다.',
        technicalSummary: 'no api',
      })
    }
    return this.api.getPost(postId)
  }

  /** Public-safe status for Settings — never includes API key */
  toPublicStatus(): {
    configured: boolean
    available: boolean
    label: string
    channelCount: number
    channels: Array<{
      id: string
      name: string
      service: string
      displayName?: string
    }>
    organizations: Array<{ id: string; name?: string }>
    lastCheckedAt?: string
  } {
    const s = this.getCachedState()
    return {
      configured: s.configured,
      available: s.available,
      label: s.label,
      channelCount: s.channels.length,
      channels: s.channels.map((c) => ({
        id: c.id,
        name: c.name,
        service: c.service,
        displayName: c.displayName,
      })),
      organizations: s.organizations,
      lastCheckedAt: s.lastCheckedAt,
    }
  }
}

/** Production factory — never logs key */
export function createBufferConnector(
  env: NodeJS.ProcessEnv = process.env,
): BufferConnector {
  const key = getBufferApiKey(env)
  if (!key) return new BufferConnector(undefined, env)
  return new BufferConnector(createLiveBufferGraphQL(key), env)
}
