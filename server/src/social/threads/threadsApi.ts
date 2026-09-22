/**
 * Official Threads Graph API client.
 * Endpoints from https://developers.facebook.com/docs/threads/
 */

import { threadsGraphUrl } from './threadsConfig.js'
import { classifyThreadsHttpError, createThreadsError } from './threadsErrors.js'
import { redactSecrets } from '../../credentials/redact.js'

export interface ThreadsProfile {
  id: string
  username?: string
  name?: string
  threads_profile_picture_url?: string
}

export interface ThreadsTokenResponse {
  access_token: string
  token_type?: string
  expires_in?: number
  user_id?: number | string
}

async function threadsFetch(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; text: string; json: unknown }> {
  const res = await fetch(url, init)
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, text, json }
}

/** Exchange authorization code → short-lived token */
export async function exchangeCodeForToken(input: {
  appId: string
  appSecret: string
  code: string
  redirectUri: string
}): Promise<ThreadsTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.appId,
    client_secret: input.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
    code: input.code,
  })
  const { status, text, json } = await threadsFetch(
    threadsGraphUrl('/oauth/access_token'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  )
  if (status >= 400 || !json || typeof json !== 'object') {
    throw classifyThreadsHttpError(status, text)
  }
  const data = json as ThreadsTokenResponse
  if (!data.access_token) {
    throw createThreadsError({
      code: 'THREADS_OAUTH',
      userMessage: 'Threads 토큰 교환에 실패했습니다.',
      technicalSummary: 'missing access_token in exchange response',
    })
  }
  return data
}

/** Short-lived → long-lived (60 days) */
export async function exchangeLongLivedToken(input: {
  appSecret: string
  shortLivedToken: string
}): Promise<ThreadsTokenResponse> {
  const qs = new URLSearchParams({
    grant_type: 'th_exchange_token',
    client_secret: input.appSecret,
    access_token: input.shortLivedToken,
  })
  const { status, text, json } = await threadsFetch(
    `${threadsGraphUrl('/access_token')}?${qs}`,
  )
  if (status >= 400 || !json || typeof json !== 'object') {
    throw classifyThreadsHttpError(status, text)
  }
  const data = json as ThreadsTokenResponse
  if (!data.access_token) {
    throw createThreadsError({
      code: 'THREADS_OAUTH',
      userMessage: '장기 토큰 교환에 실패했습니다.',
      technicalSummary: 'missing access_token in long-lived exchange',
    })
  }
  return data
}

/** Refresh long-lived token (must be ≥24h old, not expired) */
export async function refreshLongLivedToken(
  accessToken: string,
): Promise<ThreadsTokenResponse> {
  const qs = new URLSearchParams({
    grant_type: 'th_refresh_token',
    access_token: accessToken,
  })
  const { status, text, json } = await threadsFetch(
    `${threadsGraphUrl('/refresh_access_token')}?${qs}`,
  )
  if (status >= 400 || !json || typeof json !== 'object') {
    throw classifyThreadsHttpError(status, text)
  }
  const data = json as ThreadsTokenResponse
  if (!data.access_token) {
    throw createThreadsError({
      code: 'THREADS_AUTH_EXPIRED',
      userMessage: 'Threads 토큰 갱신에 실패했습니다. 다시 연결하세요.',
      technicalSummary: 'missing access_token in refresh',
    })
  }
  return data
}

export async function fetchThreadsProfile(
  accessToken: string,
): Promise<ThreadsProfile> {
  const qs = new URLSearchParams({
    fields: 'id,username,name,threads_profile_picture_url',
    access_token: accessToken,
  })
  const { status, text, json } = await threadsFetch(
    `${threadsGraphUrl('/me')}?${qs}`,
  )
  if (status >= 400 || !json || typeof json !== 'object') {
    throw classifyThreadsHttpError(status, text)
  }
  const data = json as ThreadsProfile
  if (!data.id) {
    throw createThreadsError({
      code: 'THREADS_UPSTREAM',
      userMessage: 'Threads 프로필을 확인할 수 없습니다.',
      technicalSummary: 'missing id from /me',
    })
  }
  return data
}

/** Create TEXT media container */
export async function createTextContainer(input: {
  userId: string
  accessToken: string
  text: string
  linkAttachment?: string
}): Promise<{ id: string }> {
  const body = new URLSearchParams({
    media_type: 'TEXT',
    text: input.text,
    access_token: input.accessToken,
  })
  if (input.linkAttachment) {
    body.set('link_attachment', input.linkAttachment)
  }
  const { status, text, json } = await threadsFetch(
    threadsGraphUrl(`/${input.userId}/threads`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  )
  if (status >= 400 || !json || typeof json !== 'object') {
    throw classifyThreadsHttpError(status, text)
  }
  const data = json as { id?: string }
  if (!data.id) {
    throw createThreadsError({
      code: 'THREADS_UPSTREAM',
      userMessage: 'Threads 미디어 컨테이너 생성에 실패했습니다.',
      technicalSummary: 'missing container id',
    })
  }
  return { id: data.id }
}

/** Publish container → remote media id */
export async function publishContainer(input: {
  userId: string
  accessToken: string
  creationId: string
}): Promise<{ id: string }> {
  const body = new URLSearchParams({
    creation_id: input.creationId,
    access_token: input.accessToken,
  })
  const { status, text, json } = await threadsFetch(
    threadsGraphUrl(`/${input.userId}/threads_publish`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  )
  if (status >= 400) {
    // Ambiguous: may have published — caller should treat carefully
    if (status >= 500 || status === 408) {
      throw createThreadsError({
        code: 'THREADS_PUBLISH_UNKNOWN',
        userMessage:
          '게시 결과가 불명확합니다. 중복 게시 방지를 위해 자동 재시도하지 않습니다. Threads에서 확인하세요.',
        technicalSummary: redactSecrets(`ambiguous publish HTTP ${status}: ${text}`),
        status: 502,
        retryable: false,
      })
    }
    throw classifyThreadsHttpError(status, text)
  }
  if (!json || typeof json !== 'object') {
    throw createThreadsError({
      code: 'THREADS_PUBLISH_UNKNOWN',
      userMessage:
        '게시 응답을 해석할 수 없습니다. 자동 재게시하지 않습니다.',
      technicalSummary: 'empty publish response',
      retryable: false,
    })
  }
  const data = json as { id?: string }
  if (!data.id) {
    throw createThreadsError({
      code: 'THREADS_PUBLISH_UNKNOWN',
      userMessage:
        '원격 게시 ID를 받지 못했습니다. 자동 재게시하지 않습니다.',
      technicalSummary: 'missing publish id',
      retryable: false,
    })
  }
  return { id: data.id }
}

export function buildThreadsPermalink(
  username: string | undefined,
  mediaId: string,
): string | undefined {
  if (!username) return undefined
  // Threads permalink pattern: https://www.threads.net/@user/post/{short} — media id may work as permalink id
  return `https://www.threads.net/@${username}/post/${mediaId}`
}
