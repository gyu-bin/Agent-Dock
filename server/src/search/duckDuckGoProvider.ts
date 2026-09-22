/**
 * Lightweight DuckDuckGo HTML search — real web results without OpenAI credits.
 * Used as fallback when OpenAI Responses web_search is unavailable (quota).
 * Still returns only provider-fetched URLs (never model-invented).
 */
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

export class DuckDuckGoHtmlWebSearchProvider implements WebSearchProvider {
  readonly id = 'duckduckgo-html'
  readonly label = 'DuckDuckGo HTML (fallback)'

  isAvailable(): boolean {
    return true
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const maxSources = request.maxSources ?? 8
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(request.query)}`
    const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
      redirect: 'follow',
    })
    if (!res.ok) {
      throw Object.assign(
        new Error(`웹 검색 실패: DuckDuckGo HTTP ${res.status}`),
        { status: 502, code: 'WEB_SEARCH_FAILED' },
      )
    }
    const html = await res.text()
    const sources = parseDuckDuckGoHtml(html, maxSources)
    if (sources.length === 0) {
      throw Object.assign(
        new Error('웹 검색 실패: DuckDuckGo 결과가 비었습니다.'),
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

function parseDuckDuckGoHtml(html: string, max: number): WebSource[] {
  const sources: WebSource[] = []
  // result links: <a rel="nofollow" class="result__a" href="...">
  const re =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)/gi
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = re.exec(html)) && sources.length < max) {
    let href = decodeHtml(m[1] ?? '')
    // DDG sometimes wraps redirects
    const uddg = href.match(/[?&]uddg=([^&]+)/)
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1])
      } catch {
        /* keep */
      }
    }
    if (!/^https?:\/\//i.test(href)) continue
    if (/duckduckgo\.com/i.test(href)) continue
    const title = stripTags(decodeHtml(m[2] ?? '')).trim()
    const snippet = sanitizeWebSnippet(stripTags(decodeHtml(m[3] ?? '')))
    const domain = domainFromUrl(href)
    sources.push({
      id: makeSourceId(href, idx++),
      title: title || domain || href,
      url: href,
      domain,
      snippet,
      quality: inferSourceQuality(domain),
    })
  }

  // Fallback simpler pattern
  if (sources.length === 0) {
    const simple = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    while ((m = simple.exec(html)) && sources.length < max) {
      let href = decodeHtml(m[1] ?? '')
      const uddg = href.match(/[?&]uddg=([^&]+)/)
      if (uddg) {
        try {
          href = decodeURIComponent(uddg[1])
        } catch {
          /* keep */
        }
      }
      if (!/^https?:\/\//i.test(href) || /duckduckgo\.com/i.test(href)) continue
      const title = stripTags(decodeHtml(m[2] ?? '')).trim()
      const domain = domainFromUrl(href)
      sources.push({
        id: makeSourceId(href, idx++),
        title: title || domain,
        url: href,
        domain,
        quality: inferSourceQuality(domain),
      })
    }
  }

  return dedupeSources(sources).slice(0, max)
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ')
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
}
