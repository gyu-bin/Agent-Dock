/**
 * Threads OAuth — CSRF state validation, token exchange, credential store.
 * Tokens never returned to browser.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import type { CredentialRepository } from '../../credentials/types.js'
import {
  THREADS_OAUTH_AUTHORIZE,
  THREADS_SCOPES,
  getThreadsAppConfig,
} from './threadsConfig.js'
import {
  exchangeCodeForToken,
  exchangeLongLivedToken,
  fetchThreadsProfile,
  refreshLongLivedToken,
} from './threadsApi.js'
import { createThreadsError } from './threadsErrors.js'

const ACCOUNT_KEY = 'global'

interface PendingOAuth {
  state: string
  /** sha256 of state for timing-safe compare */
  stateHash: string
  createdAt: number
  redirectUri: string
}

const pending = new Map<string, PendingOAuth>()
const STATE_TTL_MS = 10 * 60 * 1000

function purgeExpired(): void {
  const now = Date.now()
  for (const [k, v] of pending) {
    if (now - v.createdAt > STATE_TTL_MS) pending.delete(k)
  }
}

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex')
    const bb = Buffer.from(b, 'hex')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

export class ThreadsOAuthService {
  constructor(private readonly credentials: CredentialRepository) {}

  isAppConfigured(): boolean {
    return getThreadsAppConfig().configured
  }

  /** Start OAuth — returns authorize URL (no secrets). */
  startAuthorize(): { authorizeUrl: string; state: string } {
    const cfg = getThreadsAppConfig()
    if (!cfg.configured) {
      throw createThreadsError({
        code: 'THREADS_OAUTH',
        userMessage:
          'Threads 앱이 설정되지 않았습니다. THREADS_APP_ID / THREADS_APP_SECRET을 확인하세요.',
        technicalSummary: 'app not configured',
      })
    }
    purgeExpired()
    const state = randomBytes(24).toString('hex')
    pending.set(state, {
      state,
      stateHash: hashState(state),
      createdAt: Date.now(),
      redirectUri: cfg.redirectUri,
    })
    const qs = new URLSearchParams({
      client_id: cfg.appId,
      redirect_uri: cfg.redirectUri,
      scope: THREADS_SCOPES.join(','),
      response_type: 'code',
      state,
    })
    return {
      authorizeUrl: `${THREADS_OAUTH_AUTHORIZE}?${qs}`,
      state,
    }
  }

  /**
   * Validate CSRF state + exchange code → store long-lived credential.
   * Returns public meta only.
   */
  async handleCallback(input: {
    code?: string
    state?: string
    error?: string
    errorDescription?: string
  }): Promise<{
    username?: string
    profileId?: string
    status: 'connected'
  }> {
    if (input.error) {
      throw createThreadsError({
        code: 'THREADS_OAUTH',
        userMessage: 'Threads 연결이 거부되었거나 실패했습니다.',
        technicalSummary: `${input.error}: ${input.errorDescription ?? ''}`,
      })
    }
    if (!input.code || !input.state) {
      throw createThreadsError({
        code: 'THREADS_OAUTH',
        userMessage: 'OAuth callback이 올바르지 않습니다.',
        technicalSummary: 'missing code or state',
      })
    }
    purgeExpired()
    const pendingEntry = pending.get(input.state)
    pending.delete(input.state)
    if (!pendingEntry) {
      throw createThreadsError({
        code: 'THREADS_OAUTH',
        userMessage: 'OAuth state가 유효하지 않습니다. 다시 연결하세요.',
        technicalSummary: 'unknown or expired state (CSRF)',
      })
    }
    if (!safeEqualHex(pendingEntry.stateHash, hashState(input.state))) {
      throw createThreadsError({
        code: 'THREADS_OAUTH',
        userMessage: 'OAuth state 검증에 실패했습니다.',
        technicalSummary: 'state hash mismatch',
      })
    }

    const cfg = getThreadsAppConfig()
    const short = await exchangeCodeForToken({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      code: input.code,
      redirectUri: pendingEntry.redirectUri,
    })

    let token = short
    try {
      token = await exchangeLongLivedToken({
        appSecret: cfg.appSecret,
        shortLivedToken: short.access_token,
      })
    } catch {
      // Keep short-lived if long-lived exchange fails (still usable ~1h)
      token = short
    }

    const profile = await fetchThreadsProfile(token.access_token)
    const now = Date.now()
    const expiresIn = token.expires_in ?? 3600
    const expiresAt = new Date(now + expiresIn * 1000).toISOString()
    // Long-lived refresh allowed after 24h
    const refreshAfter = new Date(now + 24 * 60 * 60 * 1000).toISOString()

    await this.credentials.save({
      meta: {
        provider: 'threads',
        accountKey: ACCOUNT_KEY,
        profileId: profile.id,
        username: profile.username,
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'connected',
      },
      secret: {
        accessToken: token.access_token,
        tokenType: token.token_type ?? 'bearer',
        scopes: [...THREADS_SCOPES],
        expiresAt,
        refreshAfter,
      },
    })

    return {
      username: profile.username,
      profileId: profile.id,
      status: 'connected',
    }
  }

