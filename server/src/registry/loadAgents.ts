import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import TOML from '@iarna/toml'
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
  total: number
  agentsDir?: string
  divisionMapSource: DivisionMapSource
  divisionMapCount: number
  warning?: string
}

interface TomlAgent {
  name?: string
  description?: string
}

function defaultAgentsDir(): string {
  return process.env.AGENT_DECK_AGENTS_DIR ?? path.join(os.homedir(), '.codex', 'agents')
}

export async function loadAgentRegistry(
  agentsDir = defaultAgentsDir(),
): Promise<RegistryResult> {
  const divisionMap = await loadDivisionMap()

  try {
    const entries = await readdir(agentsDir)
    const tomls = entries.filter((f) => f.endsWith('.toml'))
    if (tomls.length === 0) {
      return {
        agents: applyDivisions(getMockRegistry(), divisionMap.slugToDivision),
        source: 'mock',
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
        const raw = await readFile(path.join(agentsDir, file), 'utf8')
        const parsed = TOML.parse(raw) as TomlAgent
        agents.push({
          id,
          name: parsed.name ?? id,
          description: parsed.description ?? '',
          division: resolveDivision(id, divisionMap.slugToDivision),
          status: 'idle',
          enabled: true,
        })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        agents.push({
          id,
          name: id,
          description: `Failed to parse TOML: ${reason}`,
          division: resolveDivision(id, divisionMap.slugToDivision),
          status: 'idle',
          enabled: true,
        })
      }
    }

    agents.sort((a, b) => a.name.localeCompare(b.name))
    return {
      agents,
      source: 'filesystem',
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
    division: resolveDivision(a.id, map),
  }))
}
