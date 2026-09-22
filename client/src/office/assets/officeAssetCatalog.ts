/**
 * Canonical PNG asset ids and paths for Office.
 * Until registered via SHIPPED_PRODUCTION_PNGS, SheetProps remains fallback.
 */

export type FurnitureId =
  | 'desk'
  | 'dual-monitor-desk'
  | 'chair'
  | 'bookshelf'
  | 'sofa'
  | 'armchair'
  | 'coffee-table'
  | 'coffee-machine'
  | 'coffee-bar'
  | 'bar-stool'
  | 'beanbag-pink'
  | 'beanbag-blue'
  | 'vending-machine'
  | 'floor-lamp'
  | 'presentation-display'
  | 'meeting-table'
  | 'whiteboard'
  | 'server-rack'
  | 'reception-desk'
  | 'mascot-cat'

export type PlantId =
  | 'plant-small'
  | 'plant-medium'
  | 'plant-large'
  | 'tree'
  | 'garden-plant'

export type EnvironmentId =
  | 'bench'
  | 'rug'
  | 'rug-pink'
  | 'floor'
  | 'wood-floor'
  | 'wall'
  | 'doorway'
  | 'entrance-door'
  | 'grass'
  | 'garden-path'

export const FURNITURE_PATHS: Record<FurnitureId, string> = {
  desk: 'furniture/desk.png',
  'dual-monitor-desk': 'furniture/dual-monitor-desk.png',
  chair: 'furniture/chair.png',
  bookshelf: 'furniture/bookshelf.png',
  sofa: 'furniture/sofa.png',
  armchair: 'furniture/armchair.png',
  'coffee-table': 'furniture/coffee-table.png',
  'coffee-machine': 'furniture/coffee-machine.png',
  'coffee-bar': 'furniture/coffee-bar.png',
  'bar-stool': 'furniture/bar-stool.png',
  'beanbag-pink': 'furniture/beanbag-pink.png',
  'beanbag-blue': 'furniture/beanbag-blue.png',
  'vending-machine': 'furniture/vending-machine.png',
  'floor-lamp': 'furniture/floor-lamp.png',
  'presentation-display': 'furniture/presentation-display.png',
  'meeting-table': 'furniture/meeting-table.png',
  whiteboard: 'furniture/whiteboard.png',
  'server-rack': 'furniture/server-rack.png',
  'reception-desk': 'furniture/reception-desk.png',
  'mascot-cat': 'furniture/mascot-cat.png',
}

export const PLANT_PATHS: Record<PlantId, string> = {
  'plant-small': 'plants/plant-small.png',
  'plant-medium': 'plants/plant-medium.png',
  'plant-large': 'plants/plant-large.png',
  tree: 'plants/tree.png',
  'garden-plant': 'plants/garden-plant.png',
}

export const ENVIRONMENT_PATHS: Record<EnvironmentId, string> = {
  bench: 'environment/bench.png',
  rug: 'environment/rug.png',
  'rug-pink': 'environment/rug-pink.png',
  floor: 'environment/floor.png',
  'wood-floor': 'environment/wood-floor.png',
  wall: 'environment/wall.png',
  doorway: 'environment/doorway.png',
  'entrance-door': 'environment/entrance-door.png',
  grass: 'environment/grass.png',
  'garden-path': 'environment/garden-path.png',
}

export const REQUIRED_OFFICE_PNGS: string[] = [
  ...Object.values(FURNITURE_PATHS),
  ...Object.values(PLANT_PATHS),
  ...Object.values(ENVIRONMENT_PATHS),
]

export const SHIPPED_PRODUCTION_PNGS: string[] = [
  ...Object.values(FURNITURE_PATHS),
  ...Object.values(PLANT_PATHS),
  ...Object.values(ENVIRONMENT_PATHS),
  'furniture/armchair-blue.png',
  'furniture/armchair-pink.png',
]
