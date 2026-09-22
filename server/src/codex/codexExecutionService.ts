import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadAgentInstructions } from '../registry/loadAgentInstructions.js'
import { assertSafeProjectPath, assertWritableProjectPath, assertChangedFilesInsideProject } from './pathSandbox.js'
import { diffFingerprints, snapshotProjectFiles } from './fileSnapshot.js'
import {
  buildImplementSnapshot,
  captureBeforeContents,
} from './contentSnapshot.js'
import { getCodexProviderState, resolveCodexBinary } from './codexProvider.js'
import {
  classifyCodexFailure,
  retryBackoffMs,
  sanitizeSnippet,
  sleep,
  type CodexFailureDiagnostics,
} from './codexErrors.js'
import type {
  CodexExecuteInput,
  CodexExecuteResult,
  CodexMode,
  CodexRunRecord,
  VerificationCommand,
} from './types.js'

/** Max automatic retries for transient upstream failures (total attempts = 1 + MAX). */
const MAX_UPSTREAM_RETRIES = 2

const DEFAULT_TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS ?? 180_000)

const activeRuns = new Map<
  string,
  { child: ChildProcess; abort: AbortController }
>()

const FORBIDDEN_PROMPT_PATTERNS = [
  /\bgit\s+commit\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
]

function stripReasoningNoise(text: string): string {
  // Never surface chain-of-thought style blocks if the CLI emits them
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/^reasoning:.*$/gim, '')
    .trim()
}

function buildPrompt(input: {
  mode: CodexMode
  agentInstructions: string
  agentName: string
  userRequest: string
  stepTask: string
  previousResult?: string
  projectPath: string
}): string {
  const modeRules: Record<CodexMode, string> = {
    inspect: `MODE: INSPECT (READ-ONLY)
- Analyze the repository structure, stack, key files, and potential issues.
- DO NOT create, edit, delete, or move any files.
- DO NOT run mutating git commands (commit/push/reset).
- DO NOT run package install or destructive shell commands.`,
    implement: `MODE: IMPLEMENT
- Make the minimal code changes required for the step task.
- Only modify files inside the project directory.
- DO NOT run git commit, git push, git reset --hard, or branch delete.
- DO NOT touch files outside the project root.
- Summarize what you changed at the end.`,
    review: `MODE: REVIEW (READ-ONLY)
- Prioritize reviewing the recent change Diff / changed files for this task over the entire repository.
- Look for bugs, regressions, maintainability issues, unnecessary complexity, and requirement gaps.
- DO NOT modify any files.
- DO NOT commit or push.
- Provide concrete findings: issues, risks, suggestions.`,
    verify: `MODE: VERIFY
- Prefer reporting how to verify; the host may run allowlisted checks.
- DO NOT modify files.
- DO NOT run git commit/push/reset.`,
  }

  return `${input.agentInstructions}

---
You are running as "${input.agentName}" inside Agent Deck Codex execution.
Project path (cwd sandbox): ${input.projectPath}

${modeRules[input.mode]}

USER REQUEST
${input.userRequest}

CURRENT STEP
${input.stepTask}

PREVIOUS RESULT
${(input.previousResult ?? '(none)').slice(0, 6000)}

Return a clear final summary for the user. Do not reveal hidden chain-of-thought.`
}

function sandboxFlag(mode: CodexMode): string {
  return mode === 'implement' ? 'workspace-write' : 'read-only'
}

