import type { Agent, DivisionId, ProjectType } from './types'
import type {
  WorkflowRoleKey,
  WorkflowTemplate,
  WorkflowTemplateStep,
} from './workflowTemplates'
import { WORKFLOW_TEMPLATES } from './workflowTemplates'

const ROLE_HINTS: Record<
  WorkflowRoleKey,
  { divisions: DivisionId[]; nameHints: string[] }
> = {
  researcher: {
    divisions: ['research'],
    nameHints: ['trend', 'research', 'synthesist', 'market'],
  },
  product: {
    divisions: ['product'],
    nameHints: ['product', 'manager', 'strategist', 'producer'],
  },
  ux: {
    divisions: ['design', 'research'],
    nameHints: ['ux', 'user-research', 'researcher'],
  },
  ui: {
    divisions: ['design'],
    nameHints: ['ui', 'visual', 'brand', 'designer'],
  },
  'game-designer': {
    divisions: ['game-development'],
    nameHints: ['game-designer', 'game', 'narrative'],
  },
  engineer: {
    divisions: ['engineering'],
    nameHints: ['developer', 'engineer', 'architect', 'builder'],
  },
  frontend: {
    divisions: ['engineering'],
    nameHints: ['frontend', 'developer', 'rapid-prototyper', 'fullstack'],
  },
  reviewer: {
    divisions: ['engineering', 'testing'],
    nameHints: ['code-reviewer', 'review', 'auditor'],
  },
  reality: {
    divisions: ['testing'],
    nameHints: ['reality', 'qa', 'tester'],
  },
  planner: {
    divisions: ['product', 'project-management'],
    nameHints: ['product', 'planner', 'manager'],
  },
  analyst: {
    divisions: ['research', 'engineering'],
    nameHints: ['analyst', 'research', 'developer', 'engineer'],
  },
  human: {
    divisions: ['product', 'project-management'],
    nameHints: ['product-manager', 'studio-producer', 'manager'],
  },
  marketing: {
    divisions: ['marketing'],
    nameHints: ['growth', 'marketing', 'app-store', 'optimizer'],
  },
  content: {
    divisions: ['marketing'],
    nameHints: ['content', 'creator', 'copy', 'writer'],
  },
}

function scoreRole(agent: Agent, role: WorkflowRoleKey): number {
  const hints = ROLE_HINTS[role]
  let score = 0
  const id = agent.id.toLowerCase()
  const name = agent.name.toLowerCase()
  if (hints.divisions.includes(agent.division)) score += 40
  for (const h of hints.nameHints) {
    const needle = h.toLowerCase()
    if (id === needle || id === needle.replace(/\s+/g, '-')) score += 100
    else if (id.includes(needle.replace(/\s+/g, '-'))) score += 50
    else if (name.includes(needle)) score += 35
  }
  return score
}

/** Team first, then full registry. Human role prefers product-manager. */
export function matchAgentForRole(input: {
  role: WorkflowRoleKey
  team: Agent[]
  registry: Agent[]
  usedIds: Set<string>
}): Agent | null {
  if (input.role === 'human') {
    const prefer = ['product-manager', 'studio-producer']
    for (const pool of [input.team, input.registry]) {
      for (const id of prefer) {
        const hit = pool.find((a) => a.id === id && !input.usedIds.has(a.id))
        if (hit) return hit
      }
      const any = pool.find((a) => !input.usedIds.has(a.id))
      if (any) return any
    }
    return null
  }

  for (const pool of [input.team, input.registry]) {
    let best: Agent | null = null
    let bestScore = 0
    for (const agent of pool) {
      if (input.usedIds.has(agent.id)) continue
      const s = scoreRole(agent, input.role)
      if (s > bestScore) {
        bestScore = s
        best = agent
      }
    }
    if (best && bestScore >= 35) return best
  }
  // Last resort: first unused team/registry agent
  return (
    input.team.find((a) => !input.usedIds.has(a.id)) ??
    input.registry.find((a) => !input.usedIds.has(a.id)) ??
    null
  )
}

export function isSmallScopeRequest(text: string): boolean {
  const t = text.toLowerCase()
  // Meaningful product work is never "tiny" even if the sentence is short
  if (
    /ux|ui|개선|프로토타입|prototype|홈\s*화면|게임|리서치|research|기능\s*개발|대규모|전체|아키텍처|리팩터/.test(
      t,
    )
  ) {
    return false
  }
  if (t.length < 40) return true
  if (/한\s*줄|작은|tiny|quick|간단|문구|typo|오타|rename/.test(t)) return true
  return false
}

