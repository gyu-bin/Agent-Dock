import { displayAgentName, specialtyFragments } from './agentNames'

/** Display-layer Korean descriptions. Registry English text stays unchanged. */
const EXACT: Record<string, string> = {
  'agents-orchestrator':
    '여러 에이전트의 작업 흐름을 조율하고, 전체 파이프라인이 끊기지 않게 관리합니다.',
  'trend-researcher':
    '시장·경쟁·트렌드를 조사해 기회와 위험을 빠르게 정리합니다.',
  'product-manager':
    '제품 전략과 로드맵을 잡고, 무엇을 먼저 만들지 우선순위를 정합니다.',
  'feedback-synthesizer':
    '사용자 피드백을 모아 실행 가능한 제품 인사이트로 요약합니다.',
  'sprint-prioritizer':
    '스프린트 범위를 정하고 기능을 우선순위에 따라 배치합니다.',
  'game-designer':
    '게임 규칙·루프·밸런스를 설계해 재미와 진행감을 만듭니다.',
  'level-designer':
    '스테이지·공간·난이도 곡선을 설계해 플레이 흐름을 만듭니다.',
  'narrative-designer':
    '스토리·대사·세계관을 설계해 플레이어 경험을 연결합니다.',
  'technical-artist':
    '아트와 엔진 사이를 잇고, 비주얼 파이프라인·셰이더·툴을 다룹니다.',
  'ui-designer':
    '화면 구성과 시각 시스템을 설계해 쓰기 쉬운 UI를 만듭니다.',
  'ux-researcher':
    '사용자 행동·사용성을 조사하고, 개선에 필요한 인사이트를 제공합니다.',
  'frontend-developer':
    '웹 UI를 구현하고 성능·접근성·인터랙션을 책임집니다.',
  'backend-architect':
    'API·데이터·서버 구조를 설계해 확장 가능한 백엔드를 만듭니다.',
  'mobile-app-builder':
    '모바일 앱을 구현하고 플랫폼별 이슈를 해결합니다.',
  'code-reviewer':
    '코드 품질·버그·설계 문제를 검토하고 개선점을 제안합니다.',
  'reality-checker':
    '계획이 실제로 실행 가능한지 근거를 기준으로 점검합니다.',
  'api-tester':
    'API 동작을 검증하고 오류·성능·계약 준수 여부를 확인합니다.',
  'content-creator':
    '채널별 콘텐츠와 메시지를 기획·작성해 전달력을 높입니다.',
  'growth-hacker':
    '실험을 통해 유입·전환·성장을 빠르게 찾아냅니다.',
  'brand-guardian':
    '브랜드 톤·비주얼·메시지를 일관되게 지킵니다.',
  'devops-automator':
    '배포·인프라·CI/CD를 자동화해 안정적인 운영을 돕습니다.',
  'app-store-optimizer':
    '스토어 노출·전환을 높이기 위한 ASO와 메타데이터를 최적화합니다.',
  'account-strategist':
    '주요 고객 계정의 전략·포지셔닝·확장 계획을 세웁니다.',
  'accessibility-auditor':
    '접근성 문제를 점검하고, 더 많은 사용자가 쓸 수 있게 개선점을 제시합니다.',
  'evidence-collector':
    '검증에 필요한 근거·로그·데이터를 모아 판단 자료를 만듭니다.',
  'rapid-prototyper':
    '아이디어를 빠르게 프로토타입으로 만들어 검증 속도를 높입니다.',
  'studio-producer':
    '여러 프로젝트를 조율하고 일정·리소스·우선순위를 맞춥니다.',
  'bilibili-content-strategist':
    '빌리빌리 채널에 맞춘 콘텐츠·포맷·발행 전략으로 도달과 참여를 끌어올립니다.',
  'carousel-growth-engine':
    '캐러셀·피드형 콘텐츠로 그로스 실험을 돌리며 유입과 전환을 높입니다.',
  'book-co-author':
    '긴 글·북형 콘텐츠를 함께 기획·집필해 메시지를 깊이 있게 전달합니다.',
  'douyin-strategist':
    '더우인 숏폼 포맷·트렌드에 맞춘 콘텐츠 전략으로 바이럴과 전환을 노립니다.',
  'instagram-curator':
    '인스타 피드·스토리·릴스 구성을 큐레이션해 브랜드 도달을 키웁니다.',
  'baidu-seo-specialist':
    '바이두 검색 노출을 위한 SEO·키워드·콘텐츠 최적화를 담당합니다.',
  'email-marketing-strategist':
    '이메일 캠페인·시퀀스·카피로 리텐션과 전환을 설계합니다.',
  'global-podcast-strategist':
    '팟캐스트 포맷·에피소드 기획으로 글로벌 오디언스 도달을 돕습니다.',
}

