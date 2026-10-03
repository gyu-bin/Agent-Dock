import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveAgentSource, type AgentSource } from './agentSource.js'
import { loadAgentInstructions } from './loadAgentInstructions.js'
import { AgentInstructionError } from './agentInstructionError.js'
import type { AgentRecord } from '../types.js'
import {
  loadDivisionMap,
  resolveDivision,
  type DivisionMapSource,
} from './divisionMap.js'
import { getMockRegistry, MOCK_TOTAL_HINT } from './mockAgents.js'

export interface RegistryResult {
  agents: AgentRecord[]
  source: 'filesystem' | 'mock'
  state: 'REAL' | 'FALLBACK'
  executableCount: number
  instructionErrors: number
  resolvedSource: AgentSource
  total: number
  agentsDir?: string
  divisionMapSource: DivisionMapSource
  divisionMapCount: number
  warning?: string
}

export async function loadAgentRegistry(runtimeDirectory?: string): Promise<RegistryResult> {
  const resolvedSource = await resolveAgentSource(runtimeDirectory)
  const agentsDir = resolvedSource.directory
  const divisionMap = await loadDivisionMap()

  try {
    if (!resolvedSource.available) throw Object.assign(new Error('Agent source unavailable'), { code: resolvedSource.failureCode })
    const entries = await readdir(agentsDir)
    const tomls = entries.filter((f) => f.endsWith('.toml'))
    if (tomls.length === 0) {
      return {
        agents: applyDivisions(getMockRegistry(), divisionMap.slugToDivision),
        source: 'mock',
        state: 'FALLBACK',
        executableCount: 0,
        instructionErrors: 0,
        resolvedSource,
        total: MOCK_TOTAL_HINT,
        agentsDir,
        divisionMapSource: divisionMap.source,
        divisionMapCount: divisionMap.agentCount,
        warning: `No .toml files in ${agentsDir}; using mock registry`,
      }
    }

    const agents: AgentRecord[] = []
    for (const file of tomls) {
      const id = file.replace(/\.toml$/, '')
      try {
        const parsed = await loadAgentInstructions(id, resolvedSource)
        agents.push({
          id,
          name: parsed.name ?? id,
          description: parsed.description ?? '',
          division: resolveDivision(id, divisionMap.slugToDivision),
          status: 'idle',
          enabled: true,
          executable: true,
          instructionAvailable: true,
          source: { type: 'filesystem', directory: agentsDir, instructionPath: path.join(agentsDir, file) },
        })
      } catch (err) {
        const code = err instanceof AgentInstructionError ? err.code : 'AGENT_INSTRUCTION_READ_FAILED'
        agents.push({
          id,
          name: id,
          description: 'Agent instructions unavailable',
          division: resolveDivision(id, divisionMap.slugToDivision),
          status: 'idle',
          enabled: true,
          executable: false,
          instructionAvailable: false,
          instructionErrorCode: code,
          source: { type: 'filesystem', directory: agentsDir, instructionPath: path.join(agentsDir, file) },
        })
      }
    }

    agents.sort((a, b) => a.name.localeCompare(b.name))
    return {
      agents,
      source: 'filesystem',
      state: 'REAL',
      executableCount: agents.filter((a) => a.executable).length,
      instructionErrors: agents.filter((a) => !a.instructionAvailable).length,
      resolvedSource,
      total: agents.length,
      agentsDir,
      divisionMapSource: divisionMap.source,
      divisionMapCount: divisionMap.agentCount,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      agents: applyDivisions(getMockRegistry(), divisionMap.slugToDivision),
      source: 'mock',
        state: 'FALLBACK',
        executableCount: 0,
        instructionErrors: 0,
        resolvedSource,
      total: MOCK_TOTAL_HINT,
      agentsDir,
      divisionMapSource: divisionMap.source,
      divisionMapCount: divisionMap.agentCount,
      warning: `Cannot read agents dir (${agentsDir}): ${reason}; using mock registry`,
    }
  }
}

function applyDivisions(
  agents: AgentRecord[],
  map: Record<string, import('../types.js').DivisionId>,
): AgentRecord[] {
  return agents.map((a) => ({
    ...a,
    executable: false,
    instructionAvailable: false,
    source: { type: 'mock' as const },
    division: resolveDivision(a.id, map),
  }))
}
