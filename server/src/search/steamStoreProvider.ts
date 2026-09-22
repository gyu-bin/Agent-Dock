/**
 * Steam Store public API — real URLs for game/market research.
 * Used as fallback when OpenAI web_search is unavailable.
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

export class SteamStoreWebSearchProvider implements WebSearchProvider {
  readonly id = 'steam-store-api'
  readonly label = 'Steam Store API (fallback)'

  isAvailable(): boolean {
    return true
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const maxSources = request.maxSources ?? 8
    const term = extractSteamTerm(request.query)
    const sources: WebSource[] = []
    let idx = 0

    // 1) Store search
    try {
      const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`
      const res = await fetch(searchUrl, {
        headers: { Accept: 'application/json' },
      })
      if (res.ok) {
        const data = (await res.json()) as {
          items?: Array<{
            id?: number
            name?: string
            tiny_image?: string
            price?: { final?: number }
          }>
        }
        for (const item of data.items ?? []) {
          if (!item.id || !item.name) continue
          const url = `https://store.steampowered.com/app/${item.id}`
          const domain = domainFromUrl(url)
          sources.push({
            id: makeSourceId(url, idx++),
            title: item.name,
            url,
            domain,
            snippet: sanitizeWebSnippet(`Steam store listing for ${item.name}`),
            quality: inferSourceQuality(domain),
          })
          if (sources.length >= maxSources) break
        }
      }
    } catch {
      /* continue */
    }

    // 2) Featured / specials for trend context
    if (sources.length < 3) {
      try {
        const featUrl =
          'https://store.steampowered.com/api/featuredcategories/?l=english&cc=US'
        const res = await fetch(featUrl, {
          headers: { Accept: 'application/json' },
        })
        if (res.ok) {
          const data = (await res.json()) as Record<
            string,
            {
              id?: string
              name?: string
              items?: Array<{
                id?: number | string
                name?: string
                url?: string
                header_image?: string
              }>
            }
          >
          for (const cat of Object.values(data)) {
            if (!cat || typeof cat !== 'object' || !cat.items) continue
            for (const item of cat.items) {
              const url =
                item.url ||
                (item.id
                  ? `https://store.steampowered.com/app/${item.id}`
                  : null)
              if (!url || !/^https?:\/\//i.test(url)) continue
              const domain = domainFromUrl(url)
              sources.push({
                id: makeSourceId(url, idx++),
                title:
                  item.name ||
                  `${cat.name ?? 'Steam'} — ${String(item.id ?? '')}`,
                url,
                domain,
                snippet: sanitizeWebSnippet(
                  `Steam featured category: ${cat.name ?? cat.id ?? 'store'}`,
                ),
                quality: inferSourceQuality(domain),
              })
              if (sources.length >= maxSources) break
            }
            if (sources.length >= maxSources) break
          }
        }
      } catch {
        /* continue */
      }
    }

    const deduped = dedupeSources(sources).slice(0, maxSources)
    if (deduped.length === 0) {
      throw Object.assign(
        new Error('웹 검색 실패: Steam Store 결과가 비었습니다.'),
        { status: 502, code: 'WEB_SEARCH_FAILED' },
      )
    }

    return {
      query: request.query,
      sources: deduped,
      searchedAt: new Date().toISOString(),
      providerNote: this.label,
    }
  }
}

function extractSteamTerm(query: string): string {
  const cleaned = query
    .replace(/\b20\d{2}\b/g, '')
    .replace(/트렌드|조사|최근|요즘|시장|분석/g, '')
    .replace(/\b(trend|trends|research|recent|market|analysis)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length >= 3) return cleaned.slice(0, 80)
  if (/co-?op|협동/i.test(query)) return 'co-op indie'
  if (/indie|인디/i.test(query)) return 'indie'
  return 'indie game'
}
