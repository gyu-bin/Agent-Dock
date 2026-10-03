import assert from 'node:assert/strict'
import { ProjectService } from '../server/src/persistence/projectService.js'
import { JsonProjectRepository, ProjectCasConflict } from '../server/src/persistence/jsonStore.js'
import type { ProjectStoreSnapshot, ProjectRepository } from '../server/src/persistence/types.js'

let value: ProjectStoreSnapshot = { version: 5, revision: 0, activeProjectId: null, projects: [], tasks: [], pipelineSteps: [], agentRuns: [], codexRuns: [] }
let conflicts = 0
const repo: ProjectRepository = {
  load: async () => structuredClone(value),
  save: async (snapshot) => {
    if ((snapshot.revision ?? 0) !== (value.revision ?? 0) + 1) { conflicts++; throw new ProjectCasConflict() }
    value = structuredClone(snapshot)
  },
}
const one = new ProjectService(repo)
const two = new ProjectService(repo)
await Promise.all([one.create({ name: 'A', type: 'web-app', ownerId: 'owner-a' }), two.create({ name: 'B', type: 'web-app', ownerId: 'owner-b' })])
assert.equal(value.projects.length, 2)
assert.equal(value.revision, 2)
assert.equal(conflicts, 1)
const [a, b] = value.projects
await Promise.all([one.update(a.id, { name: 'Updated A' }), two.update(b.id, { name: 'Updated B' })])
assert.deepEqual(value.projects.map((project) => project.name).sort(), ['Updated A', 'Updated B'])
assert.equal(value.revision, 4)
console.log('CAS PASS: concurrent independent instance creates/updates preserve both projects and increment revisions')

await assert.rejects(one.saveWorkState({ tasks: [], pipelineSteps: [], expectedRevision: 0 }), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PERSISTENCE_CONFLICT'))
assert.equal(value.revision, 4)
console.log('CAS PASS: client stale expectedRevision still rejects instead of silently replaying work-state')

value.projects.push({ id: 'legacy', name: 'Legacy', type: 'web-app', status: 'active', agentIds: [], createdAt: new Date().toISOString() })
await Promise.all([one.claimLegacy('owner-a'), two.claimLegacy('owner-a')])
assert.equal(value.projects.find((project) => project.id === 'legacy')?.ownerId, 'owner-a')
assert.equal(value.projects.find((project) => project.id === b.id)?.ownerId, 'owner-b')
assert.equal(value.revision, 5)
await one.claimLegacy('owner-a')
assert.equal(value.revision, 5)
console.log('Legacy PASS: only ownerless records claimed; existing owners preserved; repeated claim does not write')

let attempts = 0
const unavailable: ProjectRepository = { load: async () => structuredClone(value), save: async () => { attempts++; throw new ProjectCasConflict() } }
await assert.rejects(new ProjectService(unavailable).create({ name: 'Never commits', type: 'web-app' }), ProjectCasConflict)
assert.equal(attempts, 5)
console.log('CAS PASS: retry bounded to five attempts')

const fixtureTask = (id: string, projectId: string) => ({ id, projectId, title: id, description: '', status: 'running', workflow: 'research', priority: 'medium', assignedAgentIds: [], recommendedExtraAgentIds: [], progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }) as ProjectStoreSnapshot['tasks'][number]
const ownedTask = fixtureTask('task-a', a.id)
const otherTask = fixtureTask('task-b', b.id)
value.tasks = [ownedTask, otherTask]
value.pipelineSteps = [{ id: 'step-b', taskId: otherTask.id, agentId: 'research-synthesist', order: 0, label: 'Other', status: 'running' }]
await one.replaceWorkState({ ownerId: 'owner-a', tasks: [structuredClone(ownedTask)], pipelineSteps: [{ id: 'step-a', taskId: ownedTask.id, agentId: 'research-synthesist', order: 0, label: 'Owned', status: 'running' }] })
assert.equal(value.tasks.find((task) => task.id === ownedTask.id)?.status, 'interrupted')
assert.equal(value.tasks.find((task) => task.id === otherTask.id)?.status, 'running')
assert.equal(value.pipelineSteps.find((step) => step.id === 'step-b')?.status, 'running')
assert.equal(value.pipelineSteps.find((step) => step.id === 'step-a')?.status, 'waiting')
const denied = (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PROJECT_ACCESS_DENIED')
await assert.rejects(one.saveWorkState({ ownerId: 'owner-a', tasks: [otherTask], pipelineSteps: [] }), denied)
await assert.rejects(one.saveWorkState({ ownerId: 'owner-a', tasks: [{ ...ownedTask, id: otherTask.id }], pipelineSteps: [] }), denied)
await assert.rejects(one.saveWorkState({ ownerId: 'owner-a', tasks: [ownedTask], pipelineSteps: [{ id: 'forged', taskId: otherTask.id, agentId: '', order: 0, label: '', status: 'waiting' }] }), denied)
await assert.rejects(one.saveWorkState({ ownerId: 'owner-a', tasks: [ownedTask], pipelineSteps: [{ id: 'step-b', taskId: ownedTask.id, agentId: '', order: 0, label: '', status: 'waiting' }] }), denied)
await one.saveWorkState({ ownerId: 'owner-a', tasks: [], pipelineSteps: [], agentRuns: [], codexRuns: [] })
assert.equal(value.tasks.length, 1)
assert.equal(value.tasks[0].id, otherTask.id)
assert.equal(value.pipelineSteps[0].id, 'step-b')
console.log('Ownership PASS: scoped save/recovery preserve other accounts; foreign task/step IDs and cross-owner ID collisions rejected')

const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
try {
  process.env.AGENT_DECK_CLOUD = '1'
  process.env.AGENT_DECK_CLOUD_ROOT = '/tmp/agent-deck-cas-fixture'
  process.env.SUPABASE_URL = 'https://fixture.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_synthetic_fixture'
  let outcome: 'passed' | 'conflict' | 'unavailable' = 'passed'
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://fixture.invalid/rest/v1/rpc/project_snapshot_compare_and_set')
    const body = JSON.parse(String(init?.body))
    assert.equal(body.p_expected_revision, 0)
    assert.equal(JSON.parse(body.p_content).revision, 1)
    return outcome === 'unavailable' ? new Response('unavailable', { status: 503 }) : Response.json(outcome === 'passed')
  }) as typeof fetch
  const cloudRepo = new JsonProjectRepository('/tmp/agent-deck-cas-fixture/projects.json')
  const payload = { ...structuredClone(value), revision: 1 }
  await cloudRepo.save(payload)
  outcome = 'conflict'
  await assert.rejects(cloudRepo.save(payload), ProjectCasConflict)
  outcome = 'unavailable'
  await assert.rejects(cloudRepo.save(payload), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PROJECT_STORAGE_UNAVAILABLE'))
  console.log('Repository PASS: cloud writes use CAS RPC only; conflicts/unavailable migration fail safely (mock transport)')
} finally {
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
}
