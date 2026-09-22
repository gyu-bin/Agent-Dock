/**
 * Asset resolver — PNG when registered/on disk, otherwise SVG/CSS fallback.
 * Do not invent furniture art here; only resolve paths.
 */

import {
  ENVIRONMENT_PATHS,
  FURNITURE_PATHS,
  PLANT_PATHS,
  SHIPPED_PRODUCTION_PNGS,
  type EnvironmentId,
  type FurnitureId,
  type PlantId,
} from './officeAssetCatalog'

export type VisualRole =
  | 'pm'
  | 'developer'
  | 'designer'
  | 'game-designer'
  | 'researcher'
  | 'marketer'
  | 'tester'
  | 'manager'
  | 'generic'

export type CharacterAnim = 'idle' | 'working' | 'talking' | 'walking'

const checked = new Map<string, boolean>()

export function assetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\//, '')
  return `/assets/${clean}`
}

/** Async existence check (cached). */
export async function assetExists(relativePath: string): Promise<boolean> {
  const url = assetUrl(relativePath)
  if (checked.has(url)) return checked.get(url)!
  try {
    const res = await fetch(url, { method: 'HEAD' })
    const ok = res.ok
    checked.set(url, ok)
    return ok
  } catch {
    checked.set(url, false)
    return false
  }
}

export function characterSpritePath(
  role: VisualRole,
  anim: CharacterAnim,
): string {
  const folder = role === 'generic' ? 'developer' : role
  return `characters/${folder}/${anim}.png`
}

export function furniturePath(id: string): string {
  if (id in FURNITURE_PATHS) return FURNITURE_PATHS[id as FurnitureId]
  // legacy aliases
  const legacy: Record<string, string> = {
    'desk-dual': FURNITURE_PATHS['dual-monitor-desk'],
    dual: FURNITURE_PATHS['dual-monitor-desk'],
    coffee: FURNITURE_PATHS['coffee-machine'],
    armchairs: FURNITURE_PATHS.armchair,
    server: FURNITURE_PATHS['server-rack'],
    reception: FURNITURE_PATHS['reception-desk'],
    plant: PLANT_PATHS['plant-medium'],
  }
  return legacy[id] ?? `furniture/${id}.png`
}

export function plantPath(id: PlantId | string): string {
  if (id in PLANT_PATHS) return PLANT_PATHS[id as PlantId]
  return `plants/${id}.png`
}

export function environmentPath(id: EnvironmentId | string): string {
  if (id in ENVIRONMENT_PATHS) return ENVIRONMENT_PATHS[id as EnvironmentId]
  return `environment/${id}.png`
}

/**
 * Sync registry of production-ready PNGs that actually ship under /public/assets.
 * Seeded from SHIPPED_PRODUCTION_PNGS — do not fake-register missing files.
 */
const PRODUCTION_PNG = new Set<string>()

export function hasProductionPng(relativePath: string): boolean {
  return PRODUCTION_PNG.has(relativePath)
}

export function registerProductionPng(relativePath: string) {
  PRODUCTION_PNG.add(relativePath.replace(/^\//, '').replace(/^assets\//, ''))
}

export function listProductionPngs(): string[] {
  return [...PRODUCTION_PNG].sort()
}

for (const path of SHIPPED_PRODUCTION_PNGS) {
  registerProductionPng(path)
}

/** Sheet archetype look — hair / outfit for SVG character fallback only. */
export const ROLE_LOOK: Record<
  VisualRole,
  { hair: string; body: string; accent: string; label: string }
> = {
  pm: { hair: '#1e293b', body: '#3b82f6', accent: '#1e3a8a', label: 'PM' },
  developer: { hair: '#78350f', body: '#57534e', accent: '#292524', label: 'Dev' },
  'game-designer': { hair: '#fbbf24', body: '#fef3c7', accent: '#d97706', label: 'Game' },
  designer: { hair: '#f472b6', body: '#1e3a8a', accent: '#312e81', label: 'Design' },
  researcher: { hair: '#60a5fa', body: '#3b82f6', accent: '#1d4ed8', label: 'Research' },
  marketer: { hair: '#fb923c', body: '#1e3a8a', accent: '#f97316', label: 'Market' },
  tester: { hair: '#1e293b', body: '#64748b', accent: '#0f172a', label: 'QA' },
  manager: { hair: '#f1f5f9', body: '#0f172a', accent: '#508def', label: 'Admin' },
  generic: { hair: '#64748b', body: '#94a3b8', accent: '#475569', label: 'Agent' },
}
