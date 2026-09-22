import type { Agent, AgentStatus, DivisionId } from '../../domain/types'
import type { CharacterAnim, VisualRole } from '../assets/assetResolver'
import type { RoomId } from '../officeModel'
import type { RoomAnchor } from '../officeLayout'
import { activeDepartmentIds, computeRoomAnchors } from '../officeLayout'

/**
 * Visual layer — intentionally separate from domain Agent.
 * Swap DOM renderer for PixiJS later without changing Agent model.
 */
export type VisualAnimation =
  | 'idle'
  | 'walk'
  | 'work'
  | 'talk'
  | 'review'
  | 'blocked'

export interface AgentVisualState {
  agentId: string
  /** Absolute position within OfficeScene floor (percent 0–100) */
  x: number
  y: number
  destination?: { x: number; y: number }
  roomId: RoomId
  visualRole: VisualRole
  animation: VisualAnimation
  speech?: string
  showSpeech: boolean
}

const ROLE_BY_DIVISION: Partial<Record<DivisionId, VisualRole>> = {
  engineering: 'developer',
  design: 'designer',
  'game-development': 'game-designer',
  research: 'researcher',
  marketing: 'marketer',
  testing: 'tester',
  product: 'pm',
  'project-management': 'manager',
}

const ROLE_BY_HINT: Array<{ role: VisualRole; patterns: RegExp[] }> = [
  { role: 'pm', patterns: [/product-manager/, /product.manager/, /sprint-prioritizer/] },
  { role: 'manager', patterns: [/orchestrator/, /studio-producer/, /devops/, /admin/] },
  { role: 'developer', patterns: [/frontend/, /backend/, /mobile/, /code-reviewer/, /engineer/, /builder/] },
  { role: 'designer', patterns: [/ui-designer/, /ux/, /brand/, /visual/] },
  { role: 'game-designer', patterns: [/game-designer/, /level-designer/, /narrative/, /technical-artist/] },
  { role: 'researcher', patterns: [/research/, /trend/, /synthesist/] },
  { role: 'marketer', patterns: [/marketing/, /content/, /growth/, /app-store/] },
  { role: 'tester', patterns: [/test/, /qa/, /reality/] },
]

export function resolveVisualRole(agent: Agent): VisualRole {
  for (const rule of ROLE_BY_HINT) {
    if (rule.patterns.some((p) => p.test(agent.id) || p.test(agent.name.toLowerCase()))) {
      return rule.role
    }
  }
  return ROLE_BY_DIVISION[agent.division] ?? 'generic'
}

export function statusToAnimation(status: AgentStatus): VisualAnimation {
  switch (status) {
    case 'working':
      return 'work'
    case 'reviewing':
    case 'verifying':
      return 'review'
    case 'waiting':
      return 'idle'
    case 'blocked':
      return 'blocked'
    case 'idle':
      return 'idle'
    case 'offline':
      return 'idle'
    default:
      return 'idle'
  }
}

export function animationToSpriteAnim(anim: VisualAnimation): CharacterAnim {
  switch (anim) {
    case 'work':
      return 'working'
    case 'talk':
    case 'review':
      return 'talking'
    case 'walk':
      return 'walking'
    default:
      return 'idle'
  }
}

/** Default anchors — overridden per frame by buildVisualStates when layout is dynamic. */
export const ROOM_ANCHORS: Record<RoomId, RoomAnchor> = computeRoomAnchors([
  'product',
  'game-development',
  'design',
  'research',
  'engineering',
  'marketing',
  'testing',
])

/**
 * Lounge waypoints — scatter around sofa / coffee bar / books / beanbags.
 */
const LOUNGE_WAYPOINTS: Array<{ id: string; rx: number; ry: number }> = [
  { id: 'sofa-left', rx: 0.36, ry: 0.4 },
  { id: 'sofa-right', rx: 0.48, ry: 0.38 },
  { id: 'armchair-pink', rx: 0.66, ry: 0.48 },
  { id: 'armchair-blue', rx: 0.26, ry: 0.6 },
  { id: 'coffee-front', rx: 0.46, ry: 0.64 },
  { id: 'coffee-bar-a', rx: 0.72, ry: 0.36 },
  { id: 'coffee-bar-b', rx: 0.78, ry: 0.4 },
  { id: 'bookshelf', rx: 0.12, ry: 0.42 },
  { id: 'beanbag', rx: 0.78, ry: 0.72 },
  { id: 'standing-mid', rx: 0.42, ry: 0.78 },
  { id: 'standing-right', rx: 0.58, ry: 0.76 },
  { id: 'plant-corner', rx: 0.9, ry: 0.62 },
  { id: 'lamp-nook', rx: 0.18, ry: 0.28 },
]


export function roomForAgentStatus(agent: Agent): RoomId {
  if (agent.status === 'reviewing' || agent.status === 'verifying') return 'meeting'
  if (agent.status === 'offline') return 'reception'
  // Idle + waiting rest in lounge — only working/blocked stay at desks
  if (agent.status === 'idle' || agent.status === 'waiting') return 'lounge'

  if (agent.status === 'working' || agent.status === 'blocked') {
    // Any hired division gets its own room (including newly added teams).
    return agent.division
  }
  return 'lounge'
}

