import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSource,
} from './types.js'
import {
  dedupeSources,
  domainFromUrl,
  inferSourceQuality,
  makeSourceId,
  sanitizeWebSnippet,
} from './sourceUtils.js'
import { DuckDuckGoHtmlWebSearchProvider } from './duckDuckGoProvider.js'
import { SteamStoreWebSearchProvider } from './steamStoreProvider.js'

/**
 * OpenAI Responses API + hosted `web_search` tool.
 * Decoupled from OpenAIProvider.chat (Chat Completions).
 */
export class OpenAIResponsesWebSearchProvider implements WebSearchProvider {
  readonly id = 'openai-responses-web-search'
  readonly label = 'OpenAI Responses · web_search'
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
    this.model =
      process.env.OPENAI_SEARCH_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      'gpt-4o'
    this.baseUrl =
      process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    if (!this.apiKey) {
      throw Object.assign(new Error('Web Search unavailable: no API key'), {
        status: 503,
        code: 'WEB_SEARCH_UNAVAILABLE',
      })
    }

    const currentDate =
      request.currentDate ?? new Date().toISOString().slice(0, 10)
    const maxSources = request.maxSources ?? 8

    const input = [
      `Current date: ${currentDate}.`,
      `Perform a web search for this query and ground your brief findings in real sources.`,
      `Query: ${request.query}`,
      `Return a short factual digest. Prefer recent sources when the query implies recency.`,
    ].join('\n')

    const body: Record<string, unknown> = {
      model: this.model,
      tools: [
        {
          type: 'web_search',
          search_context_size: 'medium',
        },
      ],
      include: ['web_search_call.action.sources'],
      input,
    }

    const res = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      const safe = errText.replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
      throw Object.assign(
        new Error(`웹 검색 실패: OpenAI Responses ${res.status} ${safe.slice(0, 240)}`),
        {
          status: res.status >= 400 && res.status < 600 ? res.status : 502,
          code: 'WEB_SEARCH_FAILED',
        },
      )
    }

    const data = (await res.json()) as ResponsesPayload
    const sources = extractSourcesFromResponses(data, maxSources)
    if (sources.length === 0) {
      // Model may answer without search — treat as soft failure for freshness tasks
      throw Object.assign(
        new Error('웹 검색 실패: 검색 결과가 반환되지 않았습니다.'),
        { status: 502, code: 'WEB_SEARCH_FAILED' },
      )
    }

    return {
      query: request.query,
      sources,
      searchedAt: new Date().toISOString(),
      providerNote: this.label,
    }
  }
}

/** Deterministic fixture provider for failure E2E (TEST D). */
export class FailingWebSearchProvider implements WebSearchProvider {
  readonly id = 'failing-fixture'
  readonly label = 'Failing fixture'
  isAvailable(): boolean {
    return true
  }
  async search(): Promise<WebSearchResult> {
    throw Object.assign(new Error('웹 검색 실패: fixture provider'), {
      status: 502,
      code: 'WEB_SEARCH_FAILED',
    })
  }
}

type ResponsesPayload = {
  output?: Array<{
    type?: string
    action?: {
      type?: string
      query?: string
      queries?: string[]
      sources?: Array<{ url?: string; type?: string; title?: string }>
    }
    content?: Array<{
      type?: string
      text?: string
      annotations?: Array<{
        type?: string
        url?: string
        title?: string
        start_index?: number
        end_index?: number
      }>
    }>
  }>
}

function extractSourcesFromResponses(
  data: ResponsesPayload,
  max: number,
): WebSource[] {
  const collected: WebSource[] = []
  let idx = 0

  for (const item of data.output ?? []) {
    if (item.type === 'web_search_call' && item.action?.sources) {
      for (const s of item.action.sources) {
        if (!s.url) continue
        const domain = domainFromUrl(s.url)
        collected.push({
          id: makeSourceId(s.url, idx++),
          title: s.title || domain || s.url,
          url: s.url,
          domain,
          quality: inferSourceQuality(domain),
        })
      }
    }
    for (const part of item.content ?? []) {
      for (const ann of part.annotations ?? []) {
        if (ann.type !== 'url_citation' || !ann.url) continue
        const domain = domainFromUrl(ann.url)
        let snippet: string | undefined
        if (
          typeof ann.start_index === 'number' &&
          typeof ann.end_index === 'number' &&
          part.text
        ) {
          snippet = sanitizeWebSnippet(
            part.text.slice(
              Math.max(0, ann.start_index - 40),
              Math.min(part.text.length, ann.end_index + 80),
            ),
          )
        }
        collected.push({
          id: makeSourceId(ann.url, idx++),
          title: ann.title || domain || ann.url,
          url: ann.url,
          domain,
          snippet,
          quality: inferSourceQuality(domain),
        })
      }
    }
  }

  return dedupeSources(collected).slice(0, max)
}

export function createWebSearchProvider(): WebSearchProvider {
  if (process.env.WEB_SEARCH_FORCE_FAIL === '1') {
    return new FailingWebSearchProvider()
  }
  if (process.env.WEB_SEARCH_PROVIDER === 'duckduckgo') {
    return new DuckDuckGoHtmlWebSearchProvider()
  }
  if (process.env.WEB_SEARCH_PROVIDER === 'steam') {
    return new SteamStoreWebSearchProvider()
  }
  const key = process.env.OPENAI_API_KEY?.trim()
  const steam = new SteamStoreWebSearchProvider()
  const ddg = new DuckDuckGoHtmlWebSearchProvider()
  const fallback = new FallbackWebSearchProvider(steam, ddg)
  if (key) {
    const primary = new OpenAIResponsesWebSearchProvider(key)
    return new FallbackWebSearchProvider(primary, fallback)
  }
  return fallback
}

/** Prefer OpenAI; on quota/5xx fall back to DuckDuckGo for real URLs. */
export class FallbackWebSearchProvider implements WebSearchProvider {
  readonly id = 'openai-with-ddg-fallback'
  readonly label: string
  constructor(
    private readonly primary: WebSearchProvider,
    private readonly fallback: WebSearchProvider,
  ) {
    this.label = `${primary.label} → ${fallback.label}`
  }
  isAvailable(): boolean {
    return this.primary.isAvailable() || this.fallback.isAvailable()
  }
  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    if (this.primary.isAvailable()) {
      try {
        return await this.primary.search(request)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const status =
          err && typeof err === 'object' && 'status' in err
            ? Number((err as { status: number }).status)
            : 0
        const quota =
          status === 429 ||
          /insufficient_quota|no credits|credit_ba|429/i.test(msg)
        const serverish = status >= 500 || status === 502 || status === 503
        if (!quota && !serverish) throw err
        console.warn(
          `[web-search] primary failed (${status || 'n/a'}); falling back to ${this.fallback.id}`,
        )
      }
    }
    return this.fallback.search(request)
  }
}
