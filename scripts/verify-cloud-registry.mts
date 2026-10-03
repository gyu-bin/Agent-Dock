import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temporary = await mkdtemp(path.join(os.tmpdir(), 'agent-deck-cloud-registry-'))
const original = { ...process.env }
process.env.HOME = temporary
process.env.AGENT_DECK_SETTINGS_FILE = path.join(temporary, 'settings.json')
process.env.AGENT_DECK_AGENTS_DIR = '/definitely-unavailable-local-path'
process.env.AGENT_DECK_CLOUD = '1'
const { loadAgentRegistry } = await import('../server/src/registry/loadAgents.js')
const { resolveAgentSource } = await import('../server/src/registry/agentSource.js')
const { loadAgentInstructions, preflightAgentInstructions } = await import('../server/src/registry/loadAgentInstructions.js')
const { AgentInstructionError } = await import('../server/src/registry/agentInstructionError.js')
try {
  const cloud = await loadAgentRegistry('/Users/never-read/.codex/agents')
  assert.equal(cloud.source, 'bundled')
  assert.equal(cloud.state, 'REAL')
  const manifest = JSON.parse(await readFile(path.join(cloud.resolvedSource.directory, 'manifest.json'), 'utf8'))
  assert.equal(cloud.total, manifest.agents.length)
  assert.equal(cloud.executableCount, cloud.total)
  assert.equal(cloud.instructionErrors, 0)
  assert.equal(cloud.divisionMapSource, 'committed-json')
  assert(cloud.agents.every((agent) => agent.source?.type === 'bundled' && agent.executable))
  for (const id of ['research-synthesist', 'agents-orchestrator']) assert((await loadAgentInstructions(id)).developerInstructions.length > 0)
  assert.equal((await preflightAgentInstructions(['research-synthesist', 'agents-orchestrator'])).source.type, 'bundled')
  assert(!JSON.stringify(cloud.agents).includes('developerInstructions'))
  assert(!JSON.stringify(cloud.agents).includes('developer_instructions'))
  console.log(`A PASS: HOME without .codex; cloud ignores explicit/local/env paths; bundled REAL ${cloud.total}, executable=${cloud.executableCount}, errors=0`)

  delete process.env.AGENT_DECK_CLOUD
  delete process.env.VERCEL
  delete process.env.AGENT_DECK_AGENTS_DIR
  const localDirectory = path.join(temporary, '.codex/agents')
  await mkdir(localDirectory, { recursive: true })
  await writeFile(path.join(localDirectory, 'research-synthesist.toml'), 'name="Fixture Research"\ndeveloper_instructions="LOCAL_FIXTURE_ONLY"\n')
  assert.equal((await resolveAgentSource()).configuredBy, 'default')
  const local = await loadAgentRegistry()
  assert.equal(local.source, 'filesystem')
  assert.equal(local.total, 1)
  assert.equal((await loadAgentInstructions('research-synthesist')).developerInstructions, 'LOCAL_FIXTURE_ONLY')
  console.log('B PASS: local ~/.codex/agents remains canonical filesystem source')
  const missing = path.join(temporary, 'missing')
  await assert.rejects(loadAgentInstructions('research-synthesist', missing), (error: unknown) => error instanceof AgentInstructionError && error.code === 'AGENT_SOURCE_UNAVAILABLE')
  await rm(localDirectory, { recursive: true })
  assert.equal((await loadAgentRegistry()).source, 'bundled')
  console.log('B PASS: explicit invalid path fails closed; missing local default uses bundled fallback')

  const corruptDirectory = path.join(temporary, 'corrupt')
  await mkdir(corruptDirectory)
  const originalSource = cloud.resolvedSource
  await writeFile(path.join(corruptDirectory, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(path.join(corruptDirectory, 'research-synthesist.toml'), 'developer_instructions="CHANGED"')
  await assert.rejects(loadAgentInstructions('research-synthesist', { ...originalSource, directory: corruptDirectory }), (error: unknown) => error instanceof AgentInstructionError && error.code === 'AGENT_BUNDLE_INVALID')
  console.log('Security PASS: bundle tampering rejected with typed error; API agent records contain no instructions')
} finally {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]
  Object.assign(process.env, original)
  await rm(temporary, { recursive: true, force: true })
}
