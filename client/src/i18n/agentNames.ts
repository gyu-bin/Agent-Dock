/** Display-layer Korean names. Registry id/name unchanged. */

const EXACT: Record<string, string> = {
  'agents-orchestrator': '오케스트레이터',
  'trend-researcher': '트렌드 리서처',
  'game-designer': '게임 디자이너',
  'level-designer': '레벨 디자이너',
  'narrative-designer': '내러티브 디자이너',
  'technical-artist': '테크니컬 아티스트',
  'ui-designer': 'UI 디자이너',
  'ux-researcher': 'UX 리서처',
  'frontend-developer': '프론트엔드 개발자',
  'backend-architect': '백엔드 아키텍트',
  'mobile-app-builder': '모바일 앱 빌더',
  'code-reviewer': '코드 리뷰어',
  'reality-checker': '현실성 검증',
  'product-manager': '프로덕트 매니저',
  'api-tester': 'API 테스터',
  'growth-hacker': '그로스 해커',
  'content-creator': '콘텐츠 크리에이터',
  'brand-guardian': '브랜드 가디언',
  'devops-automator': 'DevOps 자동화',
  'rapid-prototyper': '래피드 프로토타이퍼',
  'app-store-optimizer': '앱스토어 최적화',
  'bilibili-content-strategist': '빌리빌리 콘텐츠 전략',
  'carousel-growth-engine': '캐러셀 그로스',
  'book-co-author': '북 공동저자',
  'douyin-strategist': '더우인 전략',
  'instagram-curator': '인스타 큐레이터',
  'baidu-seo-specialist': '바이두 SEO',
  'email-marketing-strategist': '이메일 마케팅',
  'global-podcast-strategist': '팟캐스트 전략',
}

/** Specialty tokens → Korean fragments (order matters for title assembly). */
export const SPECIALTY_TOKENS: Array<[RegExp, string]> = [
  [/bilibili/, '빌리빌리'],
  [/douyin/, '더우인'],
  [/tiktok/, '틱톡'],
  [/instagram|insta/, '인스타'],
  [/youtube/, '유튜브'],
  [/baidu/, '바이두'],
  [/wechat/, '위챗'],
  [/linkedin/, '링크드인'],
  [/twitter|x\.com/, 'X(트위터)'],
  [/podcast/, '팟캐스트'],
  [/carousel/, '캐러셀'],
  [/email/, '이메일'],
  [/seo/, 'SEO'],
  [/aso|app.?store/, '앱스토어'],
  [/china|localization|cross.?border/, '중화권·크로스보더'],
  [/e-?commerce|ecommerce/, '이커머스'],
  [/healthcare/, '헬스케어'],
  [/citation|aeo|agentic.?search/, 'AI 검색·인용'],
  [/growth/, '그로스'],
  [/content/, '콘텐츠'],
  [/brand/, '브랜드'],
  [/ads?|paid.?media|performance/, '광고'],
  [/social/, '소셜'],
  [/video|short.?form|reel/, '숏폼·영상'],
  [/book|author|writer|copy/, '콘텐츠 작성'],
  [/strategist|strategy/, '전략'],
  [/optimizer|optimisation|optimization/, '최적화'],
  [/researcher|research|analyst/, '리서치'],
  [/designer|design/, '디자인'],
  [/engineer|developer|builder/, '개발'],
  [/tester|qa|auditor/, '검증'],
  [/manager|producer|orchestrat|coordinator/, '운영·조율'],
]

const COARSE: Array<[RegExp, string]> = [
  [/frontend/, '프론트엔드 개발자'],
  [/backend/, '백엔드 개발자'],
  [/mobile/, '모바일 개발자'],
  [/designer/, '디자이너'],
  [/developer|engineer|builder/, '개발자'],
  [/research/, '리서처'],
  [/test|qa|reality/, '테스터'],
  [/product|manager/, '프로덕트'],
  [/review/, '리뷰어'],
]

export function specialtyFragments(id: string, name: string): string[] {
  const hay = `${id} ${name}`.toLowerCase()
  const out: string[] = []
  const seen = new Set<string>()
  for (const [re, ko] of SPECIALTY_TOKENS) {
    if (!re.test(hay) || seen.has(ko)) continue
    seen.add(ko)
    out.push(ko)
    if (out.length >= 3) break
  }
  return out
}

/** Compact Korean title from specialty tokens, or null if too thin. */
export function specialtyTitle(id: string, name: string): string | null {
  const parts = specialtyFragments(id, name)
  if (parts.length >= 2) return parts.slice(0, 3).join(' ')
  if (parts.length === 1 && parts[0]!.length >= 3) return parts[0]!
  return null
}

export function displayAgentName(id: string, fallbackName: string): string {
  if (EXACT[id]) return EXACT[id]

  const specialty = specialtyTitle(id, fallbackName)
  if (specialty) return specialty

  // Prefer the distinctive registry title over coarse buckets like "마케터".
  if (fallbackName.trim() && /[A-Za-z]/.test(fallbackName) && /\s|-/.test(fallbackName)) {
    return fallbackName
  }

  const lower = id.toLowerCase()
  for (const [re, label] of COARSE) {
    if (re.test(lower)) return label
  }
  return fallbackName
}
