/** @deprecated Prefer `roleSprites` — Pilot is Role Base `developer`. */
import type { Agent } from '../../domain/types'
import type { VisualRole } from '../assets/assetResolver'
import { hasRoleSpriteAtlas } from './roleSprites'

export const PILOT_CHARACTER_ID = 'frontend-developer'
export const PILOT_SPRITE_BUNDLE = 'sprites/roles/developer'
export const PILOT_MANIFEST_PATH = `${PILOT_SPRITE_BUNDLE}/manifest.json`

export function isPilotSpriteAgent(_agent: Agent, visualRole: VisualRole): boolean {
  return visualRole === 'developer' && hasRoleSpriteAtlas('developer')
}
