import { hardenError } from './hardenErrors.js'

export interface ExecutionLockHolder {
  clientId: string
  projectId: string
  taskId: string
  acquiredAt: string
}

/**
 * One owner tab per project, any number of running tasks under it.
 * The tab that runs tasks refreshes each task's lock every ~10s (heartbeat).
 * A task without a heartbeat for LOCK_TTL_MS is dead (tab closed/reloaded) and
 * may be recovered; another tab can take the project only when all are dead.
 */
export const LOCK_TTL_MS = 45_000
type ProjectLock = { clientId: string; projectId: string; tasks: Map<string, string> }
const locks = new Map<string, ProjectLock>()

const aliveAt = (iso: string, now: number) => now - Date.parse(iso) < LOCK_TTL_MS

export function isLockAlive(holder: ExecutionLockHolder | null, now = Date.now()): boolean {
  return Boolean(holder) && aliveAt(holder!.acquiredAt, now)
}

/** Task ids in a project that still have a live heartbeat. */
export function liveTaskIds(projectId: string, now = Date.now()): string[] {
  const lock = locks.get(projectId)
  if (!lock) return []
  return [...lock.tasks].filter(([, at]) => aliveAt(at, now)).map(([id]) => id)
}

export function tryAcquireExecutionLock(input: {
  projectId: string
  taskId: string
  clientId: string
}): ExecutionLockHolder {
  const now = Date.now()
  let lock = locks.get(input.projectId)
  if (lock && lock.clientId !== input.clientId) {
    if (liveTaskIds(input.projectId, now).length) {
      const [busyTask] = liveTaskIds(input.projectId, now)
      throw hardenError(
        'EXECUTION_LOCK',
        `Project ${input.projectId} locked by client ${lock.clientId} task ${busyTask}`,
      )
    }
    lock = undefined
  }
  if (!lock) {
    lock = { clientId: input.clientId, projectId: input.projectId, tasks: new Map() }
    locks.set(input.projectId, lock)
  }
  const acquiredAt = new Date(now).toISOString()
  lock.tasks.set(input.taskId, acquiredAt)
  return { clientId: input.clientId, projectId: input.projectId, taskId: input.taskId, acquiredAt }
}

export function releaseExecutionLock(input: {
  projectId: string
  clientId?: string
  taskId?: string
}): boolean {
  const lock = locks.get(input.projectId)
  if (!lock) return false
  if (input.clientId && lock.clientId !== input.clientId) return false
  if (input.taskId) {
    if (!lock.tasks.delete(input.taskId)) return false
  } else lock.tasks.clear()
  if (!lock.tasks.size) locks.delete(input.projectId)
  return true
}

/** Most recently refreshed task lock of a project (for display/back-compat). */
export function getExecutionLock(
  projectId: string,
): ExecutionLockHolder | null {
  const lock = locks.get(projectId)
  if (!lock || !lock.tasks.size) return null
  const [taskId, acquiredAt] = [...lock.tasks].sort((a, b) => b[1].localeCompare(a[1]))[0]!
  return { clientId: lock.clientId, projectId, taskId, acquiredAt }
}

export function clearAllExecutionLocks(): void {
  locks.clear()
}
