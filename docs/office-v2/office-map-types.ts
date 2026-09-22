/**
 * Agent Deck Office v2 — Map Domain Types (SPEC DRAFT)
 *
 * Location: docs/office-v2/ only. Do NOT import from production `client/src`
 * until an implementation phase explicitly promotes these types.
 *
 * Coordinate space: logical units, origin top-left, +x right, +y down.
 * Default map size: 1600 × 1000.
 */

export type OfficeDirection = 'up' | 'down' | 'left' | 'right'

export type CharacterAnimState =
  | 'idle'
  | 'walking'
  | 'working'
  | 'talking'
  | 'sitting'
  | 'reviewing'
  | 'blocked'

/** Runtime agent statuses that the office mapper understands. */
export type OfficeRuntimeStatus =
  | 'idle'
  | 'waiting'
  | 'working'
  | 'reviewing'
  | 'verifying'
  | 'blocked'
  | 'offline'

export type ZoneKind =
  | 'department'
  | 'lounge'
  | 'meeting'
  | 'reception'
  | 'hallway'
  | 'subzone'

export type ZoneId =
  | 'product'
  | 'design'
  | 'development'
  | 'game-development'
  | 'research'
  | 'marketing'
  | 'testing'
  | 'meeting'
  | 'lounge'
  | 'reception'
  | 'hall-north'
  | 'hall-south'
  | 'hall-center'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export interface OfficeZone {
  id: ZoneId
  label: string
  kind: ZoneKind
  /** Inclusive floor rectangle in logical units. */
  bounds: Rect
  /** Parent zone when this is a sub-zone (e.g. game-development ⊂ development). */
  parentId?: ZoneId
  /** Floor tile key from environment manifest. */
  floor: 'office-neutral' | 'lounge' | 'meeting' | 'reception'
  /** Soft accent for UI chrome / labels (not sprite tint). */
  accent: string
}

export type FurnitureCategory =
  | 'desk'
  | 'seat'
  | 'table'
  | 'storage'
  | 'appliance'
  | 'decor'
  | 'display'
  | 'reception'

export interface OfficeFurniture {
  id: string
  assetId: string
  zoneId: ZoneId
  category: FurnitureCategory
  /** World position of asset anchor (usually bottom-center of sprite). */
  x: number
  y: number
  /** Optional logical footprint for collision (independent of sprite pixels). */
  collision?: Rect
  /** Draw order hint relative to characters at same y. */
  depthBias?: number
  /** Blocks pathfinding through collision rect. */
  blocksWalk: boolean
  /** Facing of interactive side (for sitting / working). */
  face?: OfficeDirection
}

export type WaypointKind =
  | 'stand'
  | 'sit'
  | 'work'
  | 'talk'
  | 'entry'
  | 'exit'
  | 'hall'
  | 'spawn'

export interface OfficeWaypoint {
  id: string
  zoneId: ZoneId
  kind: WaypointKind
  x: number
  y: number
  /** Preferred facing when agent arrives idle. */
  face?: OfficeDirection
  /** Linked furniture (sofa arm, desk slot, etc.). */
  furnitureId?: string
  /** Max concurrent agents that may claim this waypoint. Default 1. */
  capacity?: number
}

export interface OfficeEdge {
  from: string
  to: string
  /** Optional travel cost; default = Euclidean distance. */
  cost?: number
  bidirectional?: boolean
}

export interface OfficeCollision {
  id: string
  /** Axis-aligned blocking rect. */
  bounds: Rect
  /** Optional link to furniture that owns this collider. */
  furnitureId?: string
  reason: 'wall' | 'furniture' | 'glass' | 'decor'
}

export interface OfficeWorkstation {
  id: string
  zoneId: ZoneId
  /** Desk furniture id. */
  deskId: string
  /** Chair furniture id. */
  chairId: string
  /** Where the character stands/sits to work — NOT the desk sprite origin. */
  interactionWaypointId: string
  /** Optional conversation point beside the desk (handoffs). */
  talkWaypointId?: string
  /** Preferred department / role tags that claim this slot first. */
  preferredRoles?: string[]
}

export interface OfficeMap {
  id: string
  version: string
  width: number
  height: number
  units: 'logical'
  camera: {
    mode: 'fit-contain'
    /** Logical map always fits viewport; zoom/pan may be added later. */
    allowZoomPan: boolean
  }
  zones: OfficeZone[]
  furniture: OfficeFurniture[]
  waypoints: OfficeWaypoint[]
  edges: OfficeEdge[]
  collisions: OfficeCollision[]
  workstations: OfficeWorkstation[]
}

/** Maps one runtime agent into an office placement intent. */
export interface OfficePlacementIntent {
  agentId: string
  status: OfficeRuntimeStatus
  preferredZoneId: ZoneId
  preferredWaypointId?: string
  animation: CharacterAnimState
  direction: OfficeDirection
  speech?: string
}

export interface PathStep {
  waypointId: string
  x: number
  y: number
}

export interface NavigationPath {
  from: string
  to: string
  steps: PathStep[]
  totalCost: number
}
