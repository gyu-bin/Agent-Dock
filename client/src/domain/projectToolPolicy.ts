/**
 * Project Tool Policy — Global Default ← Project Override ← Task Requirement.
 * Does not invent new capability systems; resolves display/enablement only.
 */

import type { ProjectToolPolicy } from './types'

export type ToolPolicyKey =
  | 'openai'
  | 'codex'
  | 'webSearch'
  | 'image'
  | 'buffer'

export type ResolvedToolPolicy = Record<
  ToolPolicyKey,
  {
    effective: 'enabled' | 'disabled'
    source: 'global' | 'project' | 'task'
  }
>

export function resolveProjectToolPolicy(input: {
  global: Partial<Record<ToolPolicyKey, boolean>>
  project?: ProjectToolPolicy | null
  /** Task-level hard requirements (e.g. template needs web search) */
  taskRequires?: Partial<Record<ToolPolicyKey, boolean>>
}): ResolvedToolPolicy {
  const keys: ToolPolicyKey[] = [
    'openai',
    'codex',
    'webSearch',
    'image',
    'buffer',
  ]
  const out = {} as ResolvedToolPolicy
  for (const key of keys) {
    const globalOn = Boolean(input.global[key])
    const override = input.project?.[key] ?? 'inherit'
    let effective: 'enabled' | 'disabled' = globalOn ? 'enabled' : 'disabled'
    let source: 'global' | 'project' | 'task' = 'global'
    if (override === 'enabled') {
      effective = 'enabled'
      source = 'project'
    } else if (override === 'disabled') {
      effective = 'disabled'
      source = 'project'
    }
    if (input.taskRequires?.[key] === true) {
      // Task requirement cannot invent availability — only surfaces need
      source = 'task'
      if (!globalOn && override !== 'enabled') {
        effective = 'disabled'
      }
    }
    out[key] = { effective, source }
  }
  return out
}
