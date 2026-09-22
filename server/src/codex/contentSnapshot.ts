import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertPathInsideProject,
  assertSafeProjectPath,
} from './pathSandbox.js'
import { diffFingerprints, snapshotProjectFiles } from './fileSnapshot.js'
import { atomicWriteJson } from '../persistence/atomicWrite.js'
import { hardenError } from '../runtime/hardenErrors.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_ROOT = path.resolve(__dirname, '../../data/snapshots')

export type FileChangeKind = 'added' | 'modified' | 'deleted'

export interface SnapshotFileEntry {
  path: string
  /** utf8 text, or null if binary/too large — rollback skips binary */
  content: string | null
  encoding: 'utf8' | 'binary-skip'
  existed: boolean
}

export interface ContentSnapshot {
  id: string
  /** Harden-0: ownership — required for rollback scoping */
  projectId: string
  taskId: string
  stepId: string
  runId: string
  projectPath: string
  createdAt: string
  /** Before-content for files that changed (keyed by relative path) */
  files: SnapshotFileEntry[]
  changedFiles: string[]
  added: string[]
  modified: string[]
  deleted: string[]
  diffByFile: Record<string, string>
  unifiedDiff: string
}

function isProbablyText(buf: Buffer): boolean {
  if (buf.length === 0) return true
  const sample = buf.subarray(0, Math.min(buf.length, 8000))
  let weird = 0
  for (const b of sample) {
    if (b === 0) return false
    if (b < 7 || (b > 13 && b < 32)) weird++
  }
  return weird / sample.length < 0.02
}

async function readTextSafe(abs: string): Promise<SnapshotFileEntry['content']> {
  try {
    const buf = await readFile(abs)
    if (buf.length > 1_500_000) return null
    if (!isProbablyText(buf)) return null
    return buf.toString('utf8')
  } catch {
    return null
  }
}

function unifiedDiffForFile(
  filePath: string,
  before: string | null,
  after: string | null,
): string {
  const a = before ?? ''
  const b = after ?? ''
  if (a === b) return ''
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const header =
    before == null
      ? `--- /dev/null\n+++ b/${filePath}\n`
      : after == null
        ? `--- a/${filePath}\n+++ /dev/null\n`
        : `--- a/${filePath}\n+++ b/${filePath}\n`

  if (aLines.length + bLines.length > 8000) {
    return (
      header +
      `@@ large file @@\n` +
      `-${aLines.length} lines before\n` +
      `+${bLines.length} lines after\n`
    )
  }

  const ops = diffOps(aLines, bLines)
  const body = ops.map((op) => {
    if (op.type === 'equal') return ` ${op.line}`
    if (op.type === 'del') return `-${op.line}`
    return `+${op.line}`
  })
  return `${header}@@ -1,${aLines.length} +1,${bLines.length} @@\n${body.join('\n')}\n`
}

type DiffOp =
  | { type: 'equal'; line: string }
  | { type: 'del'; line: string }
  | { type: 'add'; line: string }

function diffOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  if (n * m > 2_000_000) {
    return [
      ...a.map((line) => ({ type: 'del' as const, line })),
      ...b.map((line) => ({ type: 'add' as const, line })),
    ]
  }
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i]![j] = (dp[i - 1]![j - 1] ?? 0) + 1
      else dp[i]![j] = Math.max(dp[i - 1]![j] ?? 0, dp[i]![j - 1] ?? 0)
    }
  }
  const rev: DiffOp[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      rev.push({ type: 'equal', line: a[i - 1]! })
      i--
      j--
    } else if (j > 0 && (i === 0 || (dp[i]![j - 1] ?? 0) >= (dp[i - 1]![j] ?? 0))) {
      rev.push({ type: 'add', line: b[j - 1]! })
      j--
    } else {
      rev.push({ type: 'del', line: a[i - 1]! })
      i--
    }
  }
  return rev.reverse()
}

async function ensureSnapshotDir(): Promise<void> {
  await mkdir(SNAPSHOT_ROOT, { recursive: true })
}

export async function loadContentSnapshot(
  snapshotId: string,
): Promise<ContentSnapshot | null> {
  try {
    const raw = await readFile(path.join(SNAPSHOT_ROOT, `${snapshotId}.json`), 'utf8')
    return JSON.parse(raw) as ContentSnapshot
  } catch {
    return null
  }
}

export async function saveContentSnapshot(
  snap: ContentSnapshot,
): Promise<void> {
  await ensureSnapshotDir()
  const dest = path.join(SNAPSHOT_ROOT, `${snap.id}.json`)
  await atomicWriteJson(dest, snap)
}

/**
 * After implement: build snapshot of changed files with before content,
 * unified diffs, and classification (added/modified/deleted).
 */
