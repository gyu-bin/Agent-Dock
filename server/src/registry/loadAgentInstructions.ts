import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import TOML from '@iarna/toml'

export interface AgentInstructions {
  id: string
  name: string
  description: string
  developerInstructions: string
  filePath: string
}

interface TomlAgent {
  name?: string
  description?: string
  developer_instructions?: string
}

function agentsDir(): string {
  return process.env.AGENT_DECK_AGENTS_DIR ?? path.join(os.homedir(), '.codex', 'agents')
}

/**
 * Server-side lookup for full agent persona.
 * Never include developer_instructions in list API responses.
 */
export async function loadAgentInstructions(
  agentId: string,
): Promise<AgentInstructions | null> {
  const id = agentId.trim()
  if (!id || id.includes('/') || id.includes('..')) return null
  const filePath = path.join(agentsDir(), `${id}.toml`)
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = TOML.parse(raw) as TomlAgent
    const developerInstructions = (parsed.developer_instructions ?? '').trim()
    if (!developerInstructions) return null
    return {
      id,
      name: parsed.name ?? id,
      description: parsed.description ?? '',
      developerInstructions,
      filePath,
    }
  } catch {
    return null
  }
}
