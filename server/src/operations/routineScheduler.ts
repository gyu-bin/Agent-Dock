/**
 * Local Routine Scheduler Runtime.
 * Only runs while Agent Deck server is up. No AI reasoning.
 */

import type { OperationsService } from '../persistence/operationsService.js'
import type { ProjectService } from '../persistence/projectService.js'
import type { StoredProjectRoutine } from '../persistence/operationsTypes.js'
import {
  getDueRoutines,
  getMostRecentOccurrence,
  isCatchUp,
} from './scheduleUtils.js'
import { RoutineExecutionService } from './routineExecutionService.js'

export interface SchedulerConfig {
  enabled: boolean
  intervalMs: number
}

export interface SchedulerStatus {
  enabled: boolean
  intervalMs: number
  running: boolean
  lastTickAt: string | null
  nextTickAt: string | null
  dueRoutineCount: number
  runningRoutineCount: number
  lastTickCreated: number
  lastTickSkipped: number
}

export function readSchedulerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SchedulerConfig {
  const enabledRaw = env.AGENT_DECK_SCHEDULER_ENABLED
  const enabled =
    enabledRaw === undefined || enabledRaw === ''
      ? true
      : enabledRaw === '1' || enabledRaw.toLowerCase() === 'true'
  const intervalMs = Math.max(
    1000,
    Number(env.AGENT_DECK_SCHEDULER_INTERVAL_MS ?? 60_000) || 60_000,
  )
  return { enabled, intervalMs }
}

export class RoutineSchedulerRuntime {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTickAt: string | null = null
  private nextTickAt: string | null = null
  private lastTickCreated = 0
  private lastTickSkipped = 0
  private ticking = false
  private readonly locks = new Set<string>()
  private readonly execution: RoutineExecutionService
  private stopped = false

  constructor(
    private readonly operations: OperationsService,
    private readonly projects: ProjectService | null,
    private config: SchedulerConfig,
  ) {
    this.execution = new RoutineExecutionService(operations, projects)
  }

  getConfig(): SchedulerConfig {
    return { ...this.config }
  }

  setConfig(patch: Partial<SchedulerConfig>): void {
    this.config = { ...this.config, ...patch }
  }

  start(): void {
    this.stopped = false
    if (!this.config.enabled) {
      console.log('[agent-deck] scheduler: disabled')
      return
    }
    if (this.timer) return
    this.nextTickAt = new Date(
      Date.now() + this.config.intervalMs,
    ).toISOString()
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        console.warn('[agent-deck] scheduler tick failed', err)
      })
    }, this.config.intervalMs)
    // Allow timer to not keep process alive exclusively
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref?.()
    }
    console.log(
      `[agent-deck] scheduler: enabled interval=${this.config.intervalMs}ms`,
    )
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // Wait for in-flight tick to finish persistence
    const deadline = Date.now() + 5000
    while (this.ticking && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }
    this.nextTickAt = null
  }

  async getStatus(now = new Date()): Promise<SchedulerStatus> {
    let dueRoutineCount = 0
    let runningRoutineCount = 0
    try {
      const projectIds = await this.operations.listProjectIds()
      for (const projectId of projectIds) {
        if (!(await this.isProjectAllowed(projectId))) continue
        const board = await this.operations.getBoard(projectId)
        dueRoutineCount += getDueRoutines(board.routines, now).length
        runningRoutineCount += board.runs.filter(
          (r) =>
            r.status === 'running' ||
            r.status === 'queued' ||
            r.status === 'awaiting_approval',
        ).length
      }
    } catch {
      // status should never throw hard
    }
    return {
      enabled: this.config.enabled,
      intervalMs: this.config.intervalMs,
      running: this.timer != null,
      lastTickAt: this.lastTickAt,
      nextTickAt: this.nextTickAt,
      dueRoutineCount,
      runningRoutineCount,
      lastTickCreated: this.lastTickCreated,
      lastTickSkipped: this.lastTickSkipped,
    }
  }

  /**
   * Manual / test tick with injectable clock.
   * Not exposed as a public production mutation API.
   */
  async tick(now: Date = new Date()): Promise<{
    created: number
    skipped: number
    reconciled: number
  }> {
    if (this.ticking) {
      return { created: 0, skipped: 0, reconciled: 0 }
    }
    this.ticking = true
    let created = 0
    let skipped = 0
    let reconciled = 0
    try {
      if (this.stopped) {
        return { created, skipped, reconciled }
      }

      const projectIds = await this.operations.listProjectIds()
      for (const projectId of projectIds) {
        if (!(await this.isProjectAllowed(projectId))) {
          continue
        }

        // Restart reconcile first
        const updated = await this.execution.reconcileProject(projectId)
        reconciled += updated.length

        const board = await this.operations.getBoard(projectId)
        const due = getDueRoutines(board.routines, now)

        for (const routine of due) {
          const result = await this.processDueRoutine(
            routine,
            projectId,
            now,
          )
          if (result === 'created') created += 1
          else skipped += 1
        }
      }

      this.lastTickAt = now.toISOString()
      this.lastTickCreated = created
      this.lastTickSkipped = skipped
      if (this.timer) {
        this.nextTickAt = new Date(
          now.getTime() + this.config.intervalMs,
        ).toISOString()
      }
      return { created, skipped, reconciled }
    } finally {
      this.ticking = false
    }
  }

  private async isProjectAllowed(projectId: string): Promise<boolean> {
    if (!this.projects) return true
    try {
      const snap = await this.projects.getSnapshot()
      const project = snap.projects.find((p) => p.id === projectId)
      return this.execution.isProjectRunnable(project)
    } catch {
      return false
    }
  }

  private async processDueRoutine(
    routine: StoredProjectRoutine,
    projectId: string,
    now: Date,
  ): Promise<'created' | 'skipped'> {
    if (routine.status !== 'active') return 'skipped'
    if (this.locks.has(routine.id)) return 'skipped'

    this.locks.add(routine.id)
    try {
      const schedule = routine.schedule
      if (!schedule) return 'skipped'

      const scheduledFor =
        getMostRecentOccurrence(schedule, now) ?? routine.nextRunAt
      if (!scheduledFor) return 'skipped'

      const catchUp = isCatchUp(schedule, routine.nextRunAt, now)
      const triggerSource = catchUp ? 'catch-up' : 'scheduled'

      // Resolve team from project when available
      let teamAgentIds: string[] | undefined
      if (this.projects) {
        const snap = await this.projects.getSnapshot()
        const project = snap.projects.find((p) => p.id === projectId)
        teamAgentIds = project?.agentIds
      }

      const result = await this.execution.start({
        routineId: routine.id,
        projectId,
        triggerSource,
        scheduledFor,
        teamAgentIds,
        now,
        idempotent: true,
      })

      return result.created ? 'created' : 'skipped'
    } finally {
      this.locks.delete(routine.id)
    }
  }
}
