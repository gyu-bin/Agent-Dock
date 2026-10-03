import { readFile } from 'node:fs/promises'
import path from 'node:path'
import TOML from '@iarna/toml'
import { resolveAgentSource, type AgentSource } from './agentSource.js'
import { AgentInstructionError } from './agentInstructionError.js'
import { verifyBundledInstruction } from './bundleManifest.js'

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

/**
 * Server-side lookup for full agent persona.
 * Never include developer_instructions in list API responses.
 */
export async function loadAgentInstructions(
  agentId: string,
  sourceOrDirectory?: AgentSource | string,
): Promise<AgentInstructions> {
  const source = typeof sourceOrDirectory === 'object' ? sourceOrDirectory : await resolveAgentSource(sourceOrDirectory)
  const id = agentId.trim()
  const filePath = path.join(source.directory, `${id}.toml`)
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new AgentInstructionError('AGENT_INSTRUCTION_FILE_NOT_FOUND', id, source, source.directory)
  }
  if (!source.available) throw new AgentInstructionError('AGENT_SOURCE_UNAVAILABLE', id, source, filePath)
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    const missing = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
    throw new AgentInstructionError(missing ? 'AGENT_INSTRUCTION_FILE_NOT_FOUND' : 'AGENT_INSTRUCTION_READ_FAILED', id, source, filePath, error)
  }
  let parsed: TomlAgent
  if (source.type === 'bundled') {
    try { await verifyBundledInstruction(source.directory, id, raw) }
    catch (error) { throw new AgentInstructionError('AGENT_BUNDLE_INVALID', id, source, filePath, error) }
  }
  try { parsed = TOML.parse(raw) as TomlAgent }
  catch (error) { throw new AgentInstructionError('AGENT_INSTRUCTION_PARSE_FAILED', id, source, filePath, error) }
  const developerInstructions = typeof parsed.developer_instructions === 'string' ? parsed.developer_instructions.trim() : ''
  if (!developerInstructions) throw new AgentInstructionError('AGENT_INSTRUCTION_MISSING_FIELD', id, source, filePath)
  return { id, name: typeof parsed.name === 'string' ? parsed.name : id, description: typeof parsed.description === 'string' ? parsed.description : '', developerInstructions, filePath }
}

export async function preflightAgentInstructions(agentIds: string[]) {
  const source = await resolveAgentSource()
  const agents = []
  for (const agentId of [...new Set(agentIds)]) {
    await loadAgentInstructions(agentId, source)
    agents.push({ agentId, instructionAvailable: true })
  }
  return { ok: true, source, agents }
}
