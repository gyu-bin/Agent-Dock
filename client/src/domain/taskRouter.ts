import type { Agent, DivisionId, ProjectType, WorkflowKind } from './types'
import { providerForRoleKey } from './providerRouting'

export interface RouterRoleNeed {
  key: string
  label: string
  preferredDivisions: DivisionId[]
  preferredNameHints: string[]
  stepLabel: string
  speech: string
}

export interface RouteResult {
  workflow: WorkflowKind
  roles: RouterRoleNeed[]
  confidence: number
  rationale: string
}

export interface TaskRouter {
  classify(input: {
    title: string
    description?: string
    projectType?: ProjectType
  }): RouteResult
}

const ROLE = {
  researcher: {
    key: 'researcher',
    label: '리서처',
    preferredDivisions: ['research'] as DivisionId[],
    preferredNameHints: ['trend', 'research', 'synthesist'],
    stepLabel: '시장 / 주제 조사',
    speech: '시장 조사 중...',
  },
  product: {
    key: 'product',
    label: '프로덕트',
    preferredDivisions: ['product'] as DivisionId[],
    preferredNameHints: ['product', 'strategist', 'manager'],
    stepLabel: '요구사항 정리',
    speech: '요구사항 정리 중...',
  },
  gameDesigner: {
    key: 'game-designer',
    label: '게임 디자이너',
    preferredDivisions: ['game-development'] as DivisionId[],
    preferredNameHints: ['game-designer', 'game designer', 'narrative'],
    stepLabel: '코어 루프 설계',
    speech: '게임 구조 설계 중...',
  },
  ux: {
    key: 'ux',
    label: 'UX 리서처',
    preferredDivisions: ['design', 'research'] as DivisionId[],
    preferredNameHints: ['ux', 'user-research', 'researcher'],
    stepLabel: 'UX 조사',
    speech: 'UX 조사 중...',
  },
  ui: {
    key: 'ui',
    label: 'UI 디자이너',
    preferredDivisions: ['design'] as DivisionId[],
    preferredNameHints: ['ui-designer', 'ui', 'visual', 'brand'],
    stepLabel: 'UI 디자인',
    speech: 'UI 시안 작업 중...',
  },
  engineer: {
    key: 'engineer',
    label: '엔지니어',
    preferredDivisions: ['engineering'] as DivisionId[],
    preferredNameHints: [
      'frontend',
      'backend',
      'mobile',
      'developer',
      'engineer',
      'builder',
    ],
    stepLabel: '구현',
    speech: '코드 구현 중...',
  },
  reviewer: {
    key: 'reviewer',
    label: '코드 리뷰어',
    preferredDivisions: ['engineering', 'testing'] as DivisionId[],
    preferredNameHints: ['code-reviewer', 'review', 'auditor'],
    stepLabel: '코드 리뷰',
    speech: '코드 리뷰 중...',
  },
  reality: {
    key: 'reality',
    label: '현실성 검증',
    preferredDivisions: ['testing'] as DivisionId[],
    preferredNameHints: ['reality', 'qa', 'tester'],
    stepLabel: '현실성 검증',
    speech: '결과 검토 중...',
  },
  marketing: {
    key: 'marketing',
    label: '마케팅',
    preferredDivisions: ['marketing'] as DivisionId[],
    preferredNameHints: ['marketing', 'growth', 'strategist'],
    stepLabel: '마케팅 전략',
    speech: '출시 전략 분석 중...',
  },
  content: {
    key: 'content',
    label: '콘텐츠',
    preferredDivisions: ['marketing'] as DivisionId[],
    preferredNameHints: ['content', 'copy', 'writer'],
    stepLabel: '콘텐츠 작성',
    speech: '콘텐츠 작성 중...',
  },
  release: {
    key: 'release',
    label: '출시',
    preferredDivisions: ['marketing', 'project-management', 'engineering'] as DivisionId[],
    preferredNameHints: ['app-store', 'release', 'devops', 'launch'],
    stepLabel: '출시 준비',
    speech: '출시 준비 점검 중...',
  },
  planner: {
    key: 'planner',
    label: '플래너',
    preferredDivisions: ['product', 'project-management'] as DivisionId[],
    preferredNameHints: ['sprint', 'prioritizer', 'orchestrator', 'manager'],
    stepLabel: '계획 / 범위',
    speech: '계획 수립 중...',
  },
  approval: {
    key: 'approval',
    label: '승인',
    preferredDivisions: ['product', 'project-management'] as DivisionId[],
    preferredNameHints: ['product-manager', 'orchestrator', 'manager'],
    stepLabel: '변경 승인',
    speech: '승인 대기…',
  },
  verifier: {
    key: 'verifier',
    label: '검증',
    preferredDivisions: ['testing', 'engineering'] as DivisionId[],
    preferredNameHints: ['reality', 'qa', 'tester', 'devops', 'code-reviewer'],
    stepLabel: '검증',
    speech: '검증 실행 중…',
  },
} satisfies Record<string, RouterRoleNeed>