type RoleKind =
  | 'orchestrate'
  | 'research'
  | 'design'
  | 'build'
  | 'market'
  | 'quality'
  | 'ops'
  | 'product'
  | 'generic'

const ROLE_PATTERNS: Array<[RegExp, RoleKind]> = [
  [/orchestrat|coordinator|pipeline|producer/, 'orchestrate'],
  [/accessibility|a11y|security|threat|vuln|test|qa|quality|auditor|review|reality|evidence/, 'quality'],
  [/research|anthropolog|synthes|analyst/, 'research'],
  [/market|growth|seo|content|ad |ads|brand|carousel|podcast|email|instagram|tiktok|douyin|bilibili|youtube/, 'market'],
  [/design|visual|creative|ui |ux /, 'design'],
  [/devops|sre|infra|deploy/, 'ops'],
  [/product|manager|priorit|strategist/, 'product'],
  [/frontend|backend|mobile|developer|engineer|builder|api|platform|architect/, 'build'],
]

const ROLE_TAIL: Record<RoleKind, string> = {
  orchestrate: '여러 작업을 조율하고 전체 흐름이 원활히 돌아가게 합니다.',
  research: '조사·분석으로 의사결정에 쓸 인사이트를 만듭니다.',
  design: '디자인과 사용자 경험을 설계해 완성도를 높입니다.',
  build: '구현과 기술 문제를 해결하는 개발 역할입니다.',
  market: '도달·전환·성장을 목표로 채널 맞춤 실행을 돕습니다.',
  quality: '품질·리스크를 점검하고 개선 근거를 제공합니다.',
  ops: '배포·인프라·운영을 안정적으로 돌리는 일을 맡습니다.',
  product: '제품 방향과 우선순위를 정해 팀이 같은 목표로 움직이게 합니다.',
  generic: '관련 업무를 맡아 프로젝트 목표 달성을 돕습니다.',
}

function looksKorean(text: string): boolean {
  return /[가-힣]/.test(text)
}

function detectRole(hay: string): RoleKind {
  for (const [re, kind] of ROLE_PATTERNS) {
    if (re.test(hay)) return kind
  }
  return 'generic'
}

/**
 * User-facing Korean description for an agent.
 * Always tries to surface what makes THIS agent different from siblings.
 */
export function displayAgentDescription(
  id: string,
  name: string,
  fallbackDescription: string,
  divisionLabel?: string,
): string {
  if (EXACT[id]) return EXACT[id]

  const hay = `${id} ${name}`.toLowerCase()
  const role = detectRole(hay)
  const fragments = specialtyFragments(id, name)
  const tail = ROLE_TAIL[role]

  if (fragments.length > 0) {
    const focus = fragments.join('·')
    if (role === 'market') {
      return `${focus}에 특화해 ${tail}`
    }
    if (role === 'research') {
      return `${focus} 관점으로 ${tail}`
    }
    if (role === 'build' || role === 'design' || role === 'quality' || role === 'ops') {
      return `${focus} 중심으로 ${tail}`
    }
    return `${focus} — ${tail}`
  }

  if (fallbackDescription && looksKorean(fallbackDescription)) {
    return fallbackDescription
  }

  // Keep English specialty visible when we lack tokens, so siblings don't look identical.
  const label = displayAgentName(id, name)
  if (name && name !== label && /[A-Za-z]/.test(name)) {
    return `${name} — ${tail}`
  }

  const dept = divisionLabel ? `${divisionLabel} 부서의 ` : ''
  return `${dept}${label} 역할입니다. ${tail}`
}
