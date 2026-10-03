import type { Agent, AgentStatus } from '../../domain/types'
import type { OfficeV2VisualRole } from './manifestTypes'
import { resolveOfficeV2VisualRole } from './visualRole'

/**
 * Workstation assignment policy for Office V2 (30 fixed slots).
 * Does not mutate map furniture — overflow is visual-only.
 *
 * Consumed by OfficeV2Scene through officeAssignmentPolicy.
 */

export type WorkstationGroup =
  | 'product'
  | 'design'
  | 'development'
  | 'game-development'
  | 'research'
  | 'marketing'
  | 'testing'

/** Fixed capacity from docs/office-v2/office-map-layout.json */
export const WORKSTATION_CAPACITY: Record<WorkstationGroup, number> = {
  product: 4,
  design: 5,
  development: 4,
  'game-development': 4,
  research: 4,
  marketing: 4,
  testing: 5,
}

export const TOTAL_WORKSTATIONS = Object.values(WORKSTATION_CAPACITY).reduce(
  (a, b) => a + b,
  0,
)

const ROLE_TO_GROUP: Record<OfficeV2VisualRole, WorkstationGroup> = {
  pm: 'product',
  developer: 'development',
  'game-developer': 'game-development',
  designer: 'design',
  researcher: 'research',
  marketer: 'marketing',
  qa: 'testing',
  reviewer: 'testing',
}

/**
 * Desk claim statuses only.
 * reviewing → meeting, verifying → testing (see officeAssignmentPolicy).
 */
const DESK_CLAIM_STATUS: ReadonlySet<AgentStatus> = new Set([
  'working',
  'blocked',
])

/** Office layout: 'game' has a game-dev room; 'app' turns that room into an app-dev room. */
export type OfficeLayout = 'game' | 'app'

const APP_DEV_HINT = /mobile|ios|android|flutter|react-native|frontend|app-builder|swift|kotlin/

export function workstationGroupForAgent(agent: Agent, layout: OfficeLayout = 'game'): WorkstationGroup {
  const group = ROLE_TO_GROUP[resolveOfficeV2VisualRole(agent)]
  if (layout === 'app') {
    // Same desks (gamedev.desk.N), different room: app/mobile/frontend builders sit there.
    if (group === 'game-development') return 'development'
    if (group === 'development' && APP_DEV_HINT.test(`${agent.id} ${agent.name}`.toLowerCase())) return 'game-development'
  }
  return group
}

export interface WorkstationClaim {
  agentId: string
  group: WorkstationGroup
  /** 1-based slot within group, or null if overflow */
  slot: number | null
  overflow: boolean
}

export interface WorkstationAssignmentResult {
  claims: WorkstationClaim[]
  overflowByGroup: Partial<Record<WorkstationGroup, string[]>>
}

function claimPriority(status: AgentStatus): number {
  if (status === 'working') return 0
  if (status === 'blocked') return 1
  return 9
}

/**
 * Desk-only helper. Prefer `assignOfficeDestinations` for full runtime policy.
 * Priority: working → blocked. Never creates dynamic furniture on overflow.
 */
export function assignWorkstations(agents: Agent[]): WorkstationAssignmentResult {
  const active = agents
    .filter((a) => DESK_CLAIM_STATUS.has(a.status))
    .slice()
    .sort((a, b) => {
      const p = claimPriority(a.status) - claimPriority(b.status)
      if (p !== 0) return p
      return a.id.localeCompare(b.id)
    })

  const used: Record<WorkstationGroup, number> = {
    product: 0,
    design: 0,
    development: 0,
    'game-development': 0,
    research: 0,
    marketing: 0,
    testing: 0,
  }

  const claims: WorkstationClaim[] = []
  const overflowByGroup: Partial<Record<WorkstationGroup, string[]>> = {}

  for (const agent of active) {
    const group = workstationGroupForAgent(agent)
    const cap = WORKSTATION_CAPACITY[group]
    used[group] += 1
    if (used[group] <= cap) {
      claims.push({
        agentId: agent.id,
        group,
        slot: used[group],
        overflow: false,
      })
    } else {
      claims.push({
        agentId: agent.id,
        group,
        slot: null,
        overflow: true,
      })
      const list = overflowByGroup[group] ?? []
      list.push(agent.id)
      overflowByGroup[group] = list
    }
  }

  return { claims, overflowByGroup }
}

export function workstationWaypointId(
  group: WorkstationGroup,
  slot: number,
): string {
  const prefix =
    group === 'game-development'
      ? 'gamedev'
      : group === 'testing'
        ? 'testing'
        : group
  return `${prefix}.desk.${slot}`
}
