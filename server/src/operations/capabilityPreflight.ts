/**
 * Capability preflight for Routine execution.
 * Mirrors Tool Registry — never claims future tools as covered.
 */

import {
  FUTURE_CAPABILITIES,
  RUNTIME_GATED_CAPABILITIES,
  type StoredProjectRoutine,
} from '../persistence/operationsTypes.js'

/** Local mirror of client tool availability for preflight (no client import). */
const AVAILABLE_CAPABILITIES = new Set([
  'project.plan',
  'research.analyze',
  'research.synthesize',
  'research.web',
  'design.analyze',
  'design.ui',
  'content.write',
  'marketing.plan',
  'marketing.content',
  'marketing.research',
  'document.write',
  'code.inspect',
  'code.write',
  'code.test',
  'code.review',
])

/** Set when ImageGenerationProvider is configured (server boot / settings). */
let imageGenerateAvailable = false
/** Set when at least one SocialConnector can publish (never auto-fake). */
let socialPublishAvailable = false
/** Set when at least one connector exposes analytics.read. */
let analyticsReadAvailable = false

export function setImageGenerateAvailable(available: boolean): void {
  imageGenerateAvailable = available
}

export function isImageGenerateAvailable(): boolean {
  return imageGenerateAvailable
}

export function setSocialPublishAvailable(available: boolean): void {
  socialPublishAvailable = available
}

export function isSocialPublishAvailable(): boolean {
  return socialPublishAvailable
}

export function setAnalyticsReadAvailable(available: boolean): void {
  analyticsReadAvailable = available
}

export function isAnalyticsReadAvailable(): boolean {
  return analyticsReadAvailable
}

export type CapabilityCoverageStatus = 'covered' | 'missing' | 'unavailable'

export interface CapabilityPreflightResult {
  covered: string[]
  missing: string[]
  unavailable: string[]
  /** Required caps that block execution */
  blocking: string[]
  /** Optional/future caps — informational only */
  optionalUnavailable: string[]
  ok: boolean
  message?: string
}

export function classifyCapability(
  capability: string,
): CapabilityCoverageStatus {
  if (capability === 'image.generate') {
    return imageGenerateAvailable ? 'covered' : 'unavailable'
  }
  if (capability === 'social.publish') {
    return socialPublishAvailable ? 'covered' : 'unavailable'
  }
  if (capability === 'analytics.read') {
    return analyticsReadAvailable ? 'covered' : 'unavailable'
  }
  if (FUTURE_CAPABILITIES.has(capability)) return 'unavailable'
  if (AVAILABLE_CAPABILITIES.has(capability)) return 'covered'
  if (RUNTIME_GATED_CAPABILITIES.has(capability)) return 'unavailable'
  return 'missing'
}

export function preflightRoutineCapabilities(
  routine: Pick<
    StoredProjectRoutine,
    'requiredCapabilities' | 'futureCapabilities' | 'name'
  >,
): CapabilityPreflightResult {
  const covered: string[] = []
  const missing: string[] = []
  const unavailable: string[] = []
  const blocking: string[] = []

  for (const cap of routine.requiredCapabilities) {
    const status = classifyCapability(cap)
    if (status === 'covered') covered.push(cap)
    else if (status === 'unavailable') {
      unavailable.push(cap)
      blocking.push(cap)
    } else {
      missing.push(cap)
      blocking.push(cap)
    }
  }

  const optionalUnavailable = (routine.futureCapabilities ?? []).filter(
    (c) => classifyCapability(c) !== 'covered',
  )

  const ok = blocking.length === 0
  let message: string | undefined
  if (!ok) {
    const first = blocking[0]!
    if (first === 'social.publish') {
      message = '게시 도구가 연결되지 않았습니다.'
    } else if (FUTURE_CAPABILITIES.has(first)) {
      message = `${first} 도구가 연결되지 않았습니다.`
    } else {
      message = `필수 capability를 충족할 수 없습니다: ${blocking.join(', ')}`
    }
  }

  return {
    covered,
    missing,
    unavailable,
    blocking,
    optionalUnavailable,
    ok,
    message,
  }
}

/** Whether auto-start of tasks is allowed for this routine policy + caps. */
export function shouldAutoStartTasks(
  routine: StoredProjectRoutine,
  preflight: CapabilityPreflightResult,
): boolean {
  if (!preflight.ok) return false
  const policy = routine.executionPolicy
  if (policy.autoStartTasks === false) return false
  if (policy.autoStartTasks === true) return true

  // Default: research/read-only routines may auto-start; write/external need approval path
  const hasWrite = routine.requiredCapabilities.some(
    (c) => c.startsWith('code.write') || c === 'code.write',
  )
  const hasExternal = routine.requiredCapabilities.some(
    (c) => c === 'social.publish',
  )
  if (hasWrite || hasExternal) return false
  if (policy.requireApprovalForWrite && hasWrite) return false
  if (policy.autoResearch || policy.autoPlan) return true
  return false
}

export function workflowImpliesWrite(
  workflowTemplateId: string | undefined,
): boolean {
  if (!workflowTemplateId) return false
  const writeTemplates = new Set([
    'FEATURE_IMPLEMENTATION',
    'BUGFIX',
    'IMPLEMENT_FROM_PLAN',
    'CODE_CHANGE',
  ])
  return writeTemplates.has(workflowTemplateId)
}
