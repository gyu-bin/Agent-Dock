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
    if (this.configured()) {
      try {
        const response = await this.plan.webSearch(request.query, request.signal)
        const sources = extractSourcesFromResponses(response, request.maxSources ?? 8)
        if (sources.length) return { query: request.query, sources, searchedAt: new Date().toISOString(), providerNote: 'ChatGPT Plan Web Search' }
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code !== 'CHATGPT_UNSUPPORTED_CAPABILITY' && code !== 'CHATGPT_PLAN_UNAVAILABLE') throw error
      }
    }
    return createWebSearchProvider(false).search(request)
  }
}