function workflowRoles(kind: WorkflowKind): RouterRoleNeed[] {
  switch (kind) {
    case 'GAME_IDEA':
      return [ROLE.researcher, ROLE.gameDesigner, ROLE.product, ROLE.reality]
    case 'IDEA':
      return [ROLE.researcher, ROLE.product, ROLE.reality]
    case 'RESEARCH':
      return [ROLE.researcher, ROLE.product]
    case 'PLAN':
      return [ROLE.planner, ROLE.product, ROLE.reality]
    case 'DESIGN':
      return [ROLE.ux, ROLE.ui, ROLE.engineer, ROLE.reality]
    case 'BUILD':
      return [
        ROLE.planner,
        ROLE.engineer,
        ROLE.approval,
        ROLE.verifier,
        ROLE.reviewer,
        ROLE.reality,
      ]
    case 'REVIEW':
      return [ROLE.reviewer, ROLE.reality]
    case 'MARKETING':
      return [ROLE.researcher, ROLE.marketing, ROLE.content, ROLE.reality]
    case 'RELEASE':
      return [ROLE.release, ROLE.marketing, ROLE.reality]
    default:
      return [ROLE.product, ROLE.reality]
  }
}

/**
 * @deprecated Harden-0: DeterministicTaskRouter is compatibility / test isolation only.
 * Canonical planning SoT = WorkflowTemplate (+ Agent Matching + Safety Pipeline).
 * Do not use this class to build production pipelines.
 */
export class DeterministicTaskRouter implements TaskRouter {
  classify(input: {
    title: string
    description?: string
    projectType?: ProjectType
  }): RouteResult {
    const text = `${input.title} ${input.description ?? ''}`.toLowerCase()
    const type = input.projectType

    const has = (...parts: string[]) => parts.some((p) => text.includes(p.toLowerCase()))

    const isGameContext =
      type === 'steam-game' ||
      type === 'mobile-game' ||
      has('steam', 'game', '게임')

    let workflow: WorkflowKind = 'IDEA'
    let rationale = 'Default IDEA workflow'

    if (
      has('release', 'launch', '출시', 'production', '배포') ||
      (has('steam page', '스토어') && has('ready', '준비', 'check', '점검'))
    ) {
      workflow = 'RELEASE'
      rationale = 'Matched release / launch language'
    } else if (
      has('marketing', '마케팅', 'content', '콘텐츠', 'wishlist', '키워드') ||
      has('steam page')
    ) {
      workflow = 'MARKETING'
      rationale = 'Matched marketing / content language'
    } else if (has('review', 'inspect', 'audit', '리뷰', '점검', '검토')) {
      workflow = 'REVIEW'
      rationale = 'Matched review / audit language'
    } else if (
      has('bug', 'implement', 'build', 'code', '코딩', '구현', '개발', 'fix')
    ) {
      workflow = 'BUILD'
      rationale = 'Matched build / implement language'
    } else if (has('ui', 'ux', 'design', '디자인', '화면', 'layout')) {
      workflow = 'DESIGN'
      rationale = 'Matched UI / design language'
    } else if (has('plan', 'roadmap', '계획', '스프린트', 'scope')) {
      workflow = 'PLAN'
      rationale = 'Matched planning language'
    } else if (isGameContext && has('idea', '아이디어', 'concept', '컨셉', '조사', 'research')) {
      workflow = 'GAME_IDEA'
      rationale = 'Game context + idea/research language'
    } else if (has('research', '조사', '분석', 'trend', '시장')) {
      workflow = isGameContext ? 'GAME_IDEA' : 'RESEARCH'
      rationale = isGameContext
        ? 'Research in game project → GAME_IDEA'
        : 'Matched research language'
    } else if (has('idea', '아이디어')) {
      workflow = isGameContext ? 'GAME_IDEA' : 'IDEA'
      rationale = 'Matched idea language'
    }

    return {
      workflow,
      roles: workflowRoles(workflow),
      confidence: 0.85,
      rationale,
    }
  }
}

