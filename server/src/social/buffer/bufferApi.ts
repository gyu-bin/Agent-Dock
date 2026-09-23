/**
 * Buffer GraphQL client — only place that talks to api.buffer.com.
 * Official endpoint: POST https://api.buffer.com
 */

import { BUFFER_GRAPHQL_ENDPOINT, getBufferApiKey } from './bufferConfig.js'
import {
  classifyBufferHttp,
  createBufferError,
  redact,
} from './bufferErrors.js'
import type {
  BufferChannelInfo,
  BufferCreatePostInput,
  BufferCreatePostResult,
  BufferGraphQLFn,
  BufferPostStatus,
  BufferShareMode,
} from './bufferTypes.js'

function mapMode(mode: BufferCreatePostInput['mode']): {
  shareMode: BufferShareMode
  saveToDraft: boolean
} {
  if (mode === 'draft') {
    return { shareMode: 'addToQueue', saveToDraft: true }
  }
  if (mode === 'now') return { shareMode: 'shareNow', saveToDraft: false }
  if (mode === 'scheduled') {
    return { shareMode: 'customScheduled', saveToDraft: false }
  }
  return { shareMode: 'addToQueue', saveToDraft: false }
}

export function createLiveBufferGraphQL(
  apiKey: string,
  endpoint = BUFFER_GRAPHQL_ENDPOINT,
): BufferGraphQLFn {
  return async ({ query, variables }) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })
    const text = await res.text()
    let parsed: { data?: unknown; errors?: Array<{ message?: string }> } = {}
    try {
      parsed = JSON.parse(text) as typeof parsed
    } catch {
      throw classifyBufferHttp(res.status, text)
    }
    if (!res.ok) {
      throw classifyBufferHttp(res.status, text)
    }
    return {
      data: parsed.data,
      errors: parsed.errors,
      httpStatus: res.status,
    }
  }
}

