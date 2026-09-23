/**
 * Canonical Task Planning — single SoT for user / routine / system sources.
 * Source is metadata only; it must not change the planning algorithm.
 */

import type {
  Agent,
  ArtifactType,
  CodexMode,
  ExecutionMode,
  ProjectType,
  StepProvider,
  WorkflowKind,
} from '../types'
import type { AgentCapability, CapabilityCoverage } from '../capabilities'
import {
  computeCapabilityCoverage,
  detectCapabilityConflicts,
  deriveAgentCapabilities,
} from '../capabilities'
import {
  getTemplateById,
  type WorkflowRoleKey,
} from '../workflowTemplates'
import {
  previewLabels,
  resolveTemplateToSteps,
  selectWorkflowTemplate,
  type ResolvedTemplateStep,
} from '../templateSelector'
import {
  normalizeStepDefsWithSafety,
  resolveSafetyAgents,
  SAFETY_CHAIN,
  type StepDefLike,
} from '../safetyPipeline'

export const PLANNING_VERSION = 1 as const

export type TaskSourceType = 'user' | 'routine' | 'system'

export interface TaskPlanningSource {
  type: TaskSourceType
  routineId?: string
  routineRunId?: string
}

export interface TaskPlanningRequest {
  project: {
    id: string
    type: ProjectType
    name?: string
  }
  /** Free-text request used for template selection + small-scope heuristics */
  request: string
  source: TaskPlanningSource
  preferredTemplateId?: string
  preferredAgentId?: string
  /** Extra required caps (e.g. Routine.requiredCapabilities) — merged with template */
  requiredCapabilities?: AgentCapability[]
  team: Agent[]
  registry: Agent[]
  executionMode?: ExecutionMode
  /** Attachment presence — informational; does not force a complex workflow */
  attachmentHints?: {
    hasImages?: boolean
    hasDocuments?: boolean
    hasCodeFiles?: boolean
    hasGithub?: boolean
    hasLocalFolder?: boolean
    hasWebUrl?: boolean
    summary?: string
  }
}

export interface TaskPlanProviderConflict {
  stepKey: string
  templateProvider: StepProvider
  resolvedProvider: StepProvider
  toolId?: string
  message: string
}

export interface TaskPlanStep {
  key?: string
  label: string
  agentId: string
  role?: WorkflowRoleKey | string
  provider?: StepProvider
  mode?: CodexMode
  approvalKind?: 'plan' | 'change'
  outputArtifactType?: ArtifactType | string
  inputArtifactTypes?: Array<ArtifactType | string>
  requiresWebSearch?: boolean
  requiredCapabilities?: AgentCapability[]
  capabilityConflicts?: Array<{
    capability: AgentCapability
    code: string
    message: string
  }>
  assignmentSource?: 'core-team' | 'specialist'
  /** Template provider before tool-resolver binding (diagnostic) */
  templateProvider?: StepProvider
  providerConflict?: TaskPlanProviderConflict
}

export interface TaskPlanAgentAssignment {
  agentId: string
  role?: string
  source: 'core-team' | 'specialist' | 'fallback'
}

export interface TaskPlan {
  planningVersion: typeof PLANNING_VERSION
  workflowTemplateId: string
  workflowTemplateVersion: number
  workflowKind: WorkflowKind
  steps: TaskPlanStep[]
  /** role → agentId (template role assignments) */
  agentRoleAssignments: Record<string, string>
  agentAssignments: TaskPlanAgentAssignment[]
  requiredCapabilities: AgentCapability[]
  capabilityCoverage: CapabilityCoverage
  capabilityConflicts: Array<{
    capability: AgentCapability
    code: string
    message: string
  }>
  providerConflicts: TaskPlanProviderConflict[]
  safety: {
    applied: boolean
    chainKeys: string[]
  }
  preview: string[]
  rationale: string
  /** Metadata only — must not affect steps/agents */
  source: TaskPlanningSource
  executionMode?: ExecutionMode
}

function uniqueCaps(caps: AgentCapability[]): AgentCapability[] {
  return [...new Set(caps)]
}

