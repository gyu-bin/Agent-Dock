import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { runAllowlistedVerify, cancelCodexRun } from '../server/src/codex/codexExecutionService.js'
import { tryAcquireExecutionLock, releaseExecutionLock, getExecutionLock, clearAllExecutionLocks } from '../server/src/runtime/executionLock.js'
import { EventEmitter } from 'node:events'
import { cancellableAi, requestCancellation } from '../server/src/runtime/requestCancellation.js'

const dir = await mkdtemp(path.join(tmpdir(), 'agent-deck-stop-'))
const originalFetch = globalThis.fetch
const until = async (test: () => boolean) => {
  const deadline = Date.now() + 1500
  while (!test()) {
    assert.ok(Date.now() < deadline, 'fixture timed out')
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}
try {
  const output = path.join(dir, 'engine.mjs')
  await build({ entryPoints: ['client/src/engine/realAiExecutionEngine.ts'], outfile: output,
    bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' } })
  const { RealAIExecutionEngine } = await import(pathToFileURL(output).href)
  function fixture(completed = false, codex = false) {
    const task: any = { id: 't', projectId: 'p', title: 'Fixture', description: 'Fixture', workflow: 'RESEARCH',
      status: 'queued', assignedAgentIds: ['trend-researcher'], progress: 0 }
    const step: any = { id: 's', taskId: 't', agentId: 'trend-researcher', label: 'Research', order: 1,
      status: completed ? 'completed' : 'queued', provider: codex ? 'codex' : 'openai', mode: 'inspect' }
    const runtime: any = {}, runs: any[] = []
    const engine = new RealAIExecutionEngine({ getTasks: () => [task], getSteps: () => [step], getAgentRuntime: () => runtime,
      getAgentRuns: () => runs, getCodexRuns: () => [], getRegistry: () => [],
      patchTask: (_: string, patch: any) => Object.assign(task, patch), patchStep: (_: string, patch: any) => Object.assign(step, patch),
      setAgentRuntime: (id: string, patch: any) => { runtime[id] = patch },
      upsertAgentRun: (run: any) => { const index = runs.findIndex(r => r.id === run.id); if (index >= 0) runs[index] = run; else runs.push(run) }, persistSoon() {} })
    return { task, step, engine, runtime, runs }
  }
  let blockedUrl = '', calls: string[] = [], aborted = false, settle: ((response: Response) => void) | undefined
  let block = '/api/ai/run-step', rejectOnAbort = true
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url)
    if (url.endsWith(block)) {
      blockedUrl = url
      return new Promise<Response>((resolve, reject) => {
        settle = resolve
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          if (rejectOnAbort) reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    }
    if (url.endsWith('/api/provider')) return Response.json({ authMode: 'chatgpt-plan' })
    return Response.json({ ok: true, projectPath: '/tmp/fixture' })
  }
  let f = fixture(); f.engine.execute('t'); await until(() => Boolean(blockedUrl))
  f.engine.cancel('t'); await until(() => aborted); await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(f.task.status, 'cancelled'); assert.equal(f.step.status, 'queued')
  assert.equal(f.runs[0].status, 'cancelled')
  assert.equal(f.runtime['trend-researcher'].status, 'idle')
  assert.equal(calls.filter(url => url.endsWith('/api/ai/run-step')).length, 1)
  f.engine.dispose(); console.log('PASS in-flight abort cannot overwrite cancelled status or advance')

  blockedUrl = ''; calls = []; aborted = false; block = '/api/ai/synthesize'; rejectOnAbort = false
  f = fixture(true); f.engine.execute('t'); await until(() => Boolean(blockedUrl)); f.task.status = 'verifying'
  f.engine.pause('t'); assert.equal(f.task.status, 'paused'); assert.ok(aborted)
  settle!(Response.json({ output: 'late output' })); await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(f.task.status, 'paused'); assert.equal(f.task.finalResult, undefined)
  f.engine.dispose(); console.log('PASS stopping synthesis/verifying discards late completion')

  blockedUrl = ''; calls = []; aborted = false; block = '/api/agents/preflight'; rejectOnAbort = false
  f = fixture(); f.engine.execute('t'); await until(() => Boolean(blockedUrl)); f.engine.cancel('t')
  settle!(Response.json({ ok: true })); await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(f.task.status, 'cancelled'); assert.ok(!calls.some(url => url.endsWith('/api/ai/run-step')))
  f.engine.dispose(); console.log('PASS stop during preflight never starts inference')

  blockedUrl = ''; calls = []; block = '/api/codex/preflight'
  f = fixture(false, true); f.engine.execute('t'); await until(() => Boolean(blockedUrl)); f.engine.cancel('t')
  settle!(Response.json({ ok: true, projectPath: '/tmp/fixture' })); await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(f.task.status, 'cancelled'); assert.ok(!calls.some(url => url.endsWith('/api/codex/run')))
  f.engine.dispose(); console.log('PASS Codex preflight stop never dispatches process')

  const response: any = new EventEmitter(); response.writableEnded = false
  const cancellation = requestCancellation(response)
  let signal: AbortSignal | undefined
  const scoped = cancellableAi({ getState: () => ({} as any), isConfigured: () => true,
    chat: async input => { signal = input.signal; return { content: '', usage: { model: 'fixture' } } } }, cancellation.signal)
  await scoped.chat({ messages: [] }); response.emit('close')
  assert.ok(signal?.aborted); assert.throws(() => scoped.chat({ messages: [] }))
  cancellation.dispose(); assert.equal(response.listenerCount('close'), 0)
  console.log('PASS browser disconnect propagates upstream abort and blocks subsequent calls')
  clearAllExecutionLocks()
  tryAcquireExecutionLock({ projectId: 'p', taskId: 'old', clientId: 'same' })
  tryAcquireExecutionLock({ projectId: 'p', taskId: 'new', clientId: 'same' })
  assert.equal(releaseExecutionLock({ projectId: 'p', taskId: 'old', clientId: 'same' }), false)
  assert.equal(getExecutionLock('p')?.taskId, 'new')
  assert.equal(releaseExecutionLock({ projectId: 'p', taskId: 'new', clientId: 'same' }), true)
  console.log('PASS stale task cleanup cannot release newer execution lock')
  const started = path.join(dir, 'verify-started')
  const later = path.join(dir, 'later-check')
  await writeFile(path.join(dir, 'hold.mjs'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(started)}, 'started');setInterval(()=>{},1000)` )
  await writeFile(path.join(dir, 'later.mjs'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(later)}, 'unexpected')` )
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({scripts:{typecheck:'node hold.mjs',lint:'node later.mjs'}}))
  const verification = runAllowlistedVerify(dir, 'fixture-verify-cancel').then(() => null, error => error)
  for (let count = 0; count < 100; count++) {
    if (await access(started).then(() => true, () => false)) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await access(started)
  assert.equal(cancelCodexRun('fixture-verify-cancel'), true)
  const error = await Promise.race([verification, new Promise((_, reject) => setTimeout(() => reject(new Error('verify cancellation timed out')),1500))])
  assert.equal(error?.code, 'CANCELLED')
  assert.equal(await access(later).then(() => true, () => false), false)
  console.log('PASS verification child terminated; subsequent checks never launch')
} finally { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }) }
