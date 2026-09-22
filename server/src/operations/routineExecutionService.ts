/**
 * Unified Routine execution — bridges RoutineRun → Task via Canonical Planner.
 * Scheduler and manual run share this path. No AI reasoning here.
 * No minimal/seeded pipeline — same planTask SoT as client createAndStartTask.
 */

import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  OperationsService,
  StartRoutineRunInput,
  StartRoutineRunResult,
} from '../persistence/operationsService.js'
import type { ProjectService } from '../persistence/projectService.js'
import type {
  StoredPipelineStep,
  StoredProject,
  StoredTask,
} from '../persistence/types.js'
import type { StoredRoutineRun } from '../persistence/operationsTypes.js'
import { loadAgentRegistry } from '../registry/loadAgents.js'
import type { AgentRecord } from '../types.js'
import type { MarketingService } from '../marketing/marketingService.js'

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

type PlannerModule = {
  planTask: (input: {
    project: { id: string; type: string; name?: string }
    request: string
    source: {
      type: 'user' | 'routine' | 'system'
      routineId?: string
      routineRunId?: string
    }
    preferredTemplateId?: string
    preferredAgentId?: string
    requiredCapabilities?: string[]
    team: AgentRecord[]
    registry: AgentRecord[]
    executionMode?: 'MOCK' | 'REAL_AI'
  }) => {
    planningVersion: number
    workflowTemplateId: string
    workflowTemplateVersion: number
    workflowKind: StoredTask['workflow']
    steps: Array<{
      key?: string
      label: string
      agentId: string
      role?: string
      provider?: StoredPipelineStep['provider']
      mode?: StoredPipelineStep['mode']
      approvalKind?: 'plan' | 'change'
      outputArtifactType?: string
      inputArtifactTypes?: string[]
      requiresWebSearch?: boolean
    }>
    agentRoleAssignments: Record<string, string>
    preview: string[]
    safety: { applied: boolean; chainKeys: string[] }
    source: {
      type: 'user' | 'routine' | 'system'
      routineId?: string
      routineRunId?: string
    }
    capabilityConflicts: Array<{ capability: string; code: string; message: string }>
  }
  materializeTaskFromPlan: (input: {
    plan: ReturnType<PlannerModule['planTask']>
    taskId: string
    projectId: string
    title: string
    description: string
    now: string
    priority?: StoredTask['priority']
    preferredAgentId?: string
    executionMode?: 'MOCK' | 'REAL_AI'
  }) => {
    task: StoredTask & { planningVersion?: number }
    steps: StoredPipelineStep[]
  }
}

let plannerPromise: Promise<PlannerModule> | null = null

function loadCanonicalPlanner(): Promise<PlannerModule> {
  if (!plannerPromise) {
    // Dynamic path keeps client domain as SoT without server tsc rootDir pull-in.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const plannerPath = path.resolve(
      here,
      '../../../client/src/domain/taskPlanning/index.ts',
    )
    plannerPromise = import(pathToFileURL(plannerPath).href) as Promise<PlannerModule>
  }
  return plannerPromise
}

function toClientAgent(a: AgentRecord): AgentRecord {
  return a
}

export class RoutineExecutionService {
  constructor(
    private readonly operations: OperationsService,
    private readonly projects: ProjectService | null = null,
    private readonly marketing: MarketingService | null = null,
  ) {}

