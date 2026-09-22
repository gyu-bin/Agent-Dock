/**
 * Phase F1 Final Hardening — real Codex CLI E2E on disposable repos.
 *
 * Usage (server must be on :8787 with CODEX available):
 *   node --import tsx tools/f1-hardening-e2e.mts
 */
import { mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ensureSafetyPipelineAfterImplement,
  normalizeStepDefsWithSafety,
} from '../client/src/domain/safetyPipeline.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API = process.env.AGENT_DECK_API ?? 'http://127.0.0.1:8787'
const CODEX_TIMEOUT = Number(process.env.F1_CODEX_TIMEOUT_MS ?? 300_000)

type Result = { name: string; ok: boolean; detail?: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api<T>(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as T
  return { status: res.status, json }
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(full, base)))
    else out.push(path.relative(base, full))
  }
  return out.sort()
}

async function assertInsideProject(
  projectPath: string,
  changed: string[],
): Promise<boolean> {
  const root = path.resolve(projectPath)
  for (const rel of changed) {
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false
    const abs = path.resolve(root, rel)
    if (!abs.startsWith(root + path.sep) && abs !== root) return false
  }
  return true
}

async function runCodex(input: {
  runId: string
  taskId: string
  stepId: string
  agentId: string
  mode: 'inspect' | 'implement' | 'review' | 'verify'
  projectPath: string
  userRequest: string
  stepTask: string
  previousResult?: string
}) {
  return api<{
    run?: {
      status: string
      changedFiles?: string[]
      snapshotId?: string
      unifiedDiff?: string
      summary?: string
      commands?: Array<{ name: string; status: string }>
      error?: string
    }
    output?: string
    error?: string
    code?: string
  }>('POST', '/api/codex/run', {
    ...input,
    timeoutMs: CODEX_TIMEOUT,
  })
}

async function runOpenAiReality(input: {
  userRequest: string
  previousResult: string
}) {
  return api<{ output?: string; error?: string }>('POST', '/api/ai/run-step', {
    agentId: 'reality-checker',
    stepTask: '현실성 검증',
    userRequest: input.userRequest,
    previousResult: input.previousResult,
  })
}

