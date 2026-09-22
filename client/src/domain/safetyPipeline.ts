import type {
  CodexMode,
  PipelineStep,
  StepProvider,
} from './types'

/** System-enforced post-IMPLEMENT chain — LLM cannot omit these. */
export const SAFETY_CHAIN: ReadonlyArray<{
  key: 'approval' | 'verify' | 'review' | 'reality'
  label: string
  provider: StepProvider
  mode?: CodexMode
  approvalKind?: 'plan' | 'change'
}> = [
  {
    key: 'approval',
    label: '변경 승인',
    provider: 'human',
    approvalKind: 'change',
  },
  { key: 'verify', label: '검증', provider: 'codex', mode: 'verify' },
  { key: 'review', label: '코드 리뷰', provider: 'codex', mode: 'review' },
  { key: 'reality', label: '현실성 검증', provider: 'openai' },
] as const

export interface StepDefLike {
  agentId: string
  label: string
  provider?: StepProvider
  mode?: CodexMode
  role?: string
  templateStepKey?: string
  approvalKind?: 'plan' | 'change'
  outputArtifactType?: import('./types').ArtifactType
  inputArtifactTypes?: import('./types').ArtifactType[]
  requiresWebSearch?: boolean
}

function isImplement(s: { provider?: StepProvider; mode?: CodexMode }): boolean {
  return s.provider === 'codex' && s.mode === 'implement'
}

function matchesSafety(
  s: {
    provider?: StepProvider
    mode?: CodexMode
    label?: string
    approvalKind?: 'plan' | 'change'
    agentId?: string
  },
  key: (typeof SAFETY_CHAIN)[number]['key'],
): boolean {
  if (key === 'approval') {
    if (s.provider !== 'human') return false
    if (s.approvalKind === 'plan') return false
    if (/계획\s*승인|plan\s*approval/i.test(s.label ?? '')) return false
    return true
  }
  if (key === 'verify') return s.provider === 'codex' && s.mode === 'verify'
  if (key === 'review') return s.provider === 'codex' && s.mode === 'review'
  if (key === 'reality') {
    return (
      s.provider === 'openai' &&
      (/현실|reality|최종 검토/i.test(s.label ?? '') ||
        (typeof s.agentId === 'string' && s.agentId.includes('reality')))
    )
  }
  return false
}

/**
 * At task creation: if any Codex IMPLEMENT exists, force
 * … → IMPLEMENT → APPROVAL → VERIFY → REVIEW → REALITY
 * after the (last) implement step. Preceding steps kept.
 */
export function normalizeStepDefsWithSafety(
  defs: StepDefLike[],
  fallbackAgents: {
    approval: string
    verify: string
    review: string
    reality: string
  },
): StepDefLike[] {
  const implIdx = defs.findIndex(isImplement)
  if (implIdx < 0) return defs

  const before = defs.slice(0, implIdx + 1)
  const after = defs.slice(implIdx + 1)

  const pick = (key: (typeof SAFETY_CHAIN)[number]['key']): string => {
    const found = after.find((s) => matchesSafety(s, key))
    if (found) return found.agentId
    return fallbackAgents[key]
  }

  const safety: StepDefLike[] = SAFETY_CHAIN.map((c) => ({
    agentId: pick(c.key),
    label: c.label,
    provider: c.provider,
    mode: c.mode,
    approvalKind: c.approvalKind,
  }))

  return [...before, ...safety]
}

/**
 * Runtime (after IMPLEMENT completes): rewrite incomplete steps after implement
 * so the safety chain is guaranteed regardless of Orchestrator plan.
 */
export function ensureSafetyPipelineAfterImplement(input: {
  taskId: string
  steps: PipelineStep[]
  implementStepId: string
  agents: {
    approval: string
    verify: string
    review: string
    reality: string
  }
}): PipelineStep[] {
  const sorted = [...input.steps].sort((a, b) => a.order - b.order)
  const impl = sorted.find((s) => s.id === input.implementStepId)
  if (!impl) return input.steps

  const kept = sorted.filter(
    (s) => s.order <= impl.order || s.status === 'completed',
  )
  // Drop incomplete post-implement steps (LLM-optional extras)
  const discarded = sorted.filter(
    (s) => s.order > impl.order && s.status !== 'completed',
  )

  const pick = (key: (typeof SAFETY_CHAIN)[number]['key']): string => {
    const found = discarded.find((s) => matchesSafety(s, key))
    if (found) return found.agentId
    // Prefer agents from kept completed steps of similar role
    const fromKept = sorted.find((s) => matchesSafety(s, key))
    if (fromKept) return fromKept.agentId
    return input.agents[key]
  }

  let order = impl.order
  const safetySteps: PipelineStep[] = SAFETY_CHAIN.map((c) => {
    order += 1
    // Reuse step id if an incomplete matching step existed
    const reused = discarded.find((s) => matchesSafety(s, c.key))
    return {
      id: reused?.id ?? `${input.taskId}_safety_${c.key}`,
      taskId: input.taskId,
      agentId: pick(c.key),
      order,
      label: c.label,
      status: 'queued' as const,
      provider: c.provider,
      mode: c.mode,
      approvalKind: c.approvalKind,
      startedAt: undefined,
      completedAt: undefined,
    }
  })

  return [...kept.filter((s) => s.order <= impl.order), ...safetySteps]
}

export function resolveSafetyAgents(input: {
  assignedAgentIds: string[]
  steps: Array<{ agentId: string; provider?: StepProvider; mode?: CodexMode; label?: string }>
  registryIds?: string[]
}): {
  approval: string
  verify: string
  review: string
  reality: string
} {
  const pool = [
    ...input.assignedAgentIds,
    ...input.steps.map((s) => s.agentId),
    ...(input.registryIds ?? []),
  ]
  const prefer = (candidates: string[], fallback: string) => {
    for (const id of candidates) {
      if (pool.includes(id)) return id
    }
    return pool[0] ?? fallback
  }

  const fromSteps = (pred: (s: (typeof input.steps)[0]) => boolean) =>
    input.steps.find(pred)?.agentId

  return {
    approval:
      fromSteps((s) => s.provider === 'human') ??
      prefer(['product-manager', 'studio-producer'], 'product-manager'),
    verify:
      fromSteps((s) => s.provider === 'codex' && s.mode === 'verify') ??
      prefer(['devops-automator', 'code-reviewer', 'api-tester'], 'code-reviewer'),
    review:
      fromSteps((s) => s.provider === 'codex' && s.mode === 'review') ??
      prefer(['code-reviewer'], 'code-reviewer'),
    reality:
      fromSteps(
        (s) =>
          s.provider === 'openai' && /현실|reality/i.test(s.label ?? ''),
      ) ?? prefer(['reality-checker'], 'reality-checker'),
  }
}