  async start(
    input: StartRoutineRunInput,
  ): Promise<StartRoutineRunResult & { task?: StoredTask; plan?: unknown }> {
    const result = await this.operations.startRoutineRun(input)
    if (!result.created || !result.taskSeed || !this.projects) {
      return result
    }

    const seed = result.taskSeed
    const shouldCreateTask =
      input.triggerSource === 'manual' ||
      seed.autoStart ||
      seed.needsWriteApproval

    if (!shouldCreateTask) {
      return result
    }

    const max = seed.maxTasksPerRun
    if (result.run.taskIds.length > max) {
      return result
    }

    const snap = await this.projects.getSnapshot()
    const project = snap.projects.find(
      (p) => p.id === result.routine.projectId,
    )
    if (!project) {
      return result
    }

    const registryResult = await loadAgentRegistry()
    const registry = registryResult.agents.map(toClientAgent)
    const teamIds = new Set([
      ...(input.teamAgentIds ?? project.agentIds ?? []),
    ])
    const team = registry.filter((a) => teamIds.has(a.id))
    // Ensure declared team ids exist even if registry is mock-subset
    for (const tid of teamIds) {
      if (!team.some((a) => a.id === tid)) {
        team.push({
          id: tid,
          name: tid,
          division: 'product',
          description: '',
          status: 'idle',
          enabled: true,
        })
      }
    }
    for (const sid of input.specialistCandidates ?? seed.specialistAgentIds) {
      if (!registry.some((a) => a.id === sid)) {
        registry.push({
          id: sid,
          name: sid,
          division: 'marketing',
          description: '',
          status: 'idle',
          enabled: true,
        })
      }
    }

    const { planTask, materializeTaskFromPlan } = await loadCanonicalPlanner()

    const requestText = `${seed.title}\n${seed.description}`.trim()
    const plan = planTask({
      project: {
        id: project.id,
        type: project.type,
        name: project.name,
      },
      request: requestText,
      source: seed.source,
      preferredTemplateId: seed.workflowTemplateId,
      preferredAgentId: input.preferredAgentId,
      requiredCapabilities: seed.requiredCapabilities as never,
      team: team as never,
      registry: registry as never,
      executionMode: 'MOCK',
    })

    const taskId = result.run.taskIds[0] ?? id('task')
    const now = (input.now ?? new Date()).toISOString()
    const { task: planned, steps } = materializeTaskFromPlan({
      plan: plan as never,
      taskId,
      projectId: project.id,
      title: seed.title,
      description: seed.description,
      now,
      preferredAgentId: input.preferredAgentId,
      executionMode: 'MOCK',
    })

    const task: StoredTask = {
      ...planned,
      source: seed.source,
      planningVersion: plan.planningVersion,
    }

    await this.projects.appendWork({
      tasks: [task],
      pipelineSteps: steps,
    })

    if (!result.run.taskIds.includes(taskId)) {
      await this.operations.attachTaskToRun(
        result.routine.projectId,
        result.run.id,
        taskId,
      )
    }

    // Approval is not failure — if safety chain includes change approval after implement,
    // leave run running/queued until Task engine hits awaiting_approval; reconcile later.
    const hasWriteSafety =
      plan.safety.applied ||
      plan.steps.some(
        (s) =>
          (s.provider === 'codex' && s.mode === 'implement') ||
          (s.provider === 'human' && s.approvalKind === 'change'),
      )

    if (seed.needsWriteApproval || hasWriteSafety) {
      // Keep RoutineRun aligned: write work still goes through approval without bypass
      if (result.run.status === 'queued' || result.run.status === 'running') {
        // Do not mark awaiting until Task is awaiting — start as running
        await this.operations.updateRunStatus(
          result.routine.projectId,
          result.run.id,
          { status: 'running' },
        )
        result.run.status = 'running'
      }
    } else if (result.run.status === 'queued') {
      await this.operations.updateRunStatus(
        result.routine.projectId,
        result.run.id,
        { status: 'running' },
      )
      result.run.status = 'running'
    }

    // WEEKLY_MARKETING / marketing templates → same MarketingService as manual
    if (
      this.marketing &&
      (result.routine.templateId === 'WEEKLY_MARKETING' ||
        result.routine.workflowTemplateId === 'MARKETING_CAMPAIGN')
    ) {
      try {
        await this.marketing.runCampaign({
          projectId: result.routine.projectId,
          title: `[Routine] ${result.routine.name}`,
          objective: 'awareness',
          request: result.routine.description,
          goalId: result.routine.goalId,
          routineId: result.routine.id,
          routineRunId: result.run.id,
          taskId,
          teamAgentIds: input.teamAgentIds,
          specialistAgentIds: seed.specialistAgentIds,
          now: input.now,
          // Routine fixture path: allow without live search unless sources provided later
          allowWithoutSearch: true,
          searchAvailable: false,
          fixtureSources: [],
        })
      } catch (err) {
        console.warn('[agent-deck] marketing campaign from routine failed', err)
      }
    }

    return { ...result, task, plan }
  }

  async reconcileProject(projectId: string): Promise<StoredRoutineRun[]> {
    if (!this.projects) return []
    const board = await this.operations.getBoard(projectId)
    const snap = await this.projects.getSnapshot()
    const projectTasks = snap.tasks.filter((t) => t.projectId === projectId)
    const updated: StoredRoutineRun[] = []

    for (const run of board.runs) {
      if (
        run.status === 'completed' ||
        run.status === 'failed' ||
        run.status === 'cancelled' ||
        run.status === 'blocked'
      ) {
        continue
      }
      const patch = this.operations.reconcileRunFromTasks(run, projectTasks)
      if (patch.status && patch.status !== run.status) {
        const next = await this.operations.updateRunStatus(
          projectId,
          run.id,
          patch,
        )
        updated.push(next)
      }
    }
    return updated
  }

  isProjectRunnable(project: StoredProject | undefined): boolean {
    if (!project) return false
    if (project.status === 'completed') return false
    return true
  }
}
