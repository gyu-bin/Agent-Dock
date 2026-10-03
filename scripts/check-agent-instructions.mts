import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const temporary = await mkdtemp(path.join(os.tmpdir(), 'agent-deck-instructions-'))
const originalSettings = process.env.AGENT_DECK_SETTINGS_FILE
const originalAgents = process.env.AGENT_DECK_AGENTS_DIR
const originalCwd = process.cwd()
process.env.AGENT_DECK_SETTINGS_FILE = path.join(temporary, 'settings.json')
const { resolveAgentSource } = await import('../server/src/registry/agentSource.js')
const { loadAgentRegistry } = await import('../server/src/registry/loadAgents.js')
const { loadAgentInstructions, preflightAgentInstructions } = await import('../server/src/registry/loadAgentInstructions.js')
const { AgentInstructionError } = await import('../server/src/registry/agentInstructionError.js')
const { JsonProjectRepository } = await import('../server/src/persistence/jsonStore.js')

async function rejectsCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: unknown) => {
    assert(error instanceof AgentInstructionError)
    assert.equal(error.code, code)
    assert.equal(error.userMessage, '담당 에이전트의 실행 지침을 불러오지 못했습니다.')
    assert(error.technicalSummary.includes('path='))
    assert(!error.technicalSummary.includes('SENSITIVE_FIXTURE_CONTENT'))
    return true
  })
}

try {
  const valid = path.join(temporary, 'agents')
  await mkdir(valid)
  await writeFile(path.join(valid, 'research-synthesist.toml'), 'name = "Research Synthesist"\ndescription = "Research"\ndeveloper_instructions = "SENSITIVE_FIXTURE_CONTENT"\n')
  process.env.AGENT_DECK_AGENTS_DIR = valid
  const registry = await loadAgentRegistry()
  assert.equal(registry.state, 'REAL')
  assert.equal(registry.executableCount, 1)
  assert.equal(registry.agents[0].instructionAvailable, true)
  const instructions = await loadAgentInstructions('research-synthesist')
  assert.equal(instructions.filePath, registry.agents[0].source?.instructionPath)
  assert.equal((await preflightAgentInstructions(['research-synthesist'])).ok, true)
  console.log('A/J PASS: real registry, executable instruction, canonical path')

  const missing = path.join(temporary, 'missing')
  const fallback = await loadAgentRegistry(missing)
  assert.equal(fallback.state, 'FALLBACK')
  assert.equal(fallback.executableCount, 0)
  assert(fallback.agents.every((agent) => agent.executable === false))
  await rejectsCode(() => loadAgentInstructions('research-synthesist', missing), 'AGENT_SOURCE_UNAVAILABLE')
  console.log('B/I PASS: unavailable source and display-only fallback (explicit mock simulation remains client-only)')

  await rejectsCode(() => loadAgentInstructions('absent', valid), 'AGENT_INSTRUCTION_FILE_NOT_FOUND')
  await writeFile(path.join(valid, 'invalid.toml'), 'developer_instructions = "SENSITIVE_FIXTURE_CONTENT"\ninvalid [')
  await rejectsCode(() => loadAgentInstructions('invalid', valid), 'AGENT_INSTRUCTION_PARSE_FAILED')
  await writeFile(path.join(valid, 'no-field.toml'), 'name = "Missing"\n')
  await rejectsCode(() => loadAgentInstructions('no-field', valid), 'AGENT_INSTRUCTION_MISSING_FIELD')
  await mkdir(path.join(valid, 'unreadable.toml'))
  await rejectsCode(() => loadAgentInstructions('unreadable', valid), 'AGENT_INSTRUCTION_READ_FAILED')
  const invalidRegistry = await loadAgentRegistry(valid)
  assert.equal(invalidRegistry.instructionErrors, 3)
  assert.equal(invalidRegistry.executableCount, 1)
  await rejectsCode(() => preflightAgentInstructions(['research-synthesist', 'absent']), 'AGENT_INSTRUCTION_FILE_NOT_FOUND')
  console.log('C/D/E PASS: missing, parse, missing field, read errors and all-agent preflight')

  const alias = path.join(temporary, 'agents-link')
  await symlink(valid, alias)
  await writeFile(process.env.AGENT_DECK_SETTINGS_FILE!, JSON.stringify({ agents: { codexAgentsDir: alias } }))
  process.env.AGENT_DECK_AGENTS_DIR = missing
  const savedSource = await resolveAgentSource()
  assert.equal(savedSource.configuredBy, 'settings')
  assert.equal(savedSource.directory, await import('node:fs/promises').then((fs) => fs.realpath(valid)))
  assert.equal((await loadAgentRegistry()).agentsDir, path.dirname((await loadAgentInstructions('research-synthesist')).filePath))
  assert.equal((await resolveAgentSource(missing)).configuredBy, 'runtime')
  process.chdir(temporary)
  assert.deepEqual(await resolveAgentSource(), savedSource)
  const tildeSource = await resolveAgentSource('~/.codex/agents')
  const absoluteSource = await resolveAgentSource(path.join(os.homedir(), '.codex', 'agents'))
  assert.equal(tildeSource.directory, absoluteSource.directory)
  assert.equal((await resolveAgentSource('.codex/agents')).directory, absoluteSource.directory)
  console.log('J PASS: settings > environment, runtime override, symlink, tilde, cwd independence')

  const repository = new JsonProjectRepository(path.join(temporary, 'projects.json'))
  const snapshot = await repository.load()
  const failure = {
    errorCode: 'AGENT_INSTRUCTION_FILE_NOT_FOUND',
    userMessage: '담당 에이전트의 실행 지침을 불러오지 못했습니다.',
    technicalSummary: 'AGENT_INSTRUCTION_FILE_NOT_FOUND: agentId=research-synthesist',
  }
  snapshot.pipelineSteps.push({ id: 'step', taskId: 'task', agentId: 'research-synthesist', order: 0, label: 'Research', status: 'failed', ...failure })
  snapshot.agentRuns.push({ id: 'run', taskId: 'task', stepId: 'step', agentId: 'research-synthesist', status: 'failed', inputSummary: '', output: '', startedAt: new Date().toISOString(), ...failure })
  await repository.save(snapshot)
  const reloaded = await new JsonProjectRepository(path.join(temporary, 'projects.json')).load()
  assert.equal(reloaded.pipelineSteps[0].errorCode, failure.errorCode)
  assert.equal(reloaded.agentRuns[0].technicalSummary, failure.technicalSummary)
  console.log('H PASS: structured instruction failure survives persisted reload')

  if (absoluteSource.available) {
    try {
      const actual = await loadAgentInstructions('research-synthesist', absoluteSource)
      assert(actual.developerInstructions.length > 0)
      console.log(`DOGFOOD PERSONA PASS: ${actual.filePath}, ${actual.developerInstructions.length} instruction characters`)
    } catch (error) {
      if (!(error instanceof AgentInstructionError) || error.code !== 'AGENT_INSTRUCTION_FILE_NOT_FOUND') throw error
      console.log('DOGFOOD PERSONA SKIP: local research-synthesist not installed')
    }
  } else console.log('DOGFOOD PERSONA SKIP: local Codex agent source unavailable')
} finally {
  process.chdir(originalCwd)
  if (originalSettings === undefined) delete process.env.AGENT_DECK_SETTINGS_FILE
  else process.env.AGENT_DECK_SETTINGS_FILE = originalSettings
  if (originalAgents === undefined) delete process.env.AGENT_DECK_AGENTS_DIR
  else process.env.AGENT_DECK_AGENTS_DIR = originalAgents
  await rm(temporary, { recursive: true, force: true })
}
