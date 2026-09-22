import type { Agent, AgentStatus } from '../../domain/types'
import { visualVariationSeed } from './visualRole'
import {
  WORKSTATION_CAPACITY,
  type WorkstationGroup,
  workstationGroupForAgent,
  workstationWaypointId,
} from './workstationPolicy'

/**
 * Canonical Office V2 destination policy.
 * Status → destination kind + deterministic slot / waypoint.
 *
 * Not wired into OfficeScene yet.
 */

export type OfficeDestinationType =
  | 'lounge'
  | 'workstation'
  | 'meeting'
  | 'testing'
  | 'reception'
  | 'hidden'

export interface OfficeAssignment {
  agentId: string
  destinationType: OfficeDestinationType
  waypointId?: string
  workstationGroup?: WorkstationGroup
  /** 1-based slot within destination pool, or undefined when overflow / hidden */
  slot?: number
  overflow: boolean
}

export interface OfficeAssignmentResult {
  assignments: OfficeAssignment[]
  overflowByDestination: Partial<Record<OfficeDestinationType, string[]>>
}

export interface OfficeAssignmentOptions {
  /**
   * Offline agents: stand at reception.spawn (default) or disappear.
   * Spec allows either; Scene may choose later.
   */
  offlineMode?: 'reception' | 'hidden'
}

/** Lounge sit/stand/talk pool — exits excluded (layout SoT). */
export const LOUNGE_WAYPOINTS = [
  'lounge.sofa.1',
  'lounge.sofa.2',
  'lounge.sofa.3',
  'lounge.sofa.4',
  'lounge.armchair.1',
  'lounge.armchair.2',
  'lounge.coffee.1',
  'lounge.coffee.2',
  'lounge.bookshelf.1',
  'lounge.stand.1',
  'lounge.stand.2',
  'lounge.stand.3',
  'lounge.stand.4',
  'lounge.stand.5',
  'lounge.stand.6',
  'lounge.stand.7',
  'lounge.stand.8',
  'lounge.stand.9',
  'lounge.talk.1',
  'lounge.talk.2',
] as const

export const MEETING_SEATS = [
  'meeting.seat.1',
  'meeting.seat.2',
  'meeting.seat.3',
  'meeting.seat.4',
  'meeting.seat.5',
  'meeting.seat.6',
  'meeting.seat.7',
  'meeting.seat.8',
] as const

export const TESTING_DESKS = [
  'testing.desk.1',
  'testing.desk.2',
  'testing.desk.3',
  'testing.desk.4',
  'testing.desk.5',
] as const

export const RECEPTION_SPAWN = 'reception.spawn'

export const DESTINATION_CAPACITY = {
  lounge: LOUNGE_WAYPOINTS.length,
  meeting: MEETING_SEATS.length,
  testing: TESTING_DESKS.length,
  reception: 1,
} as const

