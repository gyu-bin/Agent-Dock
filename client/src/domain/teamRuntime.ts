import type { Agent, AgentStatus, Project } from '../domain/types'

/** Runtime overlays (status/speech/task) — not persisted. Registry is identity SoT. */
export type AgentRuntime = Partial<
  Pick<Agent, 'status' | 'speech' | 'currentTaskId' | 'currentTaskLabel'>
> & {
  /** Set when the agent says something worth a visible bubble (ms epoch). */
  speechAt?: number
}

/** A runtime entry that should keep a non-team specialist visible in the office. */
export function isRuntimeActive(r: AgentRuntime | undefined, now = Date.now()): boolean {
  if (!r) return false
  return Boolean(r.currentTaskId) || !['idle', 'waiting', 'offline'].includes(r.status ?? 'idle') || (r.speechAt !== undefined && now - r.speechAt < 8000)
}

export function mergeTeamAgents(
  registry: Agent[],
  project: Project | null,
  runtime: Record<string, AgentRuntime>,
): Agent[] {
  if (!project) return []
  const byId = new Map(registry.map((a) => [a.id, a]))
  // Specialists pulled in by a task (e.g. research-synthesist for market research) are not
  // on the project team, but while they hold a task they must appear in the office.
  const team = new Set(project.agentIds)
  const guests = Object.entries(runtime)
    .filter(([id, r]) => !team.has(id) && byId.has(id) && isRuntimeActive(r))
    .map(([id]) => id)
  return [...project.agentIds, ...guests]
    .map((id) => {
      const base = byId.get(id)
      if (!base) return null
      const over = runtime[id]
      return {
        ...base,
        status: (over?.status ?? 'idle') as AgentStatus,
        speech: over?.speech,
        currentTaskId: over?.currentTaskLabel ? over.currentTaskId : over?.currentTaskId,
        currentTaskLabel: over?.currentTaskLabel,
        enabled: base.enabled,
      } satisfies Agent
    })
    .filter(Boolean) as Agent[]
}

export function defaultRuntimeForNewTeam(agentIds: string[]): Record<string, AgentRuntime> {
  const runtime: Record<string, AgentRuntime> = {}
  for (const id of agentIds) {
    runtime[id] = { status: 'idle' }
  }
  return runtime
}