async function runCodexProcess(opts: {
  runId: string
  binary: string
  cwd: string
  prompt: string
  mode: CodexMode
  timeoutMs: number
  onActivity?: (activity: string) => void
}): Promise<{
  exitCode: number | null
  stdout: string
  stderr: string
  cancelled: boolean
  timedOut: boolean
}> {
  const abort = new AbortController()
  const args = [
    'exec',
    '-C',
    opts.cwd,
    '--sandbox',
    sandboxFlag(opts.mode),
    '-c',
    'approval_policy="never"',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color',
    'never',
    opts.prompt,
  ]

  opts.onActivity?.(
    opts.mode === 'inspect'
      ? 'Inspecting repository'
      : opts.mode === 'implement'
        ? 'Editing files'
        : opts.mode === 'review'
          ? 'Reviewing changes'
          : 'Running verification',
  )

  const child = spawn(opts.binary, args, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      // Only forward an explicit Codex key. Do NOT inject OPENAI_API_KEY as
      // CODEX_API_KEY — that overrides Codex CLI login/subscription auth and
      // can force a depleted API account (manifesting as intermittent 502s).
      ...(process.env.CODEX_API_KEY
        ? { CODEX_API_KEY: process.env.CODEX_API_KEY }
        : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })

  // Prompt is argv — close stdin so Codex does not wait for more input
  try {
    child.stdin?.end()
  } catch {
    /* ignore */
  }

  activeRuns.set(opts.runId, { child, abort })

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
    if (stdout.length > 500_000) stdout = stdout.slice(-400_000)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
    if (stderr.length > 200_000) stderr = stderr.slice(-150_000)
  })

  let cancelled = false
  let timedOut = false
  abort.signal.addEventListener('abort', () => {
    cancelled = true
    killProcessTree(child)
  })

  const timeout = setTimeout(() => {
    timedOut = true
    killProcessTree(child)
  }, opts.timeoutMs)

  const exitCode: number | null = await new Promise((resolve) => {
    child.on('error', () => resolve(null))
    child.on('close', (code) => resolve(code))
  })

  clearTimeout(timeout)
  activeRuns.delete(opts.runId)

  return {
    exitCode,
    stdout: stripReasoningNoise(stdout),
    stderr: stripReasoningNoise(stderr),
    cancelled,
    timedOut,
  }
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') {
      child.kill()
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
      setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL')
        } catch {
          try {
            child.kill('SIGKILL')
          } catch {
            /* already dead */
          }
        }
      }, 1500).unref?.()
    }
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
}

export function cancelCodexRun(runId: string): boolean {
  const entry = activeRuns.get(runId)
  if (!entry) return false
  entry.abort.abort()
  killProcessTree(entry.child)
  return true
}

export function cancelCodexRunsForTask(taskId: string): number {
  let n = 0
  for (const [runId, entry] of activeRuns) {
    if (runId.includes(taskId) || runId.startsWith(`codex_${taskId}`)) {
      entry.abort.abort()
      killProcessTree(entry.child)
      activeRuns.delete(runId)
      n++
    }
  }
  // Also cancel any run whose stored association is by prefix convention
  for (const [runId, entry] of [...activeRuns.entries()]) {
    if (runId.includes(taskId)) {
      entry.abort.abort()
      killProcessTree(entry.child)
      activeRuns.delete(runId)
      n++
    }
  }
  return n
}

