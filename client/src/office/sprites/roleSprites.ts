/**
 * Role → sprite-gen atlas bundles under /assets/sprites/roles/{role}/
 * Role Base + hair/color/outfit variation (later) — not 279 unique sprites.
 */

import type { VisualRole } from '../assets/assetResolver'

export interface RoleSpriteBundle {
  /** Directory under /assets */
  bundleDir: string
  manifestPath: string
}

/**
 * Registered role atlases. Only roles with a shipped atlas are listed.
 * Developer Pilot currently ships as roles/developer (see public/assets/sprites).
 */
const ROLE_BUNDLES: Partial<Record<VisualRole, RoleSpriteBundle>> = {
  developer: {
    bundleDir: 'sprites/roles/developer',
    manifestPath: 'sprites/roles/developer/manifest.json',
  },
}

/** Roles planned for sprite-gen expansion (idle, walk-*, work, talk). */
export const PLANNED_ROLE_SPRITES: VisualRole[] = [
  'pm',
  'developer',
  'game-designer',
  'designer',
  'researcher',
  'marketer',
  'tester',
  'manager',
]

export function roleSpriteBundle(
  role: VisualRole,
): RoleSpriteBundle | null {
  return ROLE_BUNDLES[role] ?? null
}

export function hasRoleSpriteAtlas(role: VisualRole): boolean {
  return Boolean(ROLE_BUNDLES[role])
}

/** Register a newly generated role atlas at runtime (tests / future loader). */
export function registerRoleSpriteBundle(
  role: VisualRole,
  bundle: RoleSpriteBundle,
) {
  ROLE_BUNDLES[role] = bundle
}