/** Max characters rendered per room before +N overflow. */
export const ROOM_CAPACITY: Partial<Record<RoomId, number>> = {
  product: 4,
  'game-development': 5,
  design: 4,
  research: 4,
  engineering: 8,
  marketing: 4,
  testing: 4,
  meeting: 8,
  lounge: 14,
  plaza: 6,
  reception: 2,
}

export function capacityForRoom(roomId: RoomId): number {
  return ROOM_CAPACITY[roomId] ?? 4
}

export function slotInRoom(
  roomId: RoomId,
  index: number,
  total: number,
  anchors: Record<string, RoomAnchor> = ROOM_ANCHORS,
): { x: number; y: number } {
  const a =
    anchors[roomId] ??
    ROOM_ANCHORS[roomId] ??
    anchors.lounge ??
    ROOM_ANCHORS.lounge

  if (roomId === 'lounge') {
    const wp = LOUNGE_WAYPOINTS[index % LOUNGE_WAYPOINTS.length]!
    return {
      x: a.x + a.w * wp.rx,
      y: a.y + a.h * wp.ry,
    }
  }

  if (roomId === 'meeting') {
    // Around meeting table — avoid stacking on table center
    const seats = [
      { rx: 0.22, ry: 0.42 },
      { rx: 0.38, ry: 0.38 },
      { rx: 0.55, ry: 0.38 },
      { rx: 0.72, ry: 0.42 },
      { rx: 0.28, ry: 0.72 },
      { rx: 0.48, ry: 0.74 },
      { rx: 0.68, ry: 0.72 },
      { rx: 0.5, ry: 0.28 },
    ]
    const s = seats[index % seats.length]
    return { x: a.x + a.w * s.rx, y: a.y + a.h * s.ry }
  }

  const shown = Math.min(total, capacityForRoom(roomId))
  const cols = Math.min(3, Math.max(1, shown))
  const col = index % cols
  const row = Math.floor(index / cols)
  const padX = a.w * 0.2
  const padY = a.h * 0.42
  const usableW = a.w - padX * 2
  const usableH = a.h - padY * 1.05
  const x = a.x + padX + (cols === 1 ? usableW * 0.5 : (usableW * (col + 0.5)) / cols)
  const y = a.y + padY + Math.min(row, 2) * (usableH / 3) + usableH * 0.08
  return { x, y }
}

export interface RoomOverflow {
  roomId: RoomId
  hidden: number
  x: number
  y: number
}

const DEFAULT_SPEECH: Partial<Record<VisualRole, string>> = {
  pm: '기획서 정리 중...',
  developer: '코드 구현 중...',
  designer: 'UI 시안 작업 중!',
  'game-designer': '게임 구조 설계 중...',
  researcher: '시장 조사 중...',
  marketer: '캠페인 아이디어 정리!',
  tester: '테스트 중...',
  manager: '일정 체크 중!',
  generic: '작업 중...',
}


export function buildVisualStates(
  agents: Agent[],
  anchors?: Record<string, RoomAnchor>,
): {
  states: AgentVisualState[]
  overflows: RoomOverflow[]
} {
  const layoutAnchors =
    anchors ?? computeRoomAnchors(activeDepartmentIds(agents))
  const buckets: Record<string, Agent[]> = {}
  for (const agent of agents) {
    const room = roomForAgentStatus(agent)
    ;(buckets[room] ??= []).push(agent)
  }

  const workingSpeechBudget = 4
  let speechUsed = 0

  const states: AgentVisualState[] = []
  const overflows: RoomOverflow[] = []

  for (const [roomIdRaw, list] of Object.entries(buckets)) {
    const roomId = roomIdRaw as RoomId
    const cap = Math.max(capacityForRoom(roomId), list.length)
    const visible = list.slice(0, Math.min(cap, 8))
    const hidden = list.length - visible.length

    visible.forEach((agent, i) => {
      const pos = slotInRoom(roomId, i, visible.length, layoutAnchors)
      const visualRole = resolveVisualRole(agent)
      const animation = statusToAnimation(agent.status)
      const isActiveSpeak =
        agent.status === 'working' ||
        agent.status === 'reviewing' ||
        agent.status === 'verifying' ||
        agent.status === 'blocked'
      const canSpeak =
        isActiveSpeak && speechUsed < workingSpeechBudget
          ? true
          : agent.status === 'idle' &&
              roomId === 'lounge' &&
              speechUsed < 2 &&
              i === 0
      if (canSpeak) speechUsed += 1

      states.push({
        agentId: agent.id,
        x: pos.x,
        y: pos.y,
        destination: pos,
        roomId,
        visualRole,
        animation,
        speech:
          agent.status === 'idle'
            ? '잠시 쉬는 중 ☕'
            : (agent.speech ?? DEFAULT_SPEECH[visualRole]),
        showSpeech: canSpeak,
      })
    })

    if (hidden > 0) {
      const a = layoutAnchors[roomId] ?? layoutAnchors.lounge
      if (a) {
        overflows.push({
          roomId,
          hidden,
          x: a.x + a.w - 3,
          y: a.y + a.h - 4,
        })
      }
    }
  }
  return { states, overflows }
}