export function scoreAgentForRole(agent: Agent, role: RouterRoleNeed): number {
  let score = 0
  const id = agent.id.toLowerCase()
  const name = agent.name.toLowerCase()
  const hay = `${id} ${name} ${agent.description.toLowerCase()}`

  if (role.preferredDivisions.includes(agent.division)) score += 40
  for (const hint of role.preferredNameHints) {
    const h = hint.toLowerCase()
    if (id === h || id === h.replace(/\s+/g, '-')) score += 100
    else if (id.includes(h.replace(/\s+/g, '-'))) score += 50
    else if (name.includes(h)) score += 35
    else if (hay.includes(h)) score += 12
  }
  return score
}

export interface AssignmentResult {
  assignedAgentIds: string[]
  recommendedExtraAgentIds: string[]
  steps: Array<{
    agentId: string
    label: string
    speech: string
    roleKey: string
    inTeam: boolean
    provider?: import('./types').StepProvider
    mode?: import('./types').CodexMode
  }>
}

/** Prefer project team; missing roles become recommendations (team not auto-mutated). */
export function assignAgentsForRoute(
  route: RouteResult,
  teamAgents: Agent[],
  registry: Agent[],
  preferredAgentId?: string,
): AssignmentResult {
  const used = new Set<string>()
  const steps: AssignmentResult['steps'] = []
  const recommendedExtraAgentIds: string[] = []

  const pool = preferredAgentId
    ? [
        ...teamAgents.filter((a) => a.id === preferredAgentId),
        ...teamAgents.filter((a) => a.id !== preferredAgentId),
      ]
    : teamAgents

  for (const role of route.roles) {
    let best: Agent | null = null
    let bestScore = 0

    // Human approval gate — always assign a team agent (no AI call).
    if (role.key === 'approval') {
      best = pool.find((a) => !used.has(a.id)) ?? pool[0] ?? null
      bestScore = best ? 100 : 0
    } else {
      for (const agent of pool) {
        if (used.has(agent.id)) continue
        const s = scoreAgentForRole(agent, role)
        if (s > bestScore) {
          bestScore = s
          best = agent
        }
      }
    }

    if (best && bestScore >= 40) {
      used.add(best.id)
      const routed = providerForRoleKey(role.key, route.workflow)
      steps.push({
        agentId: best.id,
        label: role.stepLabel,
        speech: role.speech,
        roleKey: role.key,
        inTeam: true,
        provider: routed.provider,
        mode: routed.mode,
      })
      continue
    }

    // Look in full registry for recommendation only
    let rec: Agent | null = null
    let recScore = 0
    for (const agent of registry) {
      if (used.has(agent.id)) continue
      const s = scoreAgentForRole(agent, role)
      if (s > recScore) {
        recScore = s
        rec = agent
      }
    }
    if (rec && recScore >= 40) {
      recommendedExtraAgentIds.push(rec.id)
      // Skip pipeline step until team includes them — do not auto-add
    }
  }

  // Cap — BUILD needs up to 6 steps
  const maxSteps = route.workflow === 'BUILD' ? 6 : 5
  const capped = steps.slice(0, Math.min(maxSteps, Math.max(2, steps.length)))
  return {
    assignedAgentIds: capped.map((s) => s.agentId),
    recommendedExtraAgentIds: [...new Set(recommendedExtraAgentIds)],
    steps: capped,
  }
}

export function createDefaultTaskRouter(): TaskRouter {
  return new DeterministicTaskRouter()
}