  async disconnect(): Promise<void> {
    await this.credentials.delete('threads', ACCOUNT_KEY)
  }

  async getPublicConnection(): Promise<{
    connected: boolean
    status: string
    username?: string
    profileId?: string
    appConfigured: boolean
  }> {
    const cfg = getThreadsAppConfig()
    const meta = await this.credentials.getMeta('threads', ACCOUNT_KEY)
    if (!meta || meta.status === 'disconnected') {
      return {
        connected: false,
        status: cfg.configured ? 'unconfigured' : 'unconfigured',
        appConfigured: cfg.configured,
      }
    }
    return {
      connected: meta.status === 'connected',
      status: meta.status,
      username: meta.username,
      profileId: meta.profileId,
      appConfigured: cfg.configured,
    }
  }

  /**
   * Ensure valid access token — refresh if due. Updates store.
   * Never logs token.
   */
  async getValidAccessToken(): Promise<{
    accessToken: string
    userId: string
    username?: string
  }> {
    const stored = await this.credentials.get('threads', ACCOUNT_KEY)
    if (!stored?.secret.accessToken) {
      throw createThreadsError({
        code: 'THREADS_NOT_CONNECTED',
        userMessage: 'Threads가 연결되지 않았습니다.',
        technicalSummary: 'no credential',
      })
    }

    const now = Date.now()
    const expiresAt = stored.secret.expiresAt
      ? Date.parse(stored.secret.expiresAt)
      : 0

    if (expiresAt && expiresAt < now + 60_000) {
      await this.credentials.save({
        ...stored,
        meta: {
          ...stored.meta,
          status: 'expired',
          updatedAt: new Date().toISOString(),
          lastError: 'token expired',
        },
      })
      throw createThreadsError({
        code: 'THREADS_AUTH_EXPIRED',
        userMessage: 'Threads 인증이 만료되었습니다. 다시 연결하세요.',
        technicalSummary: 'token expired',
      })
    }

    const refreshAfter = stored.secret.refreshAfter
      ? Date.parse(stored.secret.refreshAfter)
      : 0

    // Proactive refresh when past refreshAfter and not near expiry failure
    if (refreshAfter && now >= refreshAfter && expiresAt > now + 60_000) {
      try {
        const refreshed = await refreshLongLivedToken(stored.secret.accessToken)
        const expIn = refreshed.expires_in ?? 60 * 24 * 60 * 60
        const nextExp = new Date(now + expIn * 1000).toISOString()
        const nextRefresh = new Date(now + 24 * 60 * 60 * 1000).toISOString()
        await this.credentials.save({
          meta: {
            ...stored.meta,
            status: 'connected',
            updatedAt: new Date().toISOString(),
            lastError: undefined,
          },
          secret: {
            ...stored.secret,
            accessToken: refreshed.access_token,
            expiresAt: nextExp,
            refreshAfter: nextRefresh,
          },
        })
        return {
          accessToken: refreshed.access_token,
          userId: stored.meta.profileId!,
          username: stored.meta.username,
        }
      } catch {
        // Keep existing token if refresh fails and still valid
      }
    }

    if (!stored.meta.profileId) {
      throw createThreadsError({
        code: 'THREADS_NOT_CONNECTED',
        userMessage: 'Threads 프로필 정보가 없습니다. 다시 연결하세요.',
        technicalSummary: 'missing profileId',
      })
    }

    return {
      accessToken: stored.secret.accessToken,
      userId: stored.meta.profileId,
      username: stored.meta.username,
    }
  }

  /** Fixture helper — inject credential without OAuth */
  async injectFixtureCredential(input: {
    accessToken: string
    profileId: string
    username?: string
    expiresAt?: string
    status?: 'connected' | 'expired' | 'error'
  }): Promise<void> {
    await this.credentials.save({
      meta: {
        provider: 'threads',
        accountKey: ACCOUNT_KEY,
        profileId: input.profileId,
        username: input.username ?? 'fixture_user',
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: input.status ?? 'connected',
      },
      secret: {
        accessToken: input.accessToken,
        tokenType: 'bearer',
        scopes: [...THREADS_SCOPES],
        expiresAt:
          input.expiresAt ??
          new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
        refreshAfter: new Date(Date.now() + 25 * 3600 * 1000).toISOString(),
      },
    })
  }

  /** Test-only: peek pending state count */
  _pendingCount(): number {
    purgeExpired()
    return pending.size
  }

  /** Test-only: validate state without consuming token exchange */
  _validateStateForTest(state: string): boolean {
    purgeExpired()
    const e = pending.get(state)
    if (!e) return false
    return safeEqualHex(e.stateHash, hashState(state))
  }
}

export const THREADS_ACCOUNT_KEY = ACCOUNT_KEY
