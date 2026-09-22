/**
 * Office V2 preparation barrel.
 * Import from here when Map renderer lands — not used by OfficeScene V1.
 */
export type {
  AssetStatus,
  OfficeV2VisualRole,
  FurnitureManifestEntry,
  EnvironmentManifestEntry,
  CharacterRoleManifest,
} from './manifestTypes'

export {
  resolveOfficeV2VisualRole,
  visualVariationSeed,
  pickVariationIndex,
} from './visualRole'

export {
  WORKSTATION_CAPACITY,
  TOTAL_WORKSTATIONS,
  assignWorkstations,
  workstationGroupForAgent,
  workstationWaypointId,
  type WorkstationClaim,
  type WorkstationAssignmentResult,
  type WorkstationGroup,
} from './workstationPolicy'

/** Public URL prefix for Office V2 assets. */
export const OFFICE_V2_ASSET_BASE = '/assets/office-v2'

export const OFFICE_V2_MANIFESTS = {
  furniture: `${OFFICE_V2_ASSET_BASE}/manifests/office-v2-furniture.json`,
  environment: `${OFFICE_V2_ASSET_BASE}/manifests/office-v2-environment.json`,
  characters: `${OFFICE_V2_ASSET_BASE}/manifests/office-v2-characters.json`,
} as const
