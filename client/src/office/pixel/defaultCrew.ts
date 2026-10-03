import type { Agent, AgentStatus } from '../../domain/types'
import { visualVariationSeed } from '../v2/visualRole'
import { type WorkstationGroup, workstationGroupForAgent } from '../v2/workstationPolicy'

/**
 * Preview crew shown when no project is active, so the office never looks empty.
 * Purely visual: statuses are simulated and never written to the store.
 */
const QUOTA: Record<WorkstationGroup, number> = {
  product: 2,
  'game-development': 2,
  design: 2,
  research: 2,
  development: 3,
  marketing: 2,
  testing: 2,
}

export const SIM_PERIOD_MS = 30_000

export function pickDefaultCrew(registry: Agent[]): Agent[] {
  const left = { ...QUOTA }
  const crew: Agent[] = []
  const sorted = registry.slice().sort((a, b) => visualVariationSeed(a.id) - visualVariationSeed(b.id))
  for (const agent of sorted) {
    if (agent.enabled === false) continue
    const g = workstationGroupForAgent(agent)
    if (left[g] > 0) {
      left[g] -= 1
      crew.push(agent)
    }
    if (Object.values(left).every((n) => n === 0)) break
  }
  return crew
}

function statusFor(agent: Agent, bucket: number): AgentStatus {
  const roll = visualVariationSeed(`${agent.id}:${bucket}`) % 100
  if (workstationGroupForAgent(agent) === 'testing') {
    return roll < 50 ? 'working' : roll < 80 ? 'verifying' : 'idle'
  }
  return roll < 60 ? 'working' : roll < 85 ? 'idle' : 'reviewing'
}

/** Each agent changes activity on its own offset, so someone is always on the move. */
export function simulateCrew(crew: Agent[], now: number): Agent[] {
  return crew.map((agent) => {
    const offset = visualVariationSeed(agent.id) % SIM_PERIOD_MS
    const bucket = Math.floor((now + offset) / SIM_PERIOD_MS)
    return { ...agent, status: statusFor(agent, bucket) }
  })
}
