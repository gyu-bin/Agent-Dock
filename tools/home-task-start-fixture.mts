import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// Bundle browser env access for a Node-only store fixture. All API calls are mocked.
const dir = await mkdtemp(path.join(tmpdir(), 'agent-deck-home-start-'))
const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
let resolveLock: ((response: Response) => void) | undefined
globalThis.fetch = async (input, init) => {
  const url = String(input)
  calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
  if (url.endsWith('/api/execution/lock') && init?.method === 'POST') {
    return new Promise<Response>((resolve) => { resolveLock = resolve })
  }
  return Response.json({ revision: 1, tasks: [], pipelineSteps: [] })
}

try {
  const output = path.join(dir, 'store.mjs')
  await build({
    entryPoints: ['client/src/store/useDeckStore.ts'], outfile: output,
    bundle: true, platform: 'node', format: 'esm',
    define: { 'import.meta.env': '{}' },
  })
  const { useDeckStore } = await import(pathToFileURL(output).href)
  const registry = useDeckStore.getState().registry
  useDeckStore.setState({
    projects: [{ id: 'fixture', name: 'Fixture', type: 'web-app', status: 'active',
      agentIds: registry.map((agent: { id: string }) => agent.id), createdAt: new Date().toISOString() }],
    activeProjectId: 'fixture', executionMode: 'MOCK', activeNav: 'home',
  })
  const input = { title: '현재 앱 시장 조사', autoStart: false, proposalMessageId: 'proposal-one' }
  const taskId = useDeckStore.getState().createAndStartTask(input)
  assert.ok(taskId)
  assert.equal(useDeckStore.getState().activeNav, 'home')
  assert.equal(useDeckStore.getState().createAndStartTask(input), taskId)
  assert.equal(useDeckStore.getState().tasks.length, 1)
  useDeckStore.setState({ activeNav: 'tasks' })
  useDeckStore.getState().createAndStartTask({ title: '앱 조사', autoStart: false })
  assert.equal(useDeckStore.getState().activeNav, 'projects')
  useDeckStore.getState().startTask(taskId)
  useDeckStore.getState().startTask(taskId)
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
  useDeckStore.getState().cancelTask(taskId)
  assert.ok(resolveLock)
  resolveLock(Response.json({ ok: true }))
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(useDeckStore.getState().tasks.find((task: { id: string }) => task.id === taskId).status, 'cancelled')
  assert.ok(calls.some((call) => call.method === 'DELETE'))
  assert.ok(calls.filter((call) => call.method === 'DELETE').every((call) => call.body?.taskId === taskId))
  assert.ok(calls.every((call) => call.url.endsWith('/api/work-state') || call.url.endsWith('/api/execution/lock')))
  console.log('PASS: home stays home; other contexts open projects; proposal/start deduplicate; cancellation wins pending lock; no inference/network.')
} finally {
  await rm(dir, { recursive: true, force: true })
}
