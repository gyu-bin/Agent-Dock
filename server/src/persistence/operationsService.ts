import { randomBytes } from 'node:crypto'
import type { OperationsRepository } from './operationsTypes.js'
import {
  DEFAULT_POLICY,
  type OperationsStoreSnapshot,
  type ProjectGoalType,
  type ProjectStage,
  type RoutineTriggerSource,
  type StoredProjectGoal,
  type StoredProjectRoutine,
  type StoredRoutineRun,
  type StoredRoutineRunAssignment,
  type StoredRoutineSchedule,
} from './operationsTypes.js'
import {
  calculateNextRun,
  getDueRoutines,
  getMostRecentOccurrence,
  isCatchUp,
  occurrenceKey,
} from '../operations/scheduleUtils.js'
import {
  preflightRoutineCapabilities,
  shouldAutoStartTasks,
  workflowImpliesWrite,
} from '../operations/capabilityPreflight.js'

export {
  calculateNextRun,
  getDueRoutines,
  getMostRecentOccurrence,
  isCatchUp,
  occurrenceKey,
} from '../operations/scheduleUtils.js'

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString()
}

const TEMPLATES: Record<
  string,
  {
    name: string
    description: string
    requiredCapabilities: string[]
    futureCapabilities: string[]
    workflowTemplateId?: string
    schedule: StoredRoutineSchedule
  }
> = {
  WEEKLY_MARKETING: {
    name: '주간 마케팅',
    description:
      '조사 → 전략 → 콘텐츠. 게시/분석은 Tool 연결 후 활성화됩니다.',
    requiredCapabilities: [
      'research.web',
      'marketing.research',
      'marketing.plan',
      'marketing.content',
    ],
    futureCapabilities: [
      'image.generate',
      'social.publish',
      'analytics.read',
    ],
    workflowTemplateId: 'MARKETING_CAMPAIGN',
    schedule: {
      kind: 'weekly',
      daysOfWeek: [1],
      time: '09:00',
      timezone: 'Asia/Seoul',
    },
  },
  COMPETITOR_RESEARCH: {
    name: '경쟁사 조사',
    description: '시장/경쟁 리서치 → Research Artifact',
    requiredCapabilities: [
      'research.web',
      'research.analyze',
      'research.synthesize',
      'document.write',
    ],
    futureCapabilities: [],
    workflowTemplateId: 'RESEARCH_TO_BUILD',
    schedule: {
      kind: 'weekly',
      daysOfWeek: [3],
      time: '10:00',
      timezone: 'Asia/Seoul',
    },
  },
}

export interface RoutineTaskSeed {
  title: string
  description: string
  workflowTemplateId?: string
  requiredCapabilities: string[]
  missingCapabilities: string[]
  optionalUnavailable: string[]
  specialistAgentIds: string[]
  requireApprovalForWrite: boolean
  requireApprovalForExternalAction: boolean
  maxTasksPerRun: number
  autoStart: boolean
  needsWriteApproval: boolean
  source: {
    type: 'routine'
    routineId: string
    routineRunId: string
  }
}

export interface StartRoutineRunInput {
  routineId: string
  projectId?: string
  triggerSource: RoutineTriggerSource
  scheduledFor?: string
  taskId?: string
  teamAgentIds?: string[]
  specialistCandidates?: string[]
  preferredAgentId?: string
  now?: Date
  /** When false, only create RoutineRun (no taskIds reserved for create). Default true for queued runs. */
  reserveTaskId?: boolean
  /** Skip creating a new run if occurrence already exists (default true for scheduled/catch-up). */
  idempotent?: boolean
}

export interface StartRoutineRunResult {
  run: StoredRoutineRun
  routine: StoredProjectRoutine
  taskSeed: RoutineTaskSeed | null
  created: boolean
  duplicate: boolean
}