async function makeFixture(name: string, opts?: { failTypecheck?: boolean }) {
  const dir = path.join(ROOT, 'tmp', `f1-hard-${name}-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  // Separate script file so Codex can fix typecheck without editing package.json inline.
  if (opts?.failTypecheck) {
    await writeFile(
      path.join(dir, 'typecheck.mjs'),
      "console.error('typecheck fail')\nprocess.exit(1)\n",
    )
  } else {
    await writeFile(path.join(dir, 'typecheck.mjs'), 'process.exit(0)\n')
  }
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: `f1-hard-${name}`,
        private: true,
        scripts: {
          typecheck: 'node typecheck.mjs',
          build: 'node -e "process.exit(0)"',
          // lint/test intentionally absent → NOT AVAILABLE
        },
      },
      null,
      2,
    ),
  )
  await writeFile(path.join(dir, 'NOTE.txt'), 'original note line\n')
  return dir
}

/** Safety pipeline unit force */
function testSafetyForce() {
  const normalized = normalizeStepDefsWithSafety(
    [
      {
        agentId: 'frontend-developer',
        label: '구현',
        provider: 'codex',
        mode: 'implement',
      },
      {
        agentId: 'reality-checker',
        label: '현실성',
        provider: 'openai',
      },
    ],
    {
      approval: 'product-manager',
      verify: 'code-reviewer',
      review: 'code-reviewer',
      reality: 'reality-checker',
    },
  )
  const labels = normalized.map((s) => `${s.provider}:${s.mode ?? '-'}:${s.label}`)
  const ok =
    normalized.length === 5 &&
    normalized[0]?.mode === 'implement' &&
    normalized[1]?.provider === 'human' &&
    normalized[2]?.mode === 'verify' &&
    normalized[3]?.mode === 'review' &&
    normalized[4]?.provider === 'openai'
  record('Safety normalizeStepDefsWithSafety', ok, labels.join(' → '))

  const steps = [
    {
      id: 't_step_1',
      taskId: 't',
      agentId: 'frontend-developer',
      order: 1,
      label: '구현',
      status: 'completed' as const,
      provider: 'codex' as const,
      mode: 'implement' as const,
    },
    {
      id: 't_step_2',
      taskId: 't',
      agentId: 'reality-checker',
      order: 2,
      label: '바로 현실성',
      status: 'queued' as const,
      provider: 'openai' as const,
    },
  ]
  const enforced = ensureSafetyPipelineAfterImplement({
    taskId: 't',
    steps,
    implementStepId: 't_step_1',
    agents: {
      approval: 'product-manager',
      verify: 'code-reviewer',
      review: 'code-reviewer',
      reality: 'reality-checker',
    },
  })
  const chain = enforced.map((s) => s.provider + ':' + (s.mode ?? 'openai'))
  record(
    'Safety ensureSafetyPipelineAfterImplement',
    chain.join(',') === 'codex:implement,human:openai,codex:verify,codex:review,openai:openai' ||
      (enforced.length === 5 &&
        enforced[1]?.provider === 'human' &&
        enforced[2]?.mode === 'verify' &&
        enforced[3]?.mode === 'review' &&
        enforced[4]?.provider === 'openai'),
    chain.join(' → '),
  )
}

async function testA() {
  const dir = await makeFixture('A')
  const filesBefore = await listFiles(dir)
  const taskId = `task_a_${Date.now().toString(36)}`
  const req =
    'NOTE.txt 파일의 내용을 정확히 한 줄로 바꿔라: Agent Deck F1 Test A\n다른 파일은 수정하지 마라.'

  // Malicious/incomplete plan would skip approval — we force via safety after implement in product code;
  // here we execute the safety sequence explicitly after implement.
  const impl = await runCodex({
    runId: `codex_${taskId}_impl`,
    taskId,
    stepId: `${taskId}_impl`,
    agentId: 'frontend-developer',
    mode: 'implement',
    projectPath: dir,
    userRequest: req,
    stepTask: 'NOTE.txt 문구 수정',
  })

  const run = impl.json.run
  const changed = run?.changedFiles ?? []
  const inside = await assertInsideProject(dir, changed)
  record('TEST A implement completed', impl.status === 200 && run?.status === 'completed', run?.error)
  record('TEST A has file changes', changed.length > 0, changed.join(','))
  record('TEST A Project.path 외부 변경 없음', inside)

  // awaiting_approval gate (simulated system state)
  record(
    'TEST A awaiting_approval gate',
    Boolean(run?.snapshotId && (run.unifiedDiff || changed.length)),
    `snapshot=${run?.snapshotId}`,
  )

  // Approve → Verify
  const ver = await runCodex({
    runId: `codex_${taskId}_ver`,
    taskId,
    stepId: `${taskId}_ver`,
    agentId: 'code-reviewer',
    mode: 'verify',
    projectPath: dir,
    userRequest: req,
    stepTask: '검증',
    previousResult: run?.summary,
  })
  const verFail = (ver.json.run?.commands ?? []).some((c) => c.status === 'fail')
  record(
    'TEST A verify PASS',
    ver.status === 200 && ver.json.run?.status === 'completed' && !verFail,
    JSON.stringify(ver.json.run?.commands ?? ver.json.error),
  )

  const rev = await runCodex({
    runId: `codex_${taskId}_rev`,
    taskId,
    stepId: `${taskId}_rev`,
    agentId: 'code-reviewer',
    mode: 'review',
    projectPath: dir,
    userRequest: req,
    stepTask: '코드 리뷰',
    previousResult: `${run?.unifiedDiff?.slice(0, 8000) ?? ''}\n${run?.summary ?? ''}`,
  })
  record(
    'TEST A code review',
    rev.status === 200 && rev.json.run?.status === 'completed',
    rev.json.error ?? rev.json.run?.summary?.slice(0, 120),
  )

  const reality = await runOpenAiReality({
    userRequest: req,
    previousResult: [
      run?.summary,
      `VERIFY: ${JSON.stringify(ver.json.run?.commands)}`,
      rev.json.run?.summary,
    ]
      .filter(Boolean)
      .join('\n\n'),
  })
  record(
    'TEST A reality + completed',
    reality.status === 200 && Boolean(reality.json.output),
    reality.json.error,
  )

  const note = await readFile(path.join(dir, 'NOTE.txt'), 'utf8')
  record('TEST A NOTE.txt changed', /F1 Test A/i.test(note), JSON.stringify(note))

  const filesAfter = await listFiles(dir)
  const escaped = filesAfter.some((f) => f.startsWith('..'))
  record('TEST A no escape files listed', !escaped, filesAfter.join(','))

  await rm(dir, { recursive: true, force: true })
  void filesBefore
}

async function testB() {
  const dir = await makeFixture('B')
  const taskId = `task_b_${Date.now().toString(36)}`
  const req1 =
    'NOTE.txt 내용을 정확히 다음 한 줄로 바꿔라: Iteration One Phrase\n다른 파일은 건드리지 마라.'

  const impl1 = await runCodex({
    runId: `codex_${taskId}_impl1`,
    taskId,
    stepId: `${taskId}_impl1`,
    agentId: 'frontend-developer',
    mode: 'implement',
    projectPath: dir,
    userRequest: req1,
    stepTask: 'Implementation #1',
  })
  record(
    'TEST B Implementation #1',
    impl1.status === 200 && impl1.json.run?.status === 'completed',
    impl1.json.error,
  )
  const note1 = await readFile(path.join(dir, 'NOTE.txt'), 'utf8')
  record('TEST B #1 phrase', /Iteration One/i.test(note1), JSON.stringify(note1))

  const feedback =
    '방금 변경한 문구를 다른 문구로 다시 수정해줘. NOTE.txt를 정확히 한 줄로: Iteration Two Phrase'
  const impl2 = await runCodex({
    runId: `codex_${taskId}_impl2`,
    taskId,
    stepId: `${taskId}_impl2`,
    agentId: 'frontend-developer',
    mode: 'implement',
    projectPath: dir,
    userRequest: req1,
    stepTask: 'Implementation #2',
    previousResult: `USER FEEDBACK FOR CHANGES:\n${feedback}\n\nPREVIOUS:\n${impl1.json.run?.summary ?? ''}`,
  })
  record(
    'TEST B Implementation #2',
    impl2.status === 200 && impl2.json.run?.status === 'completed',
    impl2.json.error,
  )
  const note2 = await readFile(path.join(dir, 'NOTE.txt'), 'utf8')
  record('TEST B #2 phrase', /Iteration Two/i.test(note2), JSON.stringify(note2))

  const historyOk =
    Boolean(impl1.json.run?.id || impl1.json.run?.summary) &&
    Boolean(impl2.json.run?.id || impl2.json.run?.summary) &&
    impl1.json.run?.snapshotId !== impl2.json.run?.snapshotId
  record(
    'TEST B iteration history distinct runs',
    historyOk,
    `snap1=${impl1.json.run?.snapshotId} snap2=${impl2.json.run?.snapshotId}`,
  )

  const inside = await assertInsideProject(dir, [
    ...(impl1.json.run?.changedFiles ?? []),
    ...(impl2.json.run?.changedFiles ?? []),
  ])
  record('TEST B Project.path 외부 변경 없음', inside)

  // Approve path: verify → review → reality (abbreviated after #2)
  const ver = await runCodex({
    runId: `codex_${taskId}_ver`,
    taskId,
    stepId: `${taskId}_ver`,
    agentId: 'code-reviewer',
    mode: 'verify',
    projectPath: dir,
    userRequest: feedback,
    stepTask: '검증',
  })
  record('TEST B verify after #2', ver.status === 200 && ver.json.run?.status === 'completed')

  await rm(dir, { recursive: true, force: true })
}

async function testC() {
  const dir = await makeFixture('C', { failTypecheck: true })
  const taskId = `task_c_${Date.now().toString(36)}`
  const req =
    'NOTE.txt를 한 줄로 바꿔라: Fix Typecheck Soon\n다른 파일은 건드리지 마라.'

  const impl = await runCodex({
    runId: `codex_${taskId}_impl`,
    taskId,
    stepId: `${taskId}_impl`,
    agentId: 'frontend-developer',
    mode: 'implement',
    projectPath: dir,
    userRequest: req,
    stepTask: '구현',
  })
  record('TEST C implement', impl.status === 200 && impl.json.run?.status === 'completed')

  const ver1 = await runCodex({
    runId: `codex_${taskId}_ver1`,
    taskId,
    stepId: `${taskId}_ver1`,
    agentId: 'code-reviewer',
    mode: 'verify',
    projectPath: dir,
    userRequest: req,
    stepTask: '검증',
  })
  const failed = (ver1.json.run?.commands ?? []).some((c) => c.status === 'fail')
  const verFailed =
    ver1.status === 422 ||
    ver1.json.code === 'VERIFY_FAILED' ||
    ver1.json.run?.status === 'failed' ||
    failed
  record('TEST C Verify FAILED', verFailed, JSON.stringify(ver1.json.run?.commands ?? ver1.json))
  record('TEST C Task completed 금지', verFailed, 'blocked/verify-failed path')

  // Codex fix: edit typecheck.mjs so it exits 0
  const fix = await runCodex({
    runId: `codex_${taskId}_fix`,
    taskId,
    stepId: `${taskId}_fix`,
    agentId: 'frontend-developer',
    mode: 'implement',
    projectPath: dir,
    userRequest:
      'typecheck.mjs 파일을 수정해서 process.exit(0)만 남기고 성공하게 만들어라. NOTE.txt와 package.json은 변경하지 마라.',
    stepTask: '검증 실패 수정 — typecheck.mjs를 exit 0으로',
    previousResult:
      'VERIFY FAILED: npm run typecheck runs `node typecheck.mjs` which currently prints "typecheck fail" and exits 1. Fix ONLY typecheck.mjs so it exits 0 (e.g. replace contents with process.exit(0)). Do not change package.json or NOTE.txt.',
  })
  const fixOk = fix.status === 200 && fix.json.run?.status === 'completed'
  record('TEST C Codex 수정', fixOk, fix.json.error)
  const typecheckSrc = await readFile(path.join(dir, 'typecheck.mjs'), 'utf8').catch(() => '')
  record(
    'TEST C typecheck.mjs fixed on disk',
    /exit\(0\)/.test(typecheckSrc) && !/exit\(1\)/.test(typecheckSrc),
    JSON.stringify(typecheckSrc),
  )

  const ver2 = await runCodex({
    runId: `codex_${taskId}_ver2`,
    taskId,
    stepId: `${taskId}_ver2`,
    agentId: 'code-reviewer',
    mode: 'verify',
    projectPath: dir,
    userRequest: req,
    stepTask: '검증 재실행',
  })
  const ver2Fail = (ver2.json.run?.commands ?? []).some((c) => c.status === 'fail')
  const ver2Pass =
    ver2.status === 200 && ver2.json.run?.status === 'completed' && !ver2Fail
  record(
    'TEST C Verify PASS',
    ver2Pass,
    JSON.stringify(ver2.json.run?.commands ?? ver2.json.error),
  )

  if (!ver2Pass) {
    record('TEST C Review', false, 'skipped — verify still failing')
    record('TEST C Complete', false, 'skipped — verify still failing')
  } else {
    const rev = await runCodex({
      runId: `codex_${taskId}_rev`,
      taskId,
      stepId: `${taskId}_rev`,
      agentId: 'code-reviewer',
      mode: 'review',
      projectPath: dir,
      userRequest: req,
      stepTask: '코드 리뷰',
      previousResult: fix.json.run?.summary,
    })
    record('TEST C Review', rev.status === 200 && rev.json.run?.status === 'completed')

    const reality = await runOpenAiReality({
      userRequest: req,
      previousResult: [fix.json.run?.summary, rev.json.run?.summary]
        .filter(Boolean)
        .join('\n'),
    })
    record('TEST C Complete', reality.status === 200 && Boolean(reality.json.output))
  }

  const inside = await assertInsideProject(dir, [
    ...(impl.json.run?.changedFiles ?? []),
    ...(fix.json.run?.changedFiles ?? []),
  ])
  record('TEST C Project.path 외부 변경 없음', inside)

  await rm(dir, { recursive: true, force: true })
}

async function testReject() {
  const dir = await makeFixture('reject')
  const before = await readFile(path.join(dir, 'NOTE.txt'), 'utf8')
  const taskId = `task_rj_${Date.now().toString(36)}`
  const impl = await runCodex({
    runId: `codex_${taskId}_impl`,
    taskId,
    stepId: `${taskId}_impl`,
    agentId: 'frontend-developer',
    mode: 'implement',
    projectPath: dir,
    userRequest:
      'NOTE.txt를 한 줄로 바꿔라: SHOULD BE ROLLED BACK\n다른 파일은 수정하지 마라.',
    stepTask: '구현',
  })
  record('Reject implement', impl.status === 200 && Boolean(impl.json.run?.snapshotId))
  const mid = await readFile(path.join(dir, 'NOTE.txt'), 'utf8')
  record('Reject file changed before rollback', mid !== before, JSON.stringify(mid))

  const rb = await api<{ ok: boolean; restored?: string[]; error?: string }>(
    'POST',
    '/api/codex/rollback',
    { snapshotId: impl.json.run?.snapshotId },
  )
  const after = await readFile(path.join(dir, 'NOTE.txt'), 'utf8')
  record('Reject rollback API', rb.status === 200 && rb.json.ok, rb.json.error)
  record('Reject before snapshot 완전 복구', after === before, JSON.stringify(after))

  const inside = await assertInsideProject(dir, impl.json.run?.changedFiles ?? [])
  record('Reject Project.path 외부 변경 없음', inside)

  await rm(dir, { recursive: true, force: true })
}

async function main() {
  const health = await api<{ ok?: boolean }>('GET', '/api/health')
  if (health.status !== 200) {
    console.error('Server not healthy on', API)
    process.exit(1)
  }
  const codex = await api<{ available?: boolean; binary?: string }>(
    'GET',
    '/api/codex/status',
  )
  if (!codex.json.available) {
    console.error('Codex not available — cannot run live E2E')
    process.exit(1)
  }
  console.log('Codex:', codex.json.binary)
  console.log('Timeout ms:', CODEX_TIMEOUT)

  const only = (process.env.F1_ONLY ?? '').toLowerCase()

  if (!only || only === 'safety') testSafetyForce()
  if (!only || only === 'a') {
    console.log('\n--- TEST A ---')
    await testA()
  }
  if (!only || only === 'b') {
    console.log('\n--- TEST B ---')
    await testB()
  }
  if (!only || only === 'c') {
    console.log('\n--- TEST C ---')
    await testC()
  }
  if (!only || only === 'reject') {
    console.log('\n--- REJECT ---')
    await testReject()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== Summary: ${results.length - failed.length}/${results.length} passed ====`)
  for (const r of failed) console.log('FAIL', r.name, r.detail ?? '')
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