export async function buildImplementSnapshot(input: {
  runId: string
  taskId: string
  stepId: string
  projectId: string
  projectPath: string
  beforeFingerprint: Awaited<ReturnType<typeof snapshotProjectFiles>>
  /** relative path → before file content (captured pre-implement) */
  beforeContents: Map<string, string | null>
}): Promise<ContentSnapshot> {
  const projectPath = await assertSafeProjectPath(input.projectPath)
  const after = await snapshotProjectFiles(projectPath)
  const changed = diffFingerprints(input.beforeFingerprint, after)

  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []
  const files: SnapshotFileEntry[] = []
  const diffByFile: Record<string, string> = {}

  for (const rel of changed) {
    await assertPathInsideProject(projectPath, rel)
    const abs = path.join(projectPath, rel)
    const hadBefore = input.beforeFingerprint.has(rel)
    const hasAfter = after.has(rel)
    let kind: FileChangeKind
    if (!hadBefore && hasAfter) {
      kind = 'added'
      added.push(rel)
    } else if (hadBefore && !hasAfter) {
      kind = 'deleted'
      deleted.push(rel)
    } else {
      kind = 'modified'
      modified.push(rel)
    }

    const beforeContent = hadBefore
      ? (input.beforeContents.get(rel) ?? null)
      : null
    const afterContent = hasAfter ? await readTextSafe(abs) : null

    files.push({
      path: rel,
      content: beforeContent,
      encoding: beforeContent == null && hadBefore ? 'binary-skip' : 'utf8',
      existed: hadBefore,
    })

    const diff = unifiedDiffForFile(rel, beforeContent, afterContent)
    if (diff) diffByFile[rel] = diff
    void kind
  }

  const unifiedDiff = Object.keys(diffByFile)
    .sort()
    .map((f) => diffByFile[f])
    .join('\n')

  const snap: ContentSnapshot = {
    id: `snap_${input.runId}`,
    projectId: input.projectId,
    taskId: input.taskId,
    stepId: input.stepId,
    runId: input.runId,
    projectPath,
    createdAt: new Date().toISOString(),
    files,
    changedFiles: changed,
    added,
    modified,
    deleted,
    diffByFile,
    unifiedDiff: unifiedDiff.slice(0, 2_000_000),
  }
  await saveContentSnapshot(snap)
  return snap
}

/** Capture text contents for all fingerprinted files (pre-implement). */
export async function captureBeforeContents(
  projectPath: string,
  fingerprint: Awaited<ReturnType<typeof snapshotProjectFiles>>,
): Promise<Map<string, string | null>> {
  const root = await assertSafeProjectPath(projectPath)
  const map = new Map<string, string | null>()
  for (const rel of fingerprint.keys()) {
    await assertPathInsideProject(root, rel)
    map.set(rel, await readTextSafe(path.join(root, rel)))
  }
  return map
}

/**
 * Restore files from snapshot — only paths inside Project.path.
 * Harden-0: requires matching projectId and project path ownership.
 */
export async function restoreContentSnapshot(
  snapshotId: string,
  opts: {
    projectId: string
    projectPath: string
  },
): Promise<{ ok: boolean; restored: string[]; error?: string; code?: string }> {
  const snap = await loadContentSnapshot(snapshotId)
  if (!snap) {
    return { ok: false, restored: [], error: `Snapshot not found: ${snapshotId}` }
  }

  // Legacy snapshots without projectId: still require path match
  if (snap.projectId && snap.projectId !== opts.projectId) {
    throw hardenError(
      'SNAPSHOT_OWNERSHIP',
      `snapshot.projectId=${snap.projectId} !== requested=${opts.projectId}`,
    )
  }

  const requestedRoot = await assertSafeProjectPath(opts.projectPath)
  const snapRoot = await assertSafeProjectPath(snap.projectPath)
  if (requestedRoot !== snapRoot) {
    throw hardenError(
      'SNAPSHOT_OWNERSHIP',
      `snapshot path ${snapRoot} !== project path ${requestedRoot}`,
    )
  }

  const root = requestedRoot
  const restored: string[] = []

  for (const rel of snap.added) {
    await assertPathInsideProject(root, rel)
    const abs = path.join(root, rel)
    try {
      await rm(abs, { force: true })
      restored.push(rel)
    } catch (err) {
      return {
        ok: false,
        restored,
        error: `Failed to remove added file ${rel}: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  for (const entry of snap.files) {
    if (snap.added.includes(entry.path)) continue
    await assertPathInsideProject(root, entry.path)
    const abs = path.join(root, entry.path)
    if (entry.encoding === 'binary-skip' || entry.content == null) {
      continue
    }
    try {
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, entry.content, 'utf8')
      restored.push(entry.path)
    } catch (err) {
      return {
        ok: false,
        restored,
        error: `Failed to restore ${entry.path}: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  return { ok: true, restored: [...new Set(restored)] }
}

export async function getSnapshotDiff(
  snapshotId: string,
): Promise<ContentSnapshot | null> {
  return loadContentSnapshot(snapshotId)
}