export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  async getBoard(projectId: string): Promise<OperationsStoreSnapshot> {
    return this.repo.load(projectId)
  }

  async listProjectIds(): Promise<string[]> {
    return this.repo.listProjectIds()
  }

  async setStage(
    projectId: string,
    stage: ProjectStage | undefined,
  ): Promise<OperationsStoreSnapshot> {
    const snap = await this.repo.load(projectId)
    snap.stage = stage
    await this.repo.save(snap)
    return snap
  }

  async createGoal(
    projectId: string,
    input: {
      type: ProjectGoalType
      title: string
      description?: string
      priority?: StoredProjectGoal['priority']
      successCriteria?: string[]
    },
  ): Promise<StoredProjectGoal> {
    const snap = await this.repo.load(projectId)
    const t = nowIso()
    const goal: StoredProjectGoal = {
      id: id('goal'),
      projectId,
      type: input.type,
      title: input.title.trim(),
      description: input.description?.trim(),
      status: 'active',
      priority: input.priority ?? 'normal',
      successCriteria: input.successCriteria,
      createdAt: t,
      updatedAt: t,
    }
    snap.goals.push(goal)
    await this.repo.save(snap)
    return goal
  }

  async patchGoal(
    goalId: string,
    patch: Partial<
      Pick<
        StoredProjectGoal,
        | 'title'
        | 'description'
        | 'status'
        | 'priority'
        | 'successCriteria'
        | 'type'
      >
    > & { projectId?: string },
  ): Promise<StoredProjectGoal> {
    const projectId =
      patch.projectId ?? (await this.findGoalProjectId(goalId))
    if (!projectId) throw Object.assign(new Error('Goal not found'), { status: 404 })
    const snap = await this.repo.load(projectId)
    const goal = snap.goals.find((g) => g.id === goalId)
    if (!goal) throw Object.assign(new Error('Goal not found'), { status: 404 })
    Object.assign(goal, patch, { updatedAt: nowIso(), projectId })
    await this.repo.save(snap)
    return goal
  }

  private async findGoalProjectId(goalId: string): Promise<string | null> {
    const ids = await this.repo.listProjectIds()
    for (const pid of ids) {
      const snap = await this.repo.load(pid)
      if (snap.goals.some((g) => g.id === goalId)) return pid
    }
    return null
  }

  private async findRoutineProjectId(
    routineId: string,
  ): Promise<string | null> {
    const ids = await this.repo.listProjectIds()
    for (const pid of ids) {
      const snap = await this.repo.load(pid)
      if (snap.routines.some((r) => r.id === routineId)) return pid
    }
    return null
  }

  async createRoutine(
    projectId: string,
    input: {
      name?: string
      description?: string
      goalId?: string
      templateId?: string
      trigger?: StoredProjectRoutine['trigger']
      schedule?: StoredRoutineSchedule
      requiredCapabilities?: string[]
      futureCapabilities?: string[]
      workflowTemplateId?: string
      status?: StoredProjectRoutine['status']
      executionPolicy?: Partial<StoredProjectRoutine['executionPolicy']>
      now?: Date
    },
  ): Promise<StoredProjectRoutine> {
    const snap = await this.repo.load(projectId)
    const tpl = input.templateId ? TEMPLATES[input.templateId] : undefined
    const t = nowIso()
    const now = input.now ?? new Date()
    const schedule = input.schedule ?? tpl?.schedule
    const routine: StoredProjectRoutine = {
      id: id('rtn'),
      projectId,
      goalId: input.goalId,
      name: (input.name ?? tpl?.name ?? 'Routine').trim(),
      description: (input.description ?? tpl?.description ?? '').trim(),
      status: input.status ?? 'active',
      trigger: input.trigger ?? (schedule ? 'scheduled' : 'manual'),
      schedule,
      requiredCapabilities:
        input.requiredCapabilities ?? tpl?.requiredCapabilities ?? [],
      futureCapabilities:
        input.futureCapabilities ?? tpl?.futureCapabilities ?? [],
      workflowTemplateId:
        input.workflowTemplateId ?? tpl?.workflowTemplateId,
      executionPolicy: { ...DEFAULT_POLICY, ...input.executionPolicy },
      templateId: input.templateId,
      nextRunAt: schedule ? calculateNextRun(schedule, now) ?? undefined : undefined,
      createdAt: t,
      updatedAt: t,
    }
    snap.routines.push(routine)
    await this.repo.save(snap)
    return routine
  }

  async patchRoutine(
    routineId: string,
    patch: Partial<
      Pick<
        StoredProjectRoutine,
        | 'name'
        | 'description'
        | 'status'
        | 'trigger'
        | 'schedule'
        | 'goalId'
        | 'executionPolicy'
        | 'nextRunAt'
        | 'lastRunAt'
      >
    > & { projectId?: string; now?: Date },
  ): Promise<StoredProjectRoutine> {
    const projectId =
      patch.projectId ?? (await this.findRoutineProjectId(routineId))
    if (!projectId)
      throw Object.assign(new Error('Routine not found'), { status: 404 })
    const snap = await this.repo.load(projectId)
    const routine = snap.routines.find((r) => r.id === routineId)
    if (!routine)
      throw Object.assign(new Error('Routine not found'), { status: 404 })
    const { now, projectId: _p, ...rest } = patch
    Object.assign(routine, rest, { updatedAt: nowIso() })
    if (routine.schedule && patch.nextRunAt === undefined && (patch.schedule || patch.status)) {
      routine.nextRunAt =
        calculateNextRun(routine.schedule, now ?? new Date()) ?? undefined
    }
    await this.repo.save(snap)
    return routine
  }

  findRunByOccurrence(
    snap: OperationsStoreSnapshot,
    routineId: string,
    scheduledFor: string,
  ): StoredRoutineRun | undefined {
    return snap.runs.find(
      (r) =>
        r.routineId === routineId &&
        r.scheduledFor === scheduledFor,
    )
  }

  /**
   * Unified Routine → RoutineRun start path (manual / scheduled / catch-up).
   * Does not call OpenAI/Codex. Does not bypass Safety.
   */
  async startRoutineRun(
    input: StartRoutineRunInput,
  ): Promise<StartRoutineRunResult> {
    const projectId =
      input.projectId ?? (await this.findRoutineProjectId(input.routineId))
    if (!projectId)
      throw Object.assign(new Error('Routine not found'), { status: 404 })
    const snap = await this.repo.load(projectId)
    const routine = snap.routines.find((r) => r.id === input.routineId)
    if (!routine)
      throw Object.assign(new Error('Routine not found'), { status: 404 })

    if (routine.status === 'archived') {
      throw Object.assign(new Error('Routine is archived'), { status: 400 })
    }
    if (
      input.triggerSource !== 'manual' &&
      routine.status !== 'active'
    ) {
      throw Object.assign(new Error('Routine is not active'), { status: 400 })
    }

    const now = input.now ?? new Date()
    const triggeredAt = nowIso(now)
    const scheduledFor =
      input.scheduledFor ??
      (input.triggerSource !== 'manual' && routine.schedule
        ? getMostRecentOccurrence(routine.schedule, now) ?? undefined
        : undefined)

    const idempotent =
      input.idempotent ??
      (input.triggerSource === 'scheduled' ||
        input.triggerSource === 'catch-up')

    if (idempotent && scheduledFor) {
      const existing = this.findRunByOccurrence(
        snap,
        routine.id,
        scheduledFor,
      )
      if (existing) {
        return {
          run: existing,
          routine,
          taskSeed: null,
          created: false,
          duplicate: true,
        }
      }
    }

    // Also guard: open non-terminal run for same routine (slow execution / race)
    if (input.triggerSource !== 'manual') {
      const open = snap.runs.find(
        (r) =>
          r.routineId === routine.id &&
          (r.status === 'queued' ||
            r.status === 'running' ||
            r.status === 'awaiting_approval'),
      )
      if (open) {
        // Still advance nextRunAt so we don't spin
        if (routine.schedule) {
          routine.nextRunAt =
            calculateNextRun(routine.schedule, now) ?? undefined
          routine.updatedAt = triggeredAt
          await this.repo.save(snap)
        }
        return {
          run: open,
          routine,
          taskSeed: null,
          created: false,
          duplicate: true,
        }
      }
    }

    const preflight = preflightRoutineCapabilities(routine)
    const team = new Set(input.teamAgentIds ?? [])
    const specialists = (input.specialistCandidates ?? []).filter(
      (a) => !team.has(a),
    )
    const assignment: StoredRoutineRunAssignment = {
      teamAgentIds: input.teamAgentIds,
      specialistAgentIds: specialists.length ? specialists : undefined,
      preferredAgentId: input.preferredAgentId,
      source:
        specialists.length && (input.teamAgentIds?.length ?? 0) > 0
          ? 'mixed'
          : specialists.length
            ? 'specialist'
            : 'team',
    }

    const reserveTask =
      input.reserveTaskId !== false && preflight.ok
    const taskId = reserveTask
      ? (input.taskId ?? id('task'))
      : undefined

    let status: StoredRoutineRun['status'] = 'queued'
    let summary = `${input.triggerSource} run queued for ${routine.name}`
    if (!preflight.ok) {
      status = 'blocked'
      summary = preflight.message ?? `Blocked: ${preflight.blocking.join(', ')}`
    } else {
      const needsWrite =
        routine.executionPolicy.requireApprovalForWrite &&
        (routine.requiredCapabilities.includes('code.write') ||
          workflowImpliesWrite(routine.workflowTemplateId))
      if (needsWrite && input.triggerSource !== 'manual') {
        // Scheduled write work still goes through approval — not a failure
        status = 'awaiting_approval'
        summary = `Awaiting approval for write routine: ${routine.name}`
      }
    }

    const run: StoredRoutineRun = {
      id: id('run'),
      routineId: routine.id,
      projectId,
      status,
      taskIds: taskId ? [taskId] : [],
      scheduledFor: scheduledFor ?? undefined,
      triggeredAt,
      triggerSource: input.triggerSource,
      startedAt: triggeredAt,
      completedAt: status === 'blocked' ? triggeredAt : undefined,
      summary,
      missingCapabilities: preflight.blocking.length
        ? preflight.blocking
        : preflight.optionalUnavailable.length
          ? preflight.optionalUnavailable
          : undefined,
      specialistAgentIds: specialists.length ? specialists : undefined,
      assignment,
      createdAt: triggeredAt,
    }

    snap.runs.unshift(run)
    routine.lastRunAt = triggeredAt
    if (routine.schedule) {
      // Occurrence-based advance — not now+interval
      routine.nextRunAt =
        calculateNextRun(routine.schedule, now) ?? undefined
    }
    routine.updatedAt = triggeredAt
    await this.repo.save(snap)

    const autoStart = shouldAutoStartTasks(routine, preflight)
    const needsWriteApproval =
      routine.executionPolicy.requireApprovalForWrite &&
      (routine.requiredCapabilities.includes('code.write') ||
        workflowImpliesWrite(routine.workflowTemplateId))

    const taskSeed: RoutineTaskSeed | null = preflight.ok
      ? {
          title: `[Routine] ${routine.name}`,
          description: [
            routine.description,
            `required: ${routine.requiredCapabilities.join(', ')}`,
            preflight.optionalUnavailable.length
              ? `[optional unavailable] ${preflight.optionalUnavailable.join(', ')} — will not fake-complete`
              : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
          workflowTemplateId: routine.workflowTemplateId,
          requiredCapabilities: routine.requiredCapabilities,
          missingCapabilities: preflight.blocking,
          optionalUnavailable: preflight.optionalUnavailable,
          specialistAgentIds: specialists,
          requireApprovalForWrite:
            routine.executionPolicy.requireApprovalForWrite,
          requireApprovalForExternalAction:
            routine.executionPolicy.requireApprovalForExternalAction,
          maxTasksPerRun: routine.executionPolicy.maxTasksPerRun ?? 3,
          autoStart,
          needsWriteApproval,
          source: {
            type: 'routine',
            routineId: routine.id,
            routineRunId: run.id,
          },
        }
      : null

    return { run, routine, taskSeed, created: true, duplicate: false }
  }

  /**
   * Manual run — thin wrapper over unified startRoutineRun.
   */
  async runManual(
    routineId: string,
    input: {
      projectId?: string
      taskId?: string
      teamAgentIds?: string[]
      specialistCandidates?: string[]
      preferredAgentId?: string
      now?: Date
    } = {},
  ): Promise<{
    run: StoredRoutineRun
    routine: StoredProjectRoutine
    taskSeed: RoutineTaskSeed
  }> {
    const result = await this.startRoutineRun({
      routineId,
      projectId: input.projectId,
      triggerSource: 'manual',
      taskId: input.taskId,
      teamAgentIds: input.teamAgentIds,
      specialistCandidates: input.specialistCandidates,
      preferredAgentId: input.preferredAgentId,
      now: input.now,
      idempotent: false,
    })
    if (!result.taskSeed) {
      // Blocked manual run — still return a seed describing the block
      const blockedSeed: RoutineTaskSeed = {
        title: `[Routine] ${result.routine.name}`,
        description:
          result.run.summary ??
          'Required capability unavailable — will not fake-complete',
        workflowTemplateId: result.routine.workflowTemplateId,
        requiredCapabilities: result.routine.requiredCapabilities,
        missingCapabilities: result.run.missingCapabilities ?? [],
        optionalUnavailable: [],
        specialistAgentIds: result.run.specialistAgentIds ?? [],
        requireApprovalForWrite:
          result.routine.executionPolicy.requireApprovalForWrite,
        requireApprovalForExternalAction:
          result.routine.executionPolicy.requireApprovalForExternalAction,
        maxTasksPerRun: result.routine.executionPolicy.maxTasksPerRun ?? 3,
        autoStart: false,
        needsWriteApproval: false,
        source: {
          type: 'routine',
          routineId: result.routine.id,
          routineRunId: result.run.id,
        },
      }
      return {
        run: result.run,
        routine: result.routine,
        taskSeed: blockedSeed,
      }
    }
    return {
      run: result.run,
      routine: result.routine,
      taskSeed: result.taskSeed,
    }
  }

  async attachTaskToRun(
    projectId: string,
    runId: string,
    taskId: string,
  ): Promise<StoredRoutineRun> {
    const snap = await this.repo.load(projectId)
    const run = snap.runs.find((r) => r.id === runId)
    if (!run) throw Object.assign(new Error('Run not found'), { status: 404 })
    if (!run.taskIds.includes(taskId)) run.taskIds.push(taskId)
    if (run.status === 'queued' || run.status === 'blocked') {
      run.status = 'running'
    }
    await this.repo.save(snap)
    return run
  }

  async updateRunStatus(
    projectId: string,
    runId: string,
    patch: Partial<
      Pick<
        StoredRoutineRun,
        'status' | 'summary' | 'completedAt' | 'taskIds' | 'startedAt'
      >
    >,
  ): Promise<StoredRoutineRun> {
    const snap = await this.repo.load(projectId)
    const run = snap.runs.find((r) => r.id === runId)
    if (!run) throw Object.assign(new Error('Run not found'), { status: 404 })
    Object.assign(run, patch)
    await this.repo.save(snap)
    return run
  }

  /**
   * Reconcile RoutineRun from linked Task statuses.
   * awaiting_approval is not treated as failure.
   */
  reconcileRunFromTasks(
    run: StoredRoutineRun,
    taskStatuses: Array<{ id: string; status: string; finalResult?: string }>,
  ): Partial<StoredRoutineRun> {
    if (run.status === 'blocked' || run.status === 'cancelled') {
      return {}
    }
    const linked = taskStatuses.filter((t) => run.taskIds.includes(t.id))
    if (linked.length === 0) return {}

    const statuses = linked.map((t) => t.status)
    if (statuses.some((s) => s === 'awaiting_approval')) {
      return { status: 'awaiting_approval' }
    }
    if (
      statuses.some(
        (s) => s === 'running' || s === 'verifying' || s === 'interrupted',
      )
    ) {
      return { status: 'running' }
    }
    if (statuses.some((s) => s === 'failed' || s === 'cancelled')) {
      const failed = linked.find(
        (t) => t.status === 'failed' || t.status === 'cancelled',
      )
      return {
        status: failed?.status === 'cancelled' ? 'cancelled' : 'failed',
        completedAt: nowIso(),
        summary: failed?.finalResult ?? run.summary ?? 'Task failed',
      }
    }
    if (statuses.every((s) => s === 'completed')) {
      const summary = linked
        .map((t) => t.finalResult)
        .filter(Boolean)
        .join('\n')
        .slice(0, 2000)
      return {
        status: 'completed',
        completedAt: nowIso(),
        summary: summary || run.summary || 'All tasks completed',
      }
    }
    if (statuses.some((s) => s === 'queued')) {
      return { status: 'queued' }
    }
    return {}
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.repo.deleteProject(projectId)
  }
}