/** Map runtime AgentStatus → destination kind (canonical). */
export function destinationTypeForStatus(
  status: AgentStatus,
  offlineMode: 'reception' | 'hidden' = 'reception',
): OfficeDestinationType {
  switch (status) {
    case 'idle':
    case 'waiting':
      return 'lounge'
    case 'working':
    case 'blocked':
      return 'workstation'
    case 'reviewing':
      return 'meeting'
    case 'verifying':
      return 'testing'
    case 'offline':
      return offlineMode === 'hidden' ? 'hidden' : 'reception'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

function preferredIndex(agentId: string, poolSize: number): number {
  if (poolSize <= 0) return 0
  return visualVariationSeed(agentId) % poolSize
}

/**
 * Stable pool fill: claimants sorted by agentId; each picks preferred free
 * index, else next free; excess → overflow (no dynamic furniture).
 */
function assignPool(
  agentIds: string[],
  pool: readonly string[],
  destinationType: OfficeDestinationType,
): OfficeAssignment[] {
  const free = new Set(pool.map((_, i) => i))
  const out: OfficeAssignment[] = []
  const sorted = agentIds.slice().sort((a, b) => a.localeCompare(b))

  for (const agentId of sorted) {
    if (free.size === 0) {
      out.push({
        agentId,
        destinationType,
        overflow: true,
      })
      continue
    }

    const pref = preferredIndex(agentId, pool.length)
    let chosen = -1
    for (let step = 0; step < pool.length; step++) {
      const i = (pref + step) % pool.length
      if (free.has(i)) {
        chosen = i
        break
      }
    }

    if (chosen < 0) {
      out.push({ agentId, destinationType, overflow: true })
      continue
    }

    free.delete(chosen)
    out.push({
      agentId,
      destinationType,
      waypointId: pool[chosen],
      slot: chosen + 1,
      overflow: false,
    })
  }

  return out
}

function deskPriority(status: AgentStatus): number {
  if (status === 'working') return 0
  if (status === 'blocked') return 1
  return 9
}

/**
 * Department desks for working/blocked only.
 * Reuses workstation capacity + waypoint id helpers.
 */
function assignDepartmentDesks(agents: Agent[]): OfficeAssignment[] {
  const claimants = agents
    .slice()
    .sort((a, b) => {
      const p = deskPriority(a.status) - deskPriority(b.status)
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

  const out: OfficeAssignment[] = []

  for (const agent of claimants) {
    const group = workstationGroupForAgent(agent)
    const cap = WORKSTATION_CAPACITY[group]
    used[group] += 1
    if (used[group] <= cap) {
      const slot = used[group]
      out.push({
        agentId: agent.id,
        destinationType: 'workstation',
        workstationGroup: group,
        slot,
        waypointId: workstationWaypointId(group, slot),
        overflow: false,
      })
    } else {
      out.push({
        agentId: agent.id,
        destinationType: 'workstation',
        workstationGroup: group,
        overflow: true,
      })
    }
  }

  return out
}

/**
 * Assign every agent a destination for the current runtime snapshot.
 * Pure + deterministic for identical (agents statuses + options).
 */
export function assignOfficeDestinations(
  agents: Agent[],
  options: OfficeAssignmentOptions = {},
): OfficeAssignmentResult {
  const offlineMode = options.offlineMode ?? 'reception'
  const byType: Record<OfficeDestinationType, Agent[]> = {
    lounge: [],
    workstation: [],
    meeting: [],
    testing: [],
    reception: [],
    hidden: [],
  }

  for (const agent of agents) {
    const type = destinationTypeForStatus(agent.status, offlineMode)
    byType[type].push(agent)
  }

  const assignments: OfficeAssignment[] = []

  assignments.push(
    ...assignPool(
      byType.lounge.map((a) => a.id),
      LOUNGE_WAYPOINTS,
      'lounge',
    ),
  )
  assignments.push(...assignDepartmentDesks(byType.workstation))
  assignments.push(
    ...assignPool(
      byType.meeting.map((a) => a.id),
      MEETING_SEATS,
      'meeting',
    ),
  )
  assignments.push(
    ...assignPool(
      byType.testing.map((a) => a.id),
      TESTING_DESKS,
      'testing',
    ),
  )

  for (const agent of byType.reception
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))) {
    assignments.push({
      agentId: agent.id,
      destinationType: 'reception',
      waypointId: RECEPTION_SPAWN,
      slot: 1,
      overflow: false,
    })
  }

  for (const agent of byType.hidden
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))) {
    assignments.push({
      agentId: agent.id,
      destinationType: 'hidden',
      overflow: false,
    })
  }

  // Stable output order by agentId (render-safe).
  assignments.sort((a, b) => a.agentId.localeCompare(b.agentId))

  const overflowByDestination: Partial<Record<OfficeDestinationType, string[]>> =
    {}
  for (const a of assignments) {
    if (!a.overflow) continue
    const list = overflowByDestination[a.destinationType] ?? []
    list.push(a.agentId)
    overflowByDestination[a.destinationType] = list
  }

  return { assignments, overflowByDestination }
}

/** Lookup helper for Scene / tests. */
export function assignmentForAgent(
  result: OfficeAssignmentResult,
  agentId: string,
): OfficeAssignment | undefined {
  return result.assignments.find((a) => a.agentId === agentId)
}
