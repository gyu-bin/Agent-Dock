import type { Agent, AgentStatus, Project } from '../domain/types'

/** Runtime overlays (status/speech/task) — not persisted. Registry is identity SoT. */
export type AgentRuntime = Partial<
  Pick<Agent, 'status' | 'speech' | 'currentTaskId' | 'currentTaskLabel'>
>

export function mergeTeamAgents(
  registry: Agent[],
  project: Project | null,
  runtime: Record<string, AgentRuntime>,
): Agent[] {
  if (!project) return []
  const byId = new Map(registry.map((a) => [a.id, a]))
  return project.agentIds
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
