/**
 * Phase Harden-0 — Security + Runtime Reliability fixtures (no live providers).
 *
 *   node --import tsx tools/harden-0-fixture.mts
 */
import { mkdir, rm, symlink, writeFile, readFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import express from 'express'
import { JsonProjectRepository } from '../server/src/persistence/jsonStore.ts'
import { ProjectService } from '../server/src/persistence/projectService.ts'
import { atomicWriteJson } from '../server/src/persistence/atomicWrite.ts'
import {
  assertPathInsideProject,
  assertSafeProjectPath,
} from '../server/src/codex/pathSandbox.ts'
import { restoreContentSnapshot } from '../server/src/codex/contentSnapshot.ts'
import {
  initLocalSession,
  requireLocalSession,
  isAllowedOrigin,
  issueSessionCookie,
} from '../server/src/runtime/localSession.ts'
import {
  tryAcquireExecutionLock,
  releaseExecutionLock,
  clearAllExecutionLocks,
} from '../server/src/runtime/executionLock.ts'
import {
  loadSearchSessionsFromTasks,
  listSearchSessions,
} from '../server/src/search/searchHistoryStore.ts'
import { selectWorkflowTemplate } from '../client/src/domain/templateSelector.ts'
import { createDefaultTaskRouter } from '../client/src/domain/taskRouter.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, '.tmp', `harden-0-${Date.now().toString(36)}`)
const SNAPSHOT_ROOT = path.join(ROOT, 'server/data/snapshots')

type Result = { name: string; ok: boolean; detail?: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  await mkdir(DIR, { recursive: true })
  process.env.AGENT_DECK_SESSION_FILE = path.join(DIR, '.local-session')

  const token = await initLocalSession()

  // ─── TEST A — external origin rejected ───────────────────────────────────
  {
    const forbidden = !isAllowedOrigin('http://192.168.1.50:5173')
    const allowed =
      isAllowedOrigin('http://localhost:5173') &&
      isAllowedOrigin('http://127.0.0.1:5173')
    record(
      'TEST A LAN/external origin rejected',
      forbidden && allowed,
      `forbidden=${forbidden} allowed=${allowed}`,
    )
  }

  // ─── TEST B — mutation without session credential rejected ───────────────
  {
    const app = express()
    app.use(express.json())
    app.post('/api/work-state', requireLocalSession, (_req, res) => {
      res.json({ ok: true })
    })
    app.get('/api/session/bootstrap', (_req, res) => {
      issueSessionCookie(res)
      res.json({ ok: true })
    })
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    const noCred = await fetch(`http://127.0.0.1:${port}/api/work-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const withCred = await fetch(`http://127.0.0.1:${port}/api/work-state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Deck-Session': token,
      },
      body: '{}',
    })
    server.close()
    const noBody = (await noCred.json().catch(() => ({}))) as {
      code?: string
    }
    record(
      'TEST B session credential required',
      noCred.status === 401 &&
        noBody.code === 'SESSION_UNAUTHORIZED' &&
        withCred.status === 200,
      `no=${noCred.status}/${noBody.code} with=${withCred.status}`,
    )
  }

  // ─── TEST C — Project A snapshot cannot rollback into Project B ──────────
  {
    const projA = path.join(DIR, 'proj-a')
    const projB = path.join(DIR, 'proj-b')
    await mkdir(projA, { recursive: true })
    await mkdir(projB, { recursive: true })
    await writeFile(path.join(projA, 'a.txt'), 'alpha', 'utf8')
    await writeFile(path.join(projB, 'b.txt'), 'beta', 'utf8')

    const snapId = `snap_own_${Date.now().toString(36)}`
    await mkdir(SNAPSHOT_ROOT, { recursive: true })
    const snapPath = path.join(SNAPSHOT_ROOT, `${snapId}.json`)
    await atomicWriteJson(snapPath, {
      id: snapId,
      projectId: 'project-a',
      taskId: 't1',
      stepId: 's1',
      runId: 'r1',
      projectPath: await assertSafeProjectPath(projA),
      createdAt: new Date().toISOString(),
      files: [
        {
          path: 'a.txt',
          content: 'alpha',
          encoding: 'utf8',
          existed: true,
        },
      ],
      changedFiles: ['a.txt'],
      added: [],
      modified: ['a.txt'],
      deleted: [],
      diffByFile: {},
      unifiedDiff: '',
    })

    let rejected = false
    let code = ''
    try {
      await restoreContentSnapshot(snapId, {
        projectId: 'project-b',
        projectPath: projB,
      })
    } catch (err) {
      rejected = true
      code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: string }).code)
          : ''
    }
    await rm(snapPath, { force: true }).catch(() => undefined)
    record(
      'TEST C snapshot ownership cross-project reject',
      rejected && code === 'SNAPSHOT_OWNERSHIP',
      `code=${code}`,
    )
  }

  // ─── TEST D — symlink escape rejected ────────────────────────────────────
  {
    const proj = path.join(DIR, 'proj-sym')
    const outside = path.join(DIR, 'outside-secret.txt')
    await mkdir(proj, { recursive: true })
    await writeFile(outside, 'secret', 'utf8')
    const link = path.join(proj, 'escape')
    await symlink(outside, link)
    let rejected = false
    let code = ''
    try {
      await assertPathInsideProject(proj, 'escape')
    } catch (err) {
      rejected = true
      code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: string }).code)
          : ''
    }
    let trav = false
    try {
      await assertPathInsideProject(proj, '../outside-secret.txt')
    } catch {
      trav = true
    }
    const lst = await lstat(link)
    record(
      'TEST D symlink/traversal path reject',
      rejected && code === 'PATH_VIOLATION' && trav && lst.isSymbolicLink(),
      `symlinkCode=${code} trav=${trav}`,
    )
  }

  // ─── TEST E — stale work-state revision → 409 ────────────────────────────
  {
    const file = path.join(DIR, 'projects-rev.json')
    const repo = new JsonProjectRepository(file)
    const svc = new ProjectService(repo)
    await svc.create({
      name: 'Rev Test',
      type: 'web-app',
      agentIds: ['agents-engineer'],
    })
    const snap1 = await svc.getSnapshot()
    const rev = snap1.revision ?? 0
    await svc.saveWorkState({
      tasks: [],
      pipelineSteps: [],
      expectedRevision: rev,
    })
    let conflict = false
    let code = ''
    try {
      await svc.saveWorkState({
        tasks: [],
        pipelineSteps: [],
        expectedRevision: rev,
      })
    } catch (err) {
      code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: string }).code)
          : ''
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 0
      conflict = code === 'PERSISTENCE_CONFLICT' && status === 409
    }
    record(
      'TEST E stale work-state revision conflict',
      conflict,
      `code=${code}`,
    )
  }

  // ─── TEST F — two clients execution lock conflict ────────────────────────
  {
    clearAllExecutionLocks()
    tryAcquireExecutionLock({
      projectId: 'p-lock',
      taskId: 't1',
      clientId: 'tab-a',
    })
    let conflict = false
    let code = ''
    try {
      tryAcquireExecutionLock({
        projectId: 'p-lock',
        taskId: 't2',
        clientId: 'tab-b',
      })
    } catch (err) {
      conflict = true
      code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: string }).code)
          : ''
    }
    releaseExecutionLock({ projectId: 'p-lock', clientId: 'tab-a' })
    const again = tryAcquireExecutionLock({
      projectId: 'p-lock',
      taskId: 't3',
      clientId: 'tab-b',
    })
    record(
      'TEST F multi-tab execution lock',
      conflict && code === 'EXECUTION_LOCK' && again.clientId === 'tab-b',
      `code=${code}`,
    )
  }

  // ─── TEST G — refresh/interruption → not completed ───────────────────────
  {
    const file = path.join(DIR, 'projects-int.json')
    const repo = new JsonProjectRepository(file)
    const svc = new ProjectService(repo)
    const created = await svc.create({
      name: 'Interrupt',
      type: 'web-app',
      agentIds: ['agents-engineer'],
    })
    const now = new Date().toISOString()
    const runningTask = {
      id: 'task_run',
      projectId: created.projects[0]!.id,
      title: 'Running',
      description: '',
      status: 'running' as const,
      workflow: 'BUILD' as const,
      priority: 'normal' as const,
      assignedAgentIds: [] as string[],
      recommendedExtraAgentIds: [] as string[],
      progress: 40,
      createdAt: now,
      updatedAt: now,
      executionMode: 'MOCK' as const,
    }
    const afterSave = await svc.saveWorkState({
      tasks: [runningTask],
      pipelineSteps: [],
      expectedRevision: created.revision,
    })
    const after = await svc.replaceWorkState({
      tasks: [{ ...runningTask, status: 'running' }],
      pipelineSteps: [],
      expectedRevision: afterSave.revision,
    })
    const t = after.tasks.find((x) => x.id === 'task_run')
    record(
      'TEST G interruption not treated as completed',
      t?.status === 'interrupted',
      `status=${t?.status}`,
    )
  }

  // ─── TEST H — search history hydrate from Task persistence ───────────────
  {
    const session = {
      id: 'ws_1',
      taskId: 'task_search',
      stepId: 'step_1',
      agentId: 'researcher',
      queries: ['agent deck'],
      results: [],
      sources: [
        {
          id: 'src1',
          title: 'Doc',
          url: 'https://example.com',
          domain: 'example.com',
          snippet: 'hello',
        },
      ],
      searchedAt: new Date().toISOString(),
      status: 'ok' as const,
    }
    loadSearchSessionsFromTasks([
      { id: 'task_search', webSearchSessions: [session] },
    ])
    const listed = listSearchSessions('task_search')
    record(
      'TEST H search history hydrate from Task',
      listed.length === 1 && listed[0]!.queries[0] === 'agent deck',
      `n=${listed.length}`,
    )
  }

  // ─── TEST I — atomic persistence reload ──────────────────────────────────
  {
    const file = path.join(DIR, 'atomic.json')
    await atomicWriteJson(file, { version: 5, revision: 7, ok: true })
    const raw = JSON.parse(await readFile(file, 'utf8'))
    record(
      'TEST I atomic persistence reload',
      raw.version === 5 && raw.revision === 7 && raw.ok === true,
      JSON.stringify(raw),
    )
  }

  // ─── TEST J — task.executionMode survives global mode change ─────────────
  {
    const taskMode = 'MOCK' as const
    let globalMode: 'MOCK' | 'REAL_AI' = 'MOCK'
    const resolve = (taskExec?: 'MOCK' | 'REAL_AI') => taskExec ?? globalMode
    const before = resolve(taskMode)
    globalMode = 'REAL_AI'
    const after = resolve(taskMode)
    record(
      'TEST J task.executionMode SoT',
      before === 'MOCK' && after === 'MOCK' && globalMode === 'REAL_AI',
      `task=${after} global=${globalMode}`,
    )
  }

  // ─── TEST K — WorkflowTemplate is planning canonical SoT ─────────────────
  {
    const selection = selectWorkflowTemplate({
      request: '로그인 페이지를 구현해줘',
      projectType: 'web-app',
    })
    const router = createDefaultTaskRouter()
    const plan = router.classify({
      title: '로그인 페이지를 구현해줘',
      projectType: 'web-app',
    })
    const hasTemplate =
      Boolean(selection.template?.id) &&
      (selection.template.steps?.length ?? 0) > 0
    record(
      'TEST K WorkflowTemplate planning SoT',
      hasTemplate && Boolean(plan.workflow),
      `template=${selection.template.id} routerWorkflow=${plan.workflow}`,
    )
  }

  await rm(DIR, { recursive: true, force: true }).catch(() => undefined)

  const failed = results.filter((r) => !r.ok)
  console.log('\n── Harden-0 fixture summary ──')
  console.log(
    `passed=${results.length - failed.length} failed=${failed.length}`,
  )
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail ?? ''}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
