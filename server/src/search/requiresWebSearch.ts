/**
 * Heuristic: should this step use Web Search?
 * Not every agent searches — research/market/trend/marketing only when the request needs fresh info.
 */

const SEARCH_CAPABLE_AGENT =
  /trend-researcher|market-researcher|research|growth-hacker|marketing|content-creator|app-store|competitive|analyst|synthesist/i

const SEARCH_CAPABLE_ROLE =
  /researcher|marketing|trend|market|competitive|growth/i

const SEARCH_NEED_REQUEST =
  /(?:최근|요즘|현재|최신|today|recent|current|202[4-9]|203\d|트렌드|trend|시장|market|경쟁|competitor|steam|조사|research|분석해|조사해|찾아줘|news|뉴스)/i

const SEARCH_NEVER_REQUEST =
  /(?:코드 리뷰|code review|리팩터|refactor|버그 수정|bug fix|typecheck|lint|이 프로젝트|현재 프로젝트|diff|rollback|구현해|implement this)/i

export function agentCanUseWebSearch(input: {
  agentId: string
  role?: string
  stepLabel?: string
}): boolean {
  if (SEARCH_CAPABLE_AGENT.test(input.agentId)) return true
  if (input.role && SEARCH_CAPABLE_ROLE.test(input.role)) return true
  if (input.stepLabel && /리서치|조사|trend|market|research|마케팅/i.test(input.stepLabel))
    return true
  return false
}

export function requestNeedsWebSearch(userRequest: string): boolean {
  const text = userRequest.trim()
  if (!text) return false
  if (SEARCH_NEVER_REQUEST.test(text) && !SEARCH_NEED_REQUEST.test(text)) {
    return false
  }
  return SEARCH_NEED_REQUEST.test(text)
}

/**
 * Final gate: step flag OR (capable agent AND request needs freshness).
 */
export function resolveRequiresWebSearch(input: {
  requiresWebSearch?: boolean
  agentId: string
  role?: string
  stepLabel?: string
  userRequest: string
  /** Downstream agents that already received a research artifact should skip */
  skipBecausePriorResearch?: boolean
}): boolean {
  if (input.skipBecausePriorResearch) return false
  if (input.requiresWebSearch === true) return true
  if (input.requiresWebSearch === false) return false
  if (!agentCanUseWebSearch(input)) return false
  return requestNeedsWebSearch(input.userRequest)
}
