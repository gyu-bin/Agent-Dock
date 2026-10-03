import type { ChatGPTPlanProvider } from '../providers/chatgptPlanProvider.js'
import type { WebSearchProvider, WebSearchRequest } from './types.js'
import { createWebSearchProvider, extractSourcesFromResponses } from './webSearchProvider.js'

/** Policy/tool failures may use nonbillable search; never switch to an API key. */
export class ChatGPTPlanSearchProvider implements WebSearchProvider {
  readonly id = 'chatgpt-plan-web-search'
  readonly label = 'ChatGPT Plan Web Search → Search Provider'
  constructor(private plan: ChatGPTPlanProvider, private configured: () => boolean) {}
  isAvailable() { return this.configured() || createWebSearchProvider(false).isAvailable() }
  async search(request: WebSearchRequest) {
    let reason = 'ChatGPT Plan not configured'
    if (this.configured()) {
      try {
        const response = await this.plan.webSearch(request.query, request.signal)
        const sources = extractSourcesFromResponses(response, request.maxSources ?? 8)
        if (sources.length) return { query: request.query, sources, searchedAt: new Date().toISOString(), providerNote: 'ChatGPT Plan Web Search' }
        reason = 'ChatGPT Plan web search returned no sources'
        // Diagnostic only (item types/counts, no content): tells "model did not search" from "search without sources".
        const items = ((response as { output?: Array<{ type?: string; action?: { sources?: unknown[] } }> }).output ?? [])
          .map((o) => `${o.type}${o.action?.sources ? `(${o.action.sources.length})` : ''}`)
        console.warn(`[web-search] plan response items: ${items.join(',') || 'none'}`)
      } catch (error) {
        const code = (error as { code?: string }).code
        const timedOut = (error as { name?: string }).name === 'TimeoutError' && !request.signal?.aborted
        if (!timedOut && code !== 'CHATGPT_UNSUPPORTED_CAPABILITY' && code !== 'CHATGPT_PLAN_UNAVAILABLE') throw error
        reason = timedOut ? 'ChatGPT Plan web search timed out' : `ChatGPT Plan web search unavailable (${code})`
      }
    }
    // Degraded path: never silent. The note travels with the result so the UI/agents can flag it.
    console.warn(`[web-search] degraded: ${reason}; using keyless fallback for "${request.query.slice(0, 80)}"`)
    const result = await createWebSearchProvider(false).search(request)
    return { ...result, providerNote: `degraded fallback (${reason}) · ${result.providerNote ?? 'keyless search'}` }
  }
}
