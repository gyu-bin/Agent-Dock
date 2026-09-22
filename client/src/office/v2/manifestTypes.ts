/**
 * Office V2 asset / runtime helper types.
 * Not wired into OfficeScene yet — preparation only.
 */

export type AssetStatus = 'missing' | 'ready' | 'rejected'

export type OfficeV2VisualRole =
  | 'pm'
  | 'developer'
  | 'game-developer'
  | 'designer'
  | 'researcher'
  | 'marketer'
  | 'qa'
  | 'reviewer'

export type DepthMode =
  | 'floor'
  | 'floor-decoration'
  | 'furniture-back'
  | 'y-sort'
  | 'wall-foreground'
  | 'speech-bubble'

export interface Anchor2 {
  x: number
  y: number
}

/** Collision footprint relative to world anchor (logical units). */
export interface CollisionBox {
  x: number
  y: number
  width: number
  height: number
}

export interface FurnitureManifestEntry {
  id: string
  src: string
  status: AssetStatus
  category: string
  logicalWidth: number
  logicalHeight: number
  anchor: Anchor2
  collision: CollisionBox | null
  depthMode: DepthMode
  blocksWalk?: boolean
  pilot?: boolean
  notes?: string
}

export interface EnvironmentManifestEntry {
  id: string
  src: string
  status: AssetStatus
  category: string
  logicalWidth: number
  logicalHeight: number
  anchor: Anchor2
  tileable?: boolean
  tileWidth?: number
  tileHeight?: number
  collision: CollisionBox | null
  depthMode: DepthMode
  optional?: boolean
  usage?: string[]
  notes?: string
}

export interface SpriteRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CharacterAnimDef {
  row: number
  frames: number
  fps: number
  loop: boolean
  rects: SpriteRect[]
  bake?: 'body-only'
}

export interface CharacterRoleManifest {
  roleId: OfficeV2VisualRole
  status: AssetStatus
  frameWidth: number
  frameHeight: number
  anchor: Anchor2
  atlas: string
  columns: number
  animations: Record<string, CharacterAnimDef>
  variations: {
    enabled: boolean
    hair: string[]
    outfit: string[]
    skin: string[]
    accessory: string[]
  }
}