async function runAllowlistedVerify(
  projectPath: string,
): Promise<VerificationCommand[]> {
  const REQUIRED = ['typecheck', 'lint', 'test', 'build'] as const
  const results: VerificationCommand[] = []
  let pkg: { scripts?: Record<string, string> } = {}
  try {
    const raw = await readFile(path.join(projectPath, 'package.json'), 'utf8')
    pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
  } catch {
    return REQUIRED.map((name) => ({
      name,
      command: `(not available)`,
      status: 'skipped' as const,
      exitCode: null,
      outputSnippet: 'No package.json — NOT AVAILABLE',
    }))
  }

  const scripts = pkg.scripts ?? {}

  for (const name of REQUIRED) {
    if (!scripts[name]) {
      results.push({
        name,
        command: `(not available)`,
        status: 'skipped',
        exitCode: null,
        outputSnippet: 'NOT AVAILABLE — script missing in package.json',
      })
      continue
    }
    const cmd = scripts[name]
    if (FORBIDDEN_PROMPT_PATTERNS.some((re) => re.test(cmd))) {
      results.push({
        name,
        command: `npm run ${name}`,
        status: 'fail',
        exitCode: null,
        outputSnippet: 'Blocked: script matches forbidden pattern',
      })
      continue
    }

    const outcome = await new Promise<VerificationCommand>((resolve) => {
      const child = spawn('npm', ['run', name], {
        cwd: projectPath,
        env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      child.stdout?.on('data', (c: Buffer) => {
        out += c.toString('utf8')
      })
      child.stderr?.on('data', (c: Buffer) => {
        out += c.toString('utf8')
      })
      const t = setTimeout(() => {
        child.kill('SIGTERM')
      }, 120_000)
      child.on('close', (code) => {
        clearTimeout(t)
        resolve({
          name,
          command: `npm run ${name}`,
          status: code === 0 ? 'pass' : 'fail',
          exitCode: code,
          outputSnippet: out.slice(-2000),
        })
      })
      child.on('error', (err) => {
        clearTimeout(t)
        resolve({
          name,
          command: `npm run ${name}`,
          status: 'fail',
          exitCode: null,
          outputSnippet: String(err.message),
        })
      })
    })
    results.push(outcome)
  }

  // Optional check script if present
  if (scripts.check && !REQUIRED.includes('check' as never)) {
    // already covered by REQUIRED list — skip
  }

  return results
}

export async function preflightCodex(input: {
  projectPath?: string
  mode: CodexMode
  agentId: string
  stepTask: string
}): Promise<{
  ok: boolean
  projectPath?: string
  mode: CodexMode
  agentId: string
  stepTask: string
  readOnly: boolean
  filesMayBeModified: boolean
  projectKind?: string
  writable?: boolean
  codex: Awaited<ReturnType<typeof getCodexProviderState>>
  error?: string
}> {
  const codex = await getCodexProviderState()
  try {
    const projectPath =
      input.mode === 'implement'
        ? await assertWritableProjectPath(input.projectPath)
        : await assertSafeProjectPath(input.projectPath)
    // Detect package/project hints
    let projectKind = 'unknown'
    try {
      await readFile(path.join(projectPath, 'package.json'), 'utf8')
      projectKind = 'node'
    } catch {
      /* ignore */
    }
    return {
      ok: codex.available,
      projectPath,
      mode: input.mode,
      agentId: input.agentId,
      stepTask: input.stepTask,
      readOnly: input.mode !== 'implement',
      filesMayBeModified: input.mode === 'implement',
      projectKind,
      writable: input.mode === 'implement',
      codex,
      error: codex.available ? undefined : codex.error,
    }
  } catch (err) {
    return {
      ok: false,
      mode: input.mode,
      agentId: input.agentId,
      stepTask: input.stepTask,
      readOnly: input.mode !== 'implement',
      filesMayBeModified: input.mode === 'implement',
      codex,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function attachDiagnostics(
  run: CodexRunRecord,
  diag: CodexFailureDiagnostics,
  retries: number,
): CodexRunRecord {
  return {
    ...run,
    durationMs: diag.durationMs,
    exitCode: diag.exitCode,
    timedOut: diag.timedOut,
    cancelled: diag.cancelled,
    errorCategory: diag.category,
    stderrSummary: diag.stderrSummary,
    attempt: diag.attempt,
    retries,
    userMessageKo: diag.userMessageKo,
    error: diag.userMessageKo,
    diagnostics: {
      durationMs: diag.durationMs,
      exitCode: diag.exitCode,
      timedOut: diag.timedOut,
      cancelled: diag.cancelled,
      errorCategory: diag.category,
      stderrSummary: diag.stderrSummary,
      attempt: diag.attempt,
      retries,
    },
  }
}

function throwCodexFailure(
  diag: CodexFailureDiagnostics,
  run: CodexRunRecord,
  retries: number,
  output?: string,
): never {
  const failed = attachDiagnostics(run, diag, retries)
  throw Object.assign(new Error(diag.userMessageKo), {
    status: diag.httpStatus,
    code: diag.category,
    run: failed,
    output: output ?? failed.summary,
    userMessageKo: diag.userMessageKo,
    diagnostics: failed.diagnostics,
  })
}

/**
 * Safe to auto-retry only when:
 * - failure is classified retryable (transient upstream / timeout), AND
 * - mode is read-only (inspect/review), OR implement with zero file changes so far.
 * VERIFY uses allowlisted npm scripts — no Codex process retry here.
 */
function canSafeRetry(opts: {
  mode: CodexMode
  diag: CodexFailureDiagnostics
  changedFiles: string[]
  attempt: number
}): boolean {
  if (opts.attempt > MAX_UPSTREAM_RETRIES) return false
  if (!opts.diag.retryable) return false
  if (
    opts.diag.category !== 'UPSTREAM_ERROR' &&
    opts.diag.category !== 'TIMEOUT'
  ) {
    return false
  }
  if (opts.mode === 'inspect' || opts.mode === 'review') return true
  if (opts.mode === 'implement' && opts.changedFiles.length === 0) return true
  return false
}

export async function executeCodexRun(
  input: CodexExecuteInput,
): Promise<CodexExecuteResult> {
  if (!input.projectId?.trim()) {
    throw Object.assign(new Error('projectId required for Codex execution'), {
      status: 400,
      code: 'BAD_REQUEST',
      userMessageKo: 'Codex 실행에 프로젝트 ID가 필요합니다.',
    })
  }
  const startedMs = Date.now()
  const startedAt = new Date().toISOString()
  const baseRun: CodexRunRecord = {
    id: input.runId,
    taskId: input.taskId,
    stepId: input.stepId,
    agentId: input.agentId,
    mode: input.mode,
    projectPath: '',
    status: 'running',
    startedAt,
    activity:
      input.mode === 'inspect'
        ? 'Inspecting repository'
        : input.mode === 'implement'
          ? 'Editing files'
          : input.mode === 'review'
            ? 'Reviewing changes'
            : 'Running verification',
  }

  let projectPath: string
  try {
    projectPath = await assertSafeProjectPath(input.projectPath)
  } catch (err) {
    const durationMs = Date.now() - startedMs
    const diag = classifyCodexFailure({
      exitCode: null,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      cancelled: false,
      timedOut: false,
      durationMs,
      pathError: true,
    })
    const failed: CodexRunRecord = {
      ...baseRun,
      status: 'failed',
      completedAt: new Date().toISOString(),
      activity: 'Failed',
    }
    throwCodexFailure(diag, failed, 0)
  }
  baseRun.projectPath = projectPath

  const { binary, error: binErr } = await resolveCodexBinary()
  if (!binary) {
    const durationMs = Date.now() - startedMs
    const diag = classifyCodexFailure({
      exitCode: null,
      stdout: '',
      stderr: binErr ?? 'Codex unavailable',
      cancelled: false,
      timedOut: false,
      durationMs,
      binaryMissing: true,
    })
    const failed: CodexRunRecord = {
      ...baseRun,
      status: 'failed',
      completedAt: new Date().toISOString(),
      activity: 'Failed',
    }
    throwCodexFailure(diag, failed, 0)
  }

  const agent =
    (await loadAgentInstructions(input.agentId)) ??
    (await loadAgentInstructions('code-reviewer'))
  if (!agent) {
    throw Object.assign(
      new Error(`Agent instructions not found for "${input.agentId}"`),
      { status: 404, code: 'AGENT_MISSING' },
    )
  }

  const before = await snapshotProjectFiles(projectPath)
  const beforeContents =
    input.mode === 'implement'
      ? await captureBeforeContents(projectPath, before)
      : new Map<string, string | null>()
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (input.mode === 'verify') {
    // Controlled verify path — do not shell out arbitrary user commands
    baseRun.activity = 'Running typecheck / tests'
    const commands = await runAllowlistedVerify(projectPath)
    const anyFail = commands.some((c) => c.status === 'fail')
    const summary = commands
      .map(
        (c) =>
          `${c.name.padEnd(12)} ${c.status.toUpperCase()}${
            c.command ? `  (${c.command})` : ''
          }`,
      )
      .join('\n')
    const after = await snapshotProjectFiles(projectPath)
    const changed = diffFingerprints(before, after)
    const durationMs = Date.now() - startedMs
    if (changed.length > 0) {
      throw Object.assign(
        new Error(
          `VERIFY mutated files (forbidden): ${changed.slice(0, 10).join(', ')}`,
        ),
        { status: 500, code: 'READONLY_VIOLATION' },
      )
    }
    const completedAt = new Date().toISOString()
    const run: CodexRunRecord = {
      ...baseRun,
      status: anyFail ? 'failed' : 'completed',
      completedAt,
      summary,
      changedFiles: [],
      commands,
      activity: anyFail ? 'Failed' : 'Completed',
      durationMs,
      exitCode: anyFail ? 1 : 0,
      timedOut: false,
      cancelled: false,
      error: anyFail ? 'One or more verification commands failed' : undefined,
      userMessageKo: anyFail
        ? '검증 명령이 실패했습니다. 결과를 확인한 뒤 다시 시도해 주세요.'
        : undefined,
      errorCategory: anyFail ? 'UNKNOWN' : undefined,
      attempt: 1,
      retries: 0,
    }
    if (anyFail) {
      throw Object.assign(new Error(run.userMessageKo ?? run.error!), {
        status: 422,
        code: 'VERIFY_FAILED',
        run,
        output: summary,
        userMessageKo: run.userMessageKo,
      })
    }
    return { run, output: `# Verification\n\n${summary}` }
  }

  const prompt = buildPrompt({
    mode: input.mode,
    agentInstructions: agent.developerInstructions,
    agentName: agent.name,
    userRequest: input.userRequest,
    stepTask: input.stepTask,
    previousResult: input.previousResult,
    projectPath,
  })

  let lastDiag: CodexFailureDiagnostics | null = null
  let lastProc: {
    exitCode: number | null
    stdout: string
    stderr: string
    cancelled: boolean
    timedOut: boolean
  } | null = null
  let lastChanged: string[] = []
  let retriesUsed = 0

  for (let attempt = 1; attempt <= 1 + MAX_UPSTREAM_RETRIES; attempt++) {
    const attemptStarted = Date.now()
    const procResult = await runCodexProcess({
      runId: attempt === 1 ? input.runId : `${input.runId}_r${attempt}`,
      binary: binary!,
      cwd: projectPath,
      prompt,
      mode: input.mode,
      timeoutMs,
    })
    lastProc = procResult

    const after = await snapshotProjectFiles(projectPath)
    const changedFiles = diffFingerprints(before, after)
    lastChanged = changedFiles

    // Escape check — realpath-based, not string prefix
    await assertChangedFilesInsideProject(projectPath, changedFiles)

    if (
      (input.mode === 'inspect' || input.mode === 'review') &&
      changedFiles.length > 0
    ) {
      const failed: CodexRunRecord = {
        ...baseRun,
        status: 'failed',
        completedAt: new Date().toISOString(),
        changedFiles,
        error: `${input.mode.toUpperCase()} must be read-only but files changed: ${changedFiles.slice(0, 8).join(', ')}`,
        userMessageKo:
          '읽기 전용 단계에서 파일이 변경되어 실행을 중단했습니다.',
        activity: 'Failed',
        durationMs: Date.now() - startedMs,
        exitCode: procResult.exitCode,
        timedOut: procResult.timedOut,
        cancelled: procResult.cancelled,
        errorCategory: 'PROCESS_ERROR',
        stderrSummary: sanitizeSnippet(procResult.stderr, 400),
        attempt,
        retries: retriesUsed,
      }
      throw Object.assign(new Error(failed.userMessageKo!), {
        status: 500,
        code: 'READONLY_VIOLATION',
        run: failed,
        userMessageKo: failed.userMessageKo,
      })
    }

    const durationMs = Date.now() - startedMs
    const attemptDuration = Date.now() - attemptStarted

    if (procResult.timedOut || procResult.cancelled || procResult.exitCode !== 0) {
      const diag = classifyCodexFailure({
        exitCode: procResult.exitCode,
        stdout: procResult.stdout,
        stderr: procResult.stderr,
        cancelled: procResult.cancelled && !procResult.timedOut,
        timedOut: procResult.timedOut,
        durationMs: attemptDuration,
        attempt,
      })
      // Prefer wall-clock duration on the run record
      diag.durationMs = durationMs
      lastDiag = diag

      const safe = canSafeRetry({
        mode: input.mode,
        diag,
        changedFiles,
        attempt,
      })
      if (safe) {
        retriesUsed++
        console.warn(
          `[codex] retryable ${diag.category} runId=${input.runId} mode=${input.mode} attempt=${attempt} backoff=${retryBackoffMs(attempt)}ms`,
        )
        await sleep(retryBackoffMs(attempt))
        continue
      }

      const status = diag.category === 'CANCELLED' ? 'cancelled' : 'failed'
      const run: CodexRunRecord = {
        ...baseRun,
        status,
        completedAt: new Date().toISOString(),
        changedFiles: input.mode === 'implement' ? changedFiles : [],
        activity: status === 'cancelled' ? 'Cancelled' : 'Failed',
        summary: sanitizeSnippet(
          [procResult.stdout.slice(-1500), procResult.stderr.slice(-800)]
            .filter(Boolean)
            .join('\n'),
          2000,
        ),
      }
      throwCodexFailure(diag, run, retriesUsed, run.summary)
    }

    // Success path
    let snapshotMeta:
      | {
          snapshotId: string
          addedFiles: string[]
          modifiedFiles: string[]
          deletedFiles: string[]
          unifiedDiff: string
          diffByFile: Record<string, string>
        }
      | undefined

    if (input.mode === 'implement' && changedFiles.length > 0) {
      const snap = await buildImplementSnapshot({
        runId: input.runId,
        taskId: input.taskId,
        stepId: input.stepId,
        projectId: input.projectId,
        projectPath,
        beforeFingerprint: before,
        beforeContents,
      })
      snapshotMeta = {
        snapshotId: snap.id,
        addedFiles: snap.added,
        modifiedFiles: snap.modified,
        deletedFiles: snap.deleted,
        unifiedDiff: snap.unifiedDiff,
        diffByFile: snap.diffByFile,
      }
    }

    const output = stripReasoningNoise(
      procResult.stdout.trim() ||
        procResult.stderr.trim() ||
        '(Codex completed with empty output)',
    )

    const run: CodexRunRecord = {
      ...baseRun,
      status: 'completed',
      completedAt: new Date().toISOString(),
      changedFiles: input.mode === 'implement' ? changedFiles : [],
      addedFiles: snapshotMeta?.addedFiles,
      modifiedFiles: snapshotMeta?.modifiedFiles,
      deletedFiles: snapshotMeta?.deletedFiles,
      snapshotId: snapshotMeta?.snapshotId,
      unifiedDiff: snapshotMeta?.unifiedDiff,
      diffByFile: snapshotMeta?.diffByFile,
      summary: output.slice(0, 4000),
      activity: 'Completed',
      durationMs,
      exitCode: procResult.exitCode,
      timedOut: false,
      cancelled: false,
      attempt,
      retries: retriesUsed,
    }

    return { run, output }
  }

  // Exhausted retries
  const diag =
    lastDiag ??
    classifyCodexFailure({
      exitCode: lastProc?.exitCode ?? null,
      stdout: lastProc?.stdout ?? '',
      stderr: lastProc?.stderr ?? '',
      cancelled: false,
      timedOut: false,
      durationMs: Date.now() - startedMs,
      attempt: 1 + MAX_UPSTREAM_RETRIES,
    })
  const run: CodexRunRecord = {
    ...baseRun,
    status: 'failed',
    completedAt: new Date().toISOString(),
    changedFiles: input.mode === 'implement' ? lastChanged : [],
    activity: 'Failed',
    summary: sanitizeSnippet(
      [(lastProc?.stdout ?? '').slice(-1500), (lastProc?.stderr ?? '').slice(-800)]
        .filter(Boolean)
        .join('\n'),
      2000,
    ),
  }
  throwCodexFailure(diag, run, retriesUsed, run.summary)
}
