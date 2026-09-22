/** In-memory + serializable task web-search history (W1). */

import type { TaskWebSearchSession } from './types.js'

const byTask = new Map<string, TaskWebSearchSession[]>()

export function appendSearchSession(session: TaskWebSearchSession): void {
  const list = byTask.get(session.taskId) ?? []
  list.push(session)
  byTask.set(session.taskId, list)
}

export function listSearchSessions(taskId: string): TaskWebSearchSession[] {
  return [...(byTask.get(taskId) ?? [])]
}

export function replaceSearchSessions(
  taskId: string,
  sessions: TaskWebSearchSession[],
): void {
  byTask.set(taskId, sessions)
}

export function loadSearchSessionsFromTasks(
  tasks: Array<{ id: string; webSearchSessions?: TaskWebSearchSession[] }>,
): void {
  for (const t of tasks) {
    if (t.webSearchSessions?.length) {
      byTask.set(t.id, t.webSearchSessions)
    }
  }
}
