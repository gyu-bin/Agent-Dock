import type { PipelineStep, Task, CodexRun, AgentRun } from '../domain/types'
import type { AgentRuntime } from '../domain/teamRuntime'

export interface ExecutionEngine {
  execute(taskId: string): void
  pause(taskId: string): void
  resume(taskId: string): void
  cancel(taskId: string): void
  setSpeed(multiplier: number): void
  dispose(): void
}

export interface EngineStoreAccess {
  getTasks: () => Task[]
  getSteps: () => PipelineStep[]
  getAgentRuntime: () => Record<string, AgentRuntime>
  getAgentRuns?: () => AgentRun[]
  getCodexRuns?: () => CodexRun[]
  getProjects?: () => import('../domain/types').Project[]
  getActiveProjectId?: () => string | null
  getRegistry?: () => import('../domain/types').Agent[]
  patchTask: (taskId: string, patch: Partial<Task>) => void
  patchStep: (stepId: string, patch: Partial<PipelineStep>) => void
  setAgentRuntime: (agentId: string, patch: AgentRuntime) => void
  upsertAgentRun?: (run: AgentRun) => void
  upsertCodexRun?: (run: CodexRun) => void
  /** Replace all pipeline steps for a task (safety pipeline injection). */
  replaceStepsForTask?: (taskId: string, steps: PipelineStep[]) => void
  persistSoon: () => void
}

/** Agents currently RUNNING on any non-paused task. */
export function busyAgentIds(
  tasks: Task[],
  steps: PipelineStep[],
): Set<string> {
  const busy = new Set<string>()
  for (const task of tasks) {
    if (task.status !== 'running') continue
    for (const step of steps) {
      if (step.taskId !== task.id) continue
      if (step.status === 'running' || step.status === 'reviewing') {
        busy.add(step.agentId)
      }
    }
  }
  return busy
}

export function taskProgress(taskId: string, steps: PipelineStep[]): number {
  const mine = steps.filter((s) => s.taskId === taskId)
  if (mine.length === 0) return 0
  const done = mine.filter((s) => s.status === 'completed').length
  return Math.round((done / mine.length) * 100)
}