export function selectWorkflowTemplate(input: {
  request: string
  projectType?: ProjectType
  preferredTemplateId?: string
}): { template: WorkflowTemplate; confidence: number; rationale: string } {
  if (input.preferredTemplateId) {
    const hit = WORKFLOW_TEMPLATES.find((t) => t.id === input.preferredTemplateId)
    if (hit) {
      return {
        template: hit,
        confidence: 1,
        rationale: `명시적 템플릿: ${hit.nameKo}`,
      }
    }
  }

  const text = input.request.toLowerCase()
  let best: WorkflowTemplate | null = null
  let bestScore = 0
  const reasons: string[] = []

  for (const tpl of WORKFLOW_TEMPLATES) {
    const typeOk =
      tpl.supportedProjectTypes.includes('*') ||
      (input.projectType
        ? tpl.supportedProjectTypes.includes(input.projectType)
        : true)
    if (!typeOk) continue

    let score = 0
    for (const intent of tpl.intents) {
      if (text.includes(intent.toLowerCase())) {
        score += intent.length >= 4 ? 3 : 2
        reasons.push(`${tpl.id}:${intent}`)
      }
    }
    // Project-type boost
    if (
      input.projectType &&
      tpl.supportedProjectTypes.includes(input.projectType) &&
      tpl.id === 'GAME_PROTOTYPE'
    ) {
      score += 2
    }
    if (score > bestScore) {
      bestScore = score
      best = tpl
    }
  }

  if (!best || bestScore === 0) {
    // Default: feature build for build-ish, else research
    best =
      WORKFLOW_TEMPLATES.find((t) => t.id === 'FEATURE_BUILD') ??
      WORKFLOW_TEMPLATES[0]
    return {
      template: best,
      confidence: 0.4,
      rationale: '기본 템플릿(기능 개발) — 의도 매칭 약함',
    }
  }

  return {
    template: best,
    confidence: Math.min(1, bestScore / 6),
    rationale: `${best.nameKo} 선택 (score=${bestScore})`,
  }
}

export interface ResolvedTemplateStep {
  key: string
  label: string
  agentId: string
  role: WorkflowRoleKey
  provider: WorkflowTemplateStep['provider']
  mode?: WorkflowTemplateStep['mode']
  approvalKind?: 'plan' | 'change'
  outputArtifactType?: WorkflowTemplateStep['outputArtifactType']
  inputArtifactTypes?: WorkflowTemplateStep['inputArtifactTypes']
  requiresWebSearch?: boolean
}

export function resolveTemplateToSteps(input: {
  template: WorkflowTemplate
  request: string
  team: Agent[]
  registry: Agent[]
}): {
  steps: ResolvedTemplateStep[]
  assignments: Record<string, string>
  skippedKeys: string[]
} {
  const small = isSmallScopeRequest(input.request)
  const used = new Set<string>()
  const steps: ResolvedTemplateStep[] = []
  const assignments: Record<string, string> = {}
  const skippedKeys: string[] = []

  for (const s of input.template.steps) {
    if (!s.required && small) {
      skippedKeys.push(s.key)
      continue
    }
    if (s.skipIfSmall && small) {
      skippedKeys.push(s.key)
      continue
    }

    const agent = matchAgentForRole({
      role: s.role,
      team: input.team,
      registry: input.registry,
      usedIds: used,
    })
    // Allow reuse for human / reviewer roles across steps
    const agentId =
      agent?.id ??
      input.team[0]?.id ??
      input.registry[0]?.id ??
      'product-manager'

    if (agent && s.role !== 'human' && s.role !== 'reviewer') {
      used.add(agent.id)
    } else if (agent) {
      used.add(agent.id)
    }

    assignments[s.role] = agentId
    steps.push({
      key: s.key,
      label: s.label,
      agentId,
      role: s.role,
      provider: s.provider,
      mode: s.mode,
      approvalKind:
        s.approvalPolicy === 'plan'
          ? 'plan'
          : s.approvalPolicy === 'change' ||
              s.approvalPolicy === 'auto-if-no-changes'
            ? 'change'
            : undefined,
      outputArtifactType: s.outputArtifactType,
      inputArtifactTypes: s.inputArtifactTypes,
      requiresWebSearch: s.requiresWebSearch,
    })
  }

  return { steps, assignments, skippedKeys }
}

/** Soften internal approval wording for the default preview surface. */
function previewStepLabel(label: string): string {
  return label
    .replace(/변경 승인/g, '변경 확인')
    .replace(/계획 승인/g, '계획 확인')
    .trim()
}

export function previewLabels(steps: ResolvedTemplateStep[]): string[] {
  return steps.map((s, i) => `${i + 1}. ${previewStepLabel(s.label)}`)
}
