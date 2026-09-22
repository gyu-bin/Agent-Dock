import { hardenError } from './hardenErrors.js'

export interface ExecutionLockHolder {
  clientId: string
  projectId: string
  taskId: string
  acquiredAt: string
}

/** Single-user MVP: one active execution lock per project. */
const locks = new Map<string, ExecutionLockHolder>()

export function tryAcquireExecutionLock(input: {
  projectId: string
  taskId: string
  clientId: string
}): ExecutionLockHolder {
  const existing = locks.get(input.projectId)
  if (
    existing &&
    existing.clientId !== input.clientId &&
    Date.now() - Date.parse(existing.acquiredAt) < 30 * 60_000
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
}): boolean {
  const existing = locks.get(input.projectId)
  if (!existing) return false
  if (input.clientId && existing.clientId !== input.clientId) return false
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
