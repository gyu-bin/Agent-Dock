/**
 * Display scales relative to Character = 1.0 (CHAR_DISPLAY_PX).
 */
export const CHAR_SCALE = 1
export const CHAR_DISPLAY_PX = 48

export const FURNITURE_SCALE = {
  chair: { w: 0.75, h: 1.05 },
  desk: { w: 1.45, h: 1.2 },
  'dual-monitor-desk': { w: 1.75, h: 1.25 },
  bookshelf: { w: 0.8, h: 1.45 },
  sofa: { w: 2.4, h: 1.25 },
  armchair: { w: 1.0, h: 1.05 },
  'coffee-table': { w: 1.05, h: 0.95 },
  'coffee-machine': { w: 0.65, h: 0.9 },
  'coffee-bar': { w: 2.6, h: 1.15 },
  'bar-stool': { w: 0.55, h: 0.7 },
  'beanbag-pink': { w: 0.95, h: 0.85 },
  'beanbag-blue': { w: 0.95, h: 0.85 },
  'vending-machine': { w: 0.85, h: 1.55 },
  'floor-lamp': { w: 0.55, h: 1.35 },
  'presentation-display': { w: 1.8, h: 1.05 },
  'meeting-table': { w: 2.8, h: 1.55 },
  whiteboard: { w: 1.15, h: 1.05 },
  'server-rack': { w: 0.7, h: 1.45 },
  'reception-desk': { w: 2.7, h: 1.25 },
  'mascot-cat': { w: 0.55, h: 0.5 },
} as const

export const PLANT_SCALE = {
  'plant-small': { w: 0.4, h: 0.55 },
  'plant-medium': { w: 0.55, h: 0.8 },
  'plant-large': { w: 0.7, h: 1.1 },
  tree: { w: 1.15, h: 1.7 },
  'garden-plant': { w: 0.65, h: 0.95 },
} as const

export const ENV_SCALE = {
  bench: { w: 1.6, h: 1.05 },
  rug: { w: 2.2, h: 2.2 },
  'rug-pink': { w: 1.4, h: 1.4 },
  floor: { w: 1.2, h: 1.0 },
  'wood-floor': { w: 1.2, h: 1.0 },
  wall: { w: 2.2, h: 0.5 },
  doorway: { w: 1.2, h: 0.9 },
  'entrance-door': { w: 1.8, h: 1.35 },
  grass: { w: 1.1, h: 1.1 },
  'garden-path': { w: 0.85, h: 1.5 },
} as const

export function scaleToPx(
  relative: { w: number; h: number },
  basePx = CHAR_DISPLAY_PX,
): { width: number; height: number } {
  return {
    width: Math.round(basePx * relative.w),
    height: Math.round(basePx * relative.h),
  }
}