export class BufferApi {
  constructor(private readonly gql: BufferGraphQLFn) {}

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
  ): BufferApi | null {
    const key = getBufferApiKey(env)
    if (!key) return null
    return new BufferApi(createLiveBufferGraphQL(key))
  }

  async fetchAccountAndChannels(): Promise<{
    accountId?: string
    organizations: Array<{ id: string; name?: string }>
    channels: BufferChannelInfo[]
  }> {
    const orgRes = await this.gql({
      query: `
        query GetOrganizations {
          account {
            id
            organizations {
              id
              name
            }
          }
        }
      `,
    })
    this.assertNoTopLevelErrors(orgRes.errors)
    const account = (orgRes.data as {
      account?: {
        id?: string
        organizations?: Array<{ id: string; name?: string }>
      }
    })?.account
    if (!account) {
      throw createBufferError({
        category: 'BUFFER_AUTH',
        userMessage: 'Buffer 계정을 확인할 수 없습니다.',
        technicalSummary: 'account null',
      })
    }
    const organizations = account.organizations ?? []
    const channels: BufferChannelInfo[] = []
    for (const org of organizations) {
      const chRes = await this.gql({
        query: `
          query GetChannels($organizationId: OrganizationId!) {
            channels(input: { organizationId: $organizationId }) {
              id
              name
              service
            }
          }
        `,
        variables: { organizationId: org.id },
      })
      this.assertNoTopLevelErrors(chRes.errors)
      const list = (chRes.data as {
        channels?: Array<{
          id: string
          name?: string
          service?: string
        }>
      })?.channels
      if (!Array.isArray(list)) continue
      for (const c of list) {
        channels.push({
          id: c.id,
          name: c.name ?? c.id,
          service: c.service ?? 'unknown',
          displayName: c.name,
          organizationId: org.id,
          available: true,
        })
      }
    }
    return {
      accountId: account.id,
      organizations,
      channels,
    }
  }

  async createPost(
    input: BufferCreatePostInput,
  ): Promise<BufferCreatePostResult> {
    const { shareMode, saveToDraft } = mapMode(
      input.saveToDraft ? 'draft' : input.mode,
    )
    if (shareMode === 'customScheduled' && !input.dueAt) {
      throw createBufferError({
        category: 'BUFFER_INVALID_CONTENT',
        userMessage: '예약 게시에는 dueAt(UTC)이 필요합니다.',
        technicalSummary: 'customScheduled without dueAt',
      })
    }

    const assets: Array<Record<string, unknown>> = []
    for (const url of input.imageUrls ?? []) {
      assets.push({ image: { url } })
    }
    for (const url of input.videoUrls ?? []) {
      assets.push({ video: { url } })
    }

    const variables: Record<string, unknown> = {
      input: {
        text: input.text,
        channelId: input.channelId,
        schedulingType: 'automatic',
        mode: shareMode,
        needsApproval: false,
        saveToDraft: saveToDraft || input.mode === 'draft',
        aiAssisted: input.aiAssisted ?? true,
        assets,
        ...(shareMode === 'customScheduled' && input.dueAt
          ? { dueAt: input.dueAt }
          : {}),
      },
    }

    const res = await this.gql({
      query: `
        mutation CreatePost($input: CreatePostInput!) {
          createPost(input: $input) {
            __typename
            ... on PostActionSuccess {
              post {
                id
                text
                status
                dueAt
              }
            }
            ... on MutationError {
              message
            }
          }
        }
      `,
      variables,
    })
    this.assertNoTopLevelErrors(res.errors)

    const payload = (res.data as {
      createPost?: {
        __typename?: string
        post?: {
          id: string
          text?: string
          status?: string
          dueAt?: string | null
        }
        message?: string
      }
    })?.createPost

    if (!payload) {
      throw createBufferError({
        category: 'BUFFER_PUBLISH_UNKNOWN',
        userMessage: 'Buffer 게시 응답이 비어 있습니다.',
        technicalSummary: 'createPost null',
      })
    }

    if (
      payload.__typename === 'MutationError' ||
      (payload.message && !payload.post)
    ) {
      throw createBufferError({
        category: 'BUFFER_INVALID_CONTENT',
        userMessage: payload.message ?? 'Buffer 게시에 실패했습니다.',
        technicalSummary: redact(payload.message ?? 'MutationError'),
      })
    }

    if (!payload.post?.id) {
      throw createBufferError({
        category: 'BUFFER_PUBLISH_UNKNOWN',
        userMessage: 'Buffer 게시 ID를 받지 못했습니다.',
        technicalSummary: 'missing post id',
      })
    }

    return {
      bufferPostId: payload.post.id,
      channelId: input.channelId,
      status: normalizePostStatus(payload.post.status, {
        draft: saveToDraft || input.mode === 'draft',
        mode: input.mode,
      }),
      dueAt: payload.post.dueAt,
      text: payload.post.text,
    }
  }

  async getPost(postId: string): Promise<{
    id: string
    status?: BufferPostStatus
    dueAt?: string | null
    text?: string
  } | null> {
    const res = await this.gql({
      query: `
        query GetPost($id: PostId!) {
          post(id: $id) {
            id
            text
            status
            dueAt
          }
        }
      `,
      variables: { id: postId },
    })
    this.assertNoTopLevelErrors(res.errors)
    const post = (res.data as {
      post?: {
        id: string
        text?: string
        status?: string
        dueAt?: string | null
      } | null
    })?.post
    if (!post) return null
    return {
      id: post.id,
      status: normalizePostStatus(post.status, {}),
      dueAt: post.dueAt,
      text: post.text,
    }
  }

  private assertNoTopLevelErrors(
    errors?: Array<{ message?: string }>,
  ): void {
    if (!errors?.length) return
    const msg = errors.map((e) => e.message).filter(Boolean).join('; ')
    const auth = /unauthor|forbidden|api.?key|auth/i.test(msg)
    throw createBufferError({
      category: auth ? 'BUFFER_AUTH' : 'BUFFER_UPSTREAM',
      userMessage: auth
        ? 'Buffer API 인증에 실패했습니다.'
        : 'Buffer GraphQL 오류가 발생했습니다.',
      technicalSummary: redact(msg || 'graphql errors'),
      status: auth ? 401 : 502,
      retryable: !auth,
    })
  }
}

function normalizePostStatus(
  raw: string | undefined,
  opts: { draft?: boolean; mode?: BufferCreatePostInput['mode'] },
): BufferPostStatus {
  const s = (raw ?? '').toLowerCase()
  if (
    s === 'draft' ||
    s === 'needs_approval' ||
    s === 'scheduled' ||
    s === 'sending' ||
    s === 'sent' ||
    s === 'error'
  ) {
    return s as BufferPostStatus
  }
  if (opts.draft || opts.mode === 'draft') return 'draft'
  if (opts.mode === 'now') return 'sent'
  if (opts.mode === 'scheduled') return 'scheduled'
  // Queue posts are accepted into Buffer queue — not SNS-live
  if (opts.mode === 'queue') return 'scheduled'
  return 'scheduled'
}
