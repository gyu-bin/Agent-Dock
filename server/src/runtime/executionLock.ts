import { hardenError } from './hardenErrors.js'

export interface ExecutionLockHolder {
  clientId: string
  projectId: string
  taskId: string
  acquiredAt: string
}

/**
 * Single-user MVP: one active execution lock per project.
 * The browser tab that runs a task is the execution owner; it refreshes the lock
 * every ~10s (heartbeat). A lock without a heartbeat for LOCK_TTL_MS is dead
 * (tab closed/reloaded) and may be taken over or recovered.
 */
export const LOCK_TTL_MS = 45_000
const locks = new Map<string, ExecutionLockHolder>()

export function isLockAlive(holder: ExecutionLockHolder | null, now = Date.now()): boolean {
  return Boolean(holder) && now - Date.parse(holder!.acquiredAt) < LOCK_TTL_MS
}

export function tryAcquireExecutionLock(input: {
  projectId: string
  taskId: string
  clientId: string
}): ExecutionLockHolder {
  const existing = locks.get(input.projectId)
  if (
    existing &&
    existing.clientId !== input.clientId &&
    isLockAlive(existing)
  ) {
    throw hardenError(
      'EXECUTION_LOCK',
      `Project ${input.projectId} locked by client ${existing.clientId} task ${existing.taskId}`,
    )
  }
  const holder: ExecutionLockHolder = {
    clientId: input.clientId,
    projectId: input.projectId,
    taskId: input.taskId,
    acquiredAt: new Date().toISOString(),
  }
  locks.set(input.projectId, holder)
  return holder
}

export function releaseExecutionLock(input: {
  projectId: string
  clientId?: string
  taskId?: string
}): boolean {
  const existing = locks.get(input.projectId)
  if (!existing) return false
  if (input.clientId && existing.clientId !== input.clientId) return false
  if (input.taskId && existing.taskId !== input.taskId) return false
  locks.delete(input.projectId)
  return true
}

export function getExecutionLock(
  projectId: string,
): ExecutionLockHolder | null {
  return locks.get(projectId) ?? null
}

export function clearAllExecutionLocks(): void {
  locks.clear()
}