function toStepDef(s: ResolvedTemplateStep): StepDefLike & {
  templateStepKey?: string
  templateProvider?: StepProvider
  providerConflict?: TaskPlanProviderConflict
  requiredCapabilities?: AgentCapability[]
  capabilityConflicts?: ResolvedTemplateStep['capabilityConflicts']
  assignmentSource?: ResolvedTemplateStep['assignmentSource']
} {
  return {
    agentId: s.agentId,
    label: s.label,
    provider: s.provider,
    mode: s.mode,
    role: s.role,
    templateStepKey: s.key,
    approvalKind: s.approvalKind,
    outputArtifactType: s.outputArtifactType as ArtifactType | undefined,
    inputArtifactTypes: s.inputArtifactTypes as ArtifactType[] | undefined,
    requiresWebSearch: s.requiresWebSearch,
    templateProvider: s.templateProvider,
    providerConflict: s.providerConflict,
    requiredCapabilities: s.requiredCapabilities,
    capabilityConflicts: s.capabilityConflicts,
    assignmentSource: s.assignmentSource,
  }
}

/**
 * Canonical planning path (source-agnostic):
 * Request → Template → Caps → Agents → Tools → Safety → TaskPlan
 */
export function planTask(input: TaskPlanningRequest): TaskPlan {
  const hintLine = input.attachmentHints?.summary?.trim()
  const requestText = [input.request.trim(), hintLine].filter(Boolean).join('\n')
  const preferred =
    (input.preferredTemplateId
      ? getTemplateById(input.preferredTemplateId)
      : undefined) ?? undefined

  const selection = preferred
    ? {
        template: preferred,
        confidence: 1,
        rationale: `명시적 템플릿: ${preferred.nameKo}`,
      }
    : selectWorkflowTemplate({
        request: requestText,
        projectType: input.project.type,
        preferredTemplateId: input.preferredTemplateId,
      })

  const template = selection.template
  const resolved = resolveTemplateToSteps({
    template,
    request: requestText,
    team: input.team,
    registry: input.registry,
  })

  const templateCaps = uniqueCaps(
    template.steps.flatMap((s) => s.requiredCapabilities ?? []),
  )
  const requiredCapabilities = uniqueCaps([
    ...templateCaps,
    ...(input.requiredCapabilities ?? []),
  ])

  const assignedBase = [...new Set(resolved.steps.map((s) => s.agentId))]
  let stepDefs = resolved.steps.map(toStepDef)

  const safetyAgents = resolveSafetyAgents({
    assignedAgentIds: assignedBase.length
      ? assignedBase
      : stepDefs.map((s) => s.agentId),
    steps: stepDefs,
    registryIds: input.registry.map((a) => a.id),
  })
  const beforeLen = stepDefs.length
  stepDefs = normalizeStepDefsWithSafety(stepDefs, safetyAgents)
  const hasImplement = resolved.steps.some(
    (s) => s.provider === 'codex' && s.mode === 'implement',
  )
  const safetyApplied = hasImplement && stepDefs.length >= beforeLen

  const planSteps: TaskPlanStep[] = stepDefs.map((s, i) => {
    const fromResolved = resolved.steps.find(
      (r) => r.key === s.templateStepKey || r.label === s.label,
    )
    return {
      key: s.templateStepKey ?? `step_${i + 1}`,
      label: s.label,
      agentId: s.agentId,
      role: s.role,
      provider: s.provider,
      mode: s.mode,
      approvalKind: s.approvalKind,
      outputArtifactType: s.outputArtifactType,
      inputArtifactTypes: s.inputArtifactTypes,
      requiresWebSearch: s.requiresWebSearch,
      requiredCapabilities:
        s.requiredCapabilities ?? fromResolved?.requiredCapabilities,
      capabilityConflicts:
        s.capabilityConflicts ?? fromResolved?.capabilityConflicts,
      assignmentSource:
        s.assignmentSource ?? fromResolved?.assignmentSource,
      templateProvider: s.templateProvider ?? fromResolved?.templateProvider,
      providerConflict: s.providerConflict ?? fromResolved?.providerConflict,
    }
  })

  const profiles = [
    ...input.team,
    ...input.registry.filter((a) => assignedBase.includes(a.id)),
  ].map((a) => deriveAgentCapabilities(a))

  // Coverage against assigned agents first; fall back to full team+used specialists
  const assignedProfiles = planSteps
    .map((s) => {
      const agent =
        input.team.find((a) => a.id === s.agentId) ??
        input.registry.find((a) => a.id === s.agentId)
      return agent ? deriveAgentCapabilities(agent) : null
    })
    .filter(Boolean) as ReturnType<typeof deriveAgentCapabilities>[]

  const capabilityCoverage = computeCapabilityCoverage(
    requiredCapabilities,
    assignedProfiles.length ? assignedProfiles : profiles,
  )

  const stepConflicts = planSteps.flatMap((s) => s.capabilityConflicts ?? [])
  const mergeConflicts = detectCapabilityConflicts({
    required: requiredCapabilities,
    agent: null,
  }).filter((c) => capabilityCoverage.missing.includes(c.capability))

  // Prefer step-level messages; add missing merged caps not already listed
  const capabilityConflicts = [
    ...stepConflicts,
    ...mergeConflicts.filter(
      (c) => !stepConflicts.some((s) => s.capability === c.capability),
    ),
  ]

  const providerConflicts = planSteps
    .map((s) => s.providerConflict)
    .filter(Boolean) as TaskPlanProviderConflict[]

  const agentAssignments: TaskPlanAgentAssignment[] = []
  const seen = new Set<string>()
  for (const s of planSteps) {
    if (seen.has(s.agentId)) continue
    seen.add(s.agentId)
    const onTeam = input.team.some((a) => a.id === s.agentId)
    agentAssignments.push({
      agentId: s.agentId,
      role: s.role,
      source: s.assignmentSource
        ? s.assignmentSource === 'core-team'
          ? 'core-team'
          : 'specialist'
        : onTeam
          ? 'core-team'
          : 'specialist',
    })
  }

  const previewSteps: ResolvedTemplateStep[] = planSteps.map((s) => ({
    key: s.key ?? s.label,
    label: s.label,
    agentId: s.agentId,
    role: (s.role as WorkflowRoleKey) ?? 'planner',
    provider: s.provider ?? 'openai',
    mode: s.mode,
    approvalKind: s.approvalKind,
    outputArtifactType: s.outputArtifactType as never,
    inputArtifactTypes: s.inputArtifactTypes as never,
    requiresWebSearch: s.requiresWebSearch,
  }))

  return {
    planningVersion: PLANNING_VERSION,
    workflowTemplateId: template.id,
    workflowTemplateVersion: template.version,
    workflowKind: template.workflowKind,
    steps: planSteps,
    agentRoleAssignments: { ...resolved.assignments },
    agentAssignments,
    requiredCapabilities,
    capabilityCoverage,
    capabilityConflicts,
    providerConflicts,
    safety: {
      applied: safetyApplied,
      chainKeys: hasImplement ? SAFETY_CHAIN.map((c) => c.key) : [],
    },
    preview: previewLabels(previewSteps),
    rationale: selection.rationale,
    source: { ...input.source },
    executionMode: input.executionMode,
  }
}

/** Comparable fingerprint for Manual vs Routine determinism fixtures (excludes source). */
export function planFingerprint(plan: TaskPlan): string {
  return JSON.stringify({
    planningVersion: plan.planningVersion,
    workflowTemplateId: plan.workflowTemplateId,
    workflowTemplateVersion: plan.workflowTemplateVersion,
    workflowKind: plan.workflowKind,
    steps: plan.steps.map((s) => ({
      key: s.key,
      label: s.label,
      agentId: s.agentId,
      role: s.role,
      provider: s.provider,
      mode: s.mode,
      approvalKind: s.approvalKind,
      requiresWebSearch: s.requiresWebSearch,
      requiredCapabilities: s.requiredCapabilities,
      capabilityConflicts: s.capabilityConflicts,
    })),
    agentRoleAssignments: plan.agentRoleAssignments,
    requiredCapabilities: plan.requiredCapabilities,
    capabilityCoverage: plan.capabilityCoverage,
    capabilityConflicts: plan.capabilityConflicts,
    providerConflicts: plan.providerConflicts,
    safety: plan.safety,
    preview: plan.preview,
  })
}
