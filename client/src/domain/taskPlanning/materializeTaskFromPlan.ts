/**
 * Materialize a TaskPlan into persistence-friendly task + pipeline entities.
 * Shared shape usable by client store and server RoutineExecutionService.
 */

import type { TaskPlan } from './canonicalTaskPlanner'

export interface MaterializedTask {
  id: string
  projectId: string
  title: string
  description: string
  status: 'queued'
  workflow: TaskPlan['workflowKind']
  priority: 'low' | 'normal' | 'high' | 'urgent'
  assignedAgentIds: string[]
  recommendedExtraAgentIds: string[]
  preferredAgentId?: string
  progress: number
  createdAt: string
  updatedAt: string
  executionMode?: 'MOCK' | 'REAL_AI'
  workflowTemplateId: string
  workflowTemplateVersion: number
  workflowPreview: string[]
  agentRoleAssignments: Record<string, string>
  source?: TaskPlan['source']
  planningVersion: number
}

export interface MaterializedPipelineStep {
  id: string
  taskId: string
  agentId: string
  order: number
  label: string
  status: 'queued'
  provider?: TaskPlan['steps'][number]['provider']
  mode?: TaskPlan['steps'][number]['mode']
  role?: string
  templateStepKey?: string
  approvalKind?: 'plan' | 'change'
  outputArtifactType?: string
  inputArtifactTypes?: string[]
  requiresWebSearch?: boolean
}

export function materializeTaskFromPlan(input: {
  plan: TaskPlan
  taskId: string
  projectId: string
  title: string
  description: string
  now: string
  priority?: MaterializedTask['priority']
  preferredAgentId?: string
  executionMode?: 'MOCK' | 'REAL_AI'
}): { task: MaterializedTask; steps: MaterializedPipelineStep[] } {
  const { plan, taskId } = input
  const assignedAgentIds = [
    ...new Set(plan.steps.map((s) => s.agentId)),
  ]

  const task: MaterializedTask = {
    id: taskId,
    projectId: input.projectId,
    title: input.title.trim(),
    description: input.description.trim(),
    status: 'queued',
    workflow: plan.workflowKind,
    priority: input.priority ?? 'normal',
    assignedAgentIds,
    recommendedExtraAgentIds: [],
    preferredAgentId: input.preferredAgentId,
    progress: 0,
    createdAt: input.now,
    updatedAt: input.now,
    executionMode: input.executionMode ?? plan.executionMode,
    workflowTemplateId: plan.workflowTemplateId,
    workflowTemplateVersion: plan.workflowTemplateVersion,
    workflowPreview: plan.preview,
    agentRoleAssignments: plan.agentRoleAssignments,
    source: plan.source,
    planningVersion: plan.planningVersion,
  }

  const steps: MaterializedPipelineStep[] = plan.steps.map((s, i) => ({
    id: `${taskId}_step_${i + 1}`,
    taskId,
    agentId: s.agentId,
    order: i + 1,
    label: s.label,
    status: 'queued',
    provider: s.provider,
    mode: s.mode,
    role: s.role,
    templateStepKey: s.key,
    approvalKind: s.approvalKind,
    outputArtifactType: s.outputArtifactType
      ? String(s.outputArtifactType)
      : undefined,
    inputArtifactTypes: s.inputArtifactTypes?.map(String),
    requiresWebSearch: s.requiresWebSearch,
  }))

  return { task, steps }
}
