/**
 * Client-side division lookup using the committed agency-agents map.
 * Runtime server scan is authoritative when /api/agents succeeds.
 */
import type { DivisionId } from '../domain/types'
import agencyDivisionMap from './agencyDivisionMap.json'

const SLUG_TO_DIVISION = agencyDivisionMap.slugToDivision as Record<string, DivisionId>

export function resolveDivision(agentId: string): DivisionId {
  const key = agentId.toLowerCase().replace(/_/g, '-')
  return SLUG_TO_DIVISION[key] ?? 'specialized'
}

export function getDivisionMapCount(): number {
  return Object.keys(SLUG_TO_DIVISION).length
}
