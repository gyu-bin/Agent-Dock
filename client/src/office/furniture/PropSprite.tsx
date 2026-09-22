import type { ReactNode } from 'react'
import {
  assetUrl,
  environmentPath,
  furniturePath,
  hasProductionPng,
  plantPath,
} from '../assets/assetResolver'
import { CHAR_DISPLAY_PX, scaleToPx } from '../assets/scale'
import {
  ENV_SCALE,
  FURNITURE_SCALE,
  PLANT_SCALE,
} from '../assets/scale'
import type { EnvironmentId, FurnitureId, PlantId } from '../assets/officeAssetCatalog'

type Kind = 'furniture' | 'plant' | 'environment'

interface Props {
  kind?: Kind
  id: string
  x: number
  y: number
  /** Override display size; otherwise uses scale system */
  width?: number
  height?: number
  /** SVG fallback when PNG not registered */
  fallback?: ReactNode
}

function resolvePath(kind: Kind, id: string): string {
  if (kind === 'plant') return plantPath(id)
  if (kind === 'environment') return environmentPath(id)
  return furniturePath(id)
}

function defaultSize(kind: Kind, id: string): { width: number; height: number } {
  if (kind === 'furniture' && id in FURNITURE_SCALE) {
    return scaleToPx(FURNITURE_SCALE[id as keyof typeof FURNITURE_SCALE])
  }
  if (kind === 'furniture' && (id === 'armchair-blue' || id === 'armchair-pink')) {
    return scaleToPx(FURNITURE_SCALE.armchair)
  }
  if (kind === 'plant' && id in PLANT_SCALE) {
    return scaleToPx(PLANT_SCALE[id as keyof typeof PLANT_SCALE])
  }
  if (kind === 'environment' && id in ENV_SCALE) {
    return scaleToPx(ENV_SCALE[id as keyof typeof ENV_SCALE])
  }
  return { width: CHAR_DISPLAY_PX, height: CHAR_DISPLAY_PX }
}

/**
 * Prefer transparent PNG via AssetResolver; otherwise render SVG fallback.
 * Never invents new art — only places provided assets.
 */
export function PropSprite({
  kind = 'furniture',
  id,
  x,
  y,
  width,
  height,
  fallback = null,
}: Props) {
  const rel = resolvePath(kind, id)
  if (!hasProductionPng(rel)) return <>{fallback}</>
  const size = defaultSize(kind, id)
  const w = width ?? size.width
  const h = height ?? size.height
  return (
    <image
      href={assetUrl(rel)}
      x={x}
      y={y}
      width={w}
      height={h}
      preserveAspectRatio="xMidYMid meet"
      style={{ pointerEvents: 'none' }}
    />
  )
}

export function hasPropSprite(
  id: string,
  kind: Kind = 'furniture',
): boolean {
  return hasProductionPng(resolvePath(kind, id))
}

export type { FurnitureId, PlantId, EnvironmentId }
