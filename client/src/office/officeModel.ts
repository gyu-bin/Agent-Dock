import type { Agent, DivisionId } from '../domain/types'
import { t } from '../i18n'

/** Office view placement — separate from domain Agent so renderers can swap. */
export type RoomId =
  | DivisionId
  | 'meeting'
  | 'lounge'
  | 'reception'
  | 'plaza'

export interface OfficePlacement {
  agentId: string
  roomId: RoomId
  /** 0–100 within room */
  x: number
  y: number
}

export interface RoomDef {
  id: RoomId
  label: string
  accent: string
  /** CSS grid area name */
  area: string
  kind: 'department' | 'common'
}

export const OFFICE_ROOMS: RoomDef[] = [
  { id: 'product', label: t('room.product'), accent: '#ffc034', area: 'product', kind: 'department' },
  { id: 'game-development', label: t('room.game-development'), accent: '#508def', area: 'gamedev', kind: 'department' },
  { id: 'design', label: t('room.design'), accent: '#f59e9e', area: 'design', kind: 'department' },
  { id: 'research', label: t('room.research'), accent: '#818cf8', area: 'research', kind: 'department' },
  { id: 'engineering', label: t('room.engineering'), accent: '#64748b', area: 'eng', kind: 'department' },
  { id: 'marketing', label: t('room.marketing'), accent: '#34d399', area: 'marketing', kind: 'department' },
  { id: 'testing', label: t('room.testing'), accent: '#fb923c', area: 'testing', kind: 'department' },
  { id: 'meeting', label: t('room.meeting'), accent: '#64748b', area: 'meeting', kind: 'common' },
  { id: 'lounge', label: t('room.lounge'), accent: '#ffc034', area: 'lounge', kind: 'common' },
  { id: 'reception', label: t('room.reception'), accent: '#0f172a', area: 'reception', kind: 'common' },
  { id: 'plaza', label: t('room.entrance'), accent: '#34d399', area: 'plaza', kind: 'common' },
]

/** Map agent runtime status → room + position for Phase 1. */
export function placeAgents(agents: Agent[]): OfficePlacement[] {
  const roomBuckets: Record<string, Agent[]> = {}
  for (const agent of agents) {
    const room = roomForAgent(agent)
    ;(roomBuckets[room] ??= []).push(agent)
  }

  const placements: OfficePlacement[] = []
  for (const [roomId, list] of Object.entries(roomBuckets)) {
    list.forEach((agent, i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      placements.push({
        agentId: agent.id,
        roomId: roomId as RoomId,
        x: 18 + col * 28 + (row % 2) * 6,
        y: 38 + row * 22,
      })
    })
  }
  return placements
}

function roomForAgent(agent: Agent): RoomId {
  if (agent.status === 'reviewing' || agent.status === 'verifying') return 'meeting'
  if (agent.status === 'idle' || agent.status === 'waiting') return 'lounge'
  if (agent.status === 'offline') return 'reception'
  return agent.division
}
