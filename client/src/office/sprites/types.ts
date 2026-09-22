/** sprite-gen runtime manifest (subset we consume). */

export interface SpriteFrameRect {
  x: number
  y: number
  w: number
  h: number
}

export interface SpriteAnimRow {
  row: number
  frames: number
  fps: number
  durations_ms: number[]
  loop: boolean
  frame_variant?: string
}

export interface SpriteManifest {
  characterId: string
  game_input: string
  sprite_sheet_alpha?: string
  animation: {
    cellWidth: number
    cellHeight: number
    columns: number
    rows: Record<string, SpriteAnimRow>
  }
  frame_layout: {
    sheetWidth: number
    sheetHeight: number
    cellWidth: number
    cellHeight: number
    rows: Record<string, SpriteFrameRect[]>
  }
}

export type SpriteFacing = 'down' | 'up' | 'left' | 'right'

export type SpriteStateId =
  | 'idle'
  | 'walk-down'
  | 'walk-up'
  | 'walk-left'
  | 'walk-right'
  | 'work'
  | 'talk'

export function resolveSpriteState(
  animation: string,
  facing: SpriteFacing,
  moving: boolean,
): SpriteStateId {
  if (moving) {
    switch (facing) {
      case 'up':
        return 'walk-up'
      case 'left':
        return 'walk-left'
      case 'right':
        return 'walk-right'
      default:
        return 'walk-down'
    }
  }
  switch (animation) {
    case 'work':
      return 'work'
    case 'talk':
    case 'review':
      return 'talk'
    case 'walk':
      return resolveSpriteState('idle', facing, true)
    default:
      return 'idle'
  }
}

export function facingFromDelta(dx: number, dy: number): SpriteFacing {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  if (Math.abs(dy) < 0.05) return 'down'
  return dy < 0 ? 'up' : 'down'
}
