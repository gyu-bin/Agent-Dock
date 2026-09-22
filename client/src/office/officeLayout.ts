import { getDepartment } from '../domain/departments'
import type { Agent, DivisionId } from '../domain/types'
import type { RoomDef, RoomId } from './officeModel'

export interface RoomAnchor {
  x: number
  y: number
  w: number
  h: number
}

const COMMON_ROOMS: RoomId[] = ['meeting', 'lounge', 'reception', 'plaza']

/** Divisions present on the current project team — each gets an office room. */
export function activeDepartmentIds(agents: Agent[]): DivisionId[] {
  const seen = new Set<DivisionId>()
  const ordered: DivisionId[] = []
  for (const a of agents) {
    if (seen.has(a.division)) continue
    seen.add(a.division)
    ordered.push(a.division)
  }
  return ordered
}

export function deskCountByDivision(agents: Agent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const a of agents) {
    counts[a.division] = (counts[a.division] ?? 0) + 1
  }
  return counts
}

export function roomDefForDivision(id: DivisionId): RoomDef {
  const d = getDepartment(id)
  return {
    id,
    label: d.label,
    accent: d.color,
    area: id,
    kind: 'department',
  }
}

/** Absolute floor anchors (percent) matching the dynamic OfficeScene layout. */
export function computeRoomAnchors(deptIds: DivisionId[]): Record<RoomId, RoomAnchor> {
  const anchors = {} as Record<RoomId, RoomAnchor>
  const n = deptIds.length
  const hasDept = n > 0

  const topY = 1
  const topH = hasDept ? 30 : 0
  const midY = hasDept ? 32 : 1
  const midH = hasDept ? 38 : 68
  const botY = 72
  const botH = 26

  if (hasDept) {
    const slot = 100 / n
    deptIds.forEach((id, i) => {
      anchors[id] = {
        x: i * slot + 0.4,
        y: topY,
        w: Math.max(slot - 0.8, 6),
        h: topH,
      }
    })
  }

  anchors.lounge = { x: 0.5, y: midY, w: 99, h: midH }
  anchors.meeting = { x: 0.5, y: botY, w: 18, h: botH }
  anchors.reception = { x: 20, y: botY, w: 30, h: botH }
  anchors.plaza = { x: 52, y: botY, w: 47, h: botH }

  // Fallback for any division not currently laid out (e.g. mid-transition).
  for (const id of deptIds) {
    if (!anchors[id]) {
      anchors[id] = { x: 0.5, y: midY, w: 20, h: midH }
    }
  }

  return anchors
}

export function isCommonRoom(id: RoomId): boolean {
  return (COMMON_ROOMS as string[]).includes(id)
}
