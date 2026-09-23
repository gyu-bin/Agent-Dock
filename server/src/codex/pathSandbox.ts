import { access, constants, realpath, stat, lstat } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { hardenError } from '../runtime/hardenErrors.js'

const BLOCKED_ROOTS = [
  path.resolve('/'),
  path.resolve('/etc'),
  path.resolve('/usr'),
  path.resolve('/bin'),
  path.resolve('/sbin'),
  path.resolve('/System'),
  path.resolve('/Library'),
  path.resolve('/private'),
]

/**
 * Validate that a Project.path is a real directory we allow Codex to touch.
 * Never grants whole-filesystem access. Uses realpath (no symlink root trick).
 */
export async function assertSafeProjectPath(
  rawPath: string | undefined | null,
): Promise<string> {
  if (!rawPath || !String(rawPath).trim()) {
    throw Object.assign(
      new Error('Project.path is not set. Codex requires a repository path.'),
      { status: 400, code: 'PATH_MISSING' },
    )
  }

  const expanded = String(rawPath).trim().replace(/^~(?=$|\/|\\)/, homedir())
  const resolved = path.resolve(expanded)

  try {
    await access(resolved)
  } catch {
    throw Object.assign(
      new Error(`Project.path does not exist: ${resolved}`),
      { status: 400, code: 'PATH_MISSING' },
    )
  }

  // Reject symlink-as-root that points outside after realpath — still allow
  // real directories. lstat detects if the path itself is a symlink.
  const lst = await lstat(resolved)
  if (lst.isSymbolicLink()) {
    // Symlink project roots are allowed only if realpath stays a directory
    // and passes the same checks — we still resolve below.
  }

  const st = await stat(resolved)
  if (!st.isDirectory()) {
    throw Object.assign(
      new Error(`Project.path is not a directory: ${resolved}`),
      { status: 400, code: 'PATH_NOT_DIR' },
    )
  }

  let real: string
  try {
    real = await realpath(resolved)
  } catch {
    throw Object.assign(
      new Error(`Cannot resolve Project.path: ${resolved}`),
      { status: 400, code: 'PATH_UNRESOLVED' },
    )
  }

  const home = await realpath(homedir()).catch(() => homedir())
  if (real === home) {
    throw Object.assign(
      new Error('Project.path cannot be the home directory.'),
      { status: 400, code: 'PATH_FORBIDDEN' },
    )
  }

  for (const root of BLOCKED_ROOTS) {
    if (real === root) {
      throw Object.assign(
        new Error(`Project.path is not allowed: ${real}`),
        { status: 400, code: 'PATH_FORBIDDEN' },
      )
    }
  }

  const lower = real.toLowerCase()
  if (
    lower.includes(`${path.sep}.ssh`) ||
    lower.includes(`${path.sep}.gnupg`) ||
    lower.endsWith(`${path.sep}library${path.sep}keychains`)
  ) {
    throw Object.assign(
      new Error('Project.path points to a sensitive location.'),
      { status: 400, code: 'PATH_FORBIDDEN' },
    )
  }

  return real
}

/** Extra check for IMPLEMENT — directory must be writable. */
export async function assertWritableProjectPath(
  rawPath: string | undefined | null,
): Promise<string> {
  const real = await assertSafeProjectPath(rawPath)
  try {
    await access(real, constants.R_OK | constants.W_OK)
  } catch {
    throw Object.assign(
      new Error(`Project.path is not writable: ${real}`),
      { status: 400, code: 'PATH_NOT_WRITABLE' },
    )
  }
  return real
}

function isInsideRoot(rootReal: string, candidateReal: string): boolean {
  const rel = path.relative(rootReal, candidateReal)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Ensure candidate path stays inside the sandboxed project root.
 * Uses realpath for existing files/dirs and for the nearest existing parent
 * of new paths — never string-prefix alone.
 */
export async function assertPathInsideProject(
  projectRoot: string,
  candidate: string,
): Promise<string> {
  let rootReal: string
  try {
    rootReal = await realpath(path.resolve(projectRoot))
  } catch {
    throw hardenError(
      'PATH_VIOLATION',
      `Cannot resolve project root: ${projectRoot}`,
    )
  }

  // Reject absolute candidates that are outside, and normalize relative
  const abs = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(rootReal, candidate)

  // Walk up to find an existing ancestor for realpath (handles new files +
  // symlink components on the way).
  let probe = abs
  let existingAncestor: string | null = null
  for (;;) {
    try {
      await lstat(probe)
      existingAncestor = probe
      break
    } catch {
      const parent = path.dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }

  if (!existingAncestor) {
    throw hardenError('PATH_VIOLATION', `Path escapes Project.path: ${candidate}`)
  }

  let ancestorReal: string
  try {
    ancestorReal = await realpath(existingAncestor)
  } catch {
    throw hardenError(
      'PATH_VIOLATION',
      `Cannot resolve path (symlink?): ${candidate}`,
    )
  }

  if (!isInsideRoot(rootReal, ancestorReal)) {
    throw hardenError(
      'PATH_VIOLATION',
      `Path escapes Project.path via symlink or traversal: ${candidate}`,
    )
  }

  // If the full path exists, realpath it too (symlink file → outside)
  try {
    const fullReal = await realpath(abs)
    if (!isInsideRoot(rootReal, fullReal)) {
      throw hardenError(
        'PATH_VIOLATION',
        `Path escapes Project.path via symlink: ${candidate}`,
      )
    }
    return fullReal
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'PATH_VIOLATION'
    ) {
      throw err
    }
    // New file: ensure lexical abs is still under rootReal after resolve
    if (!isInsideRoot(rootReal, abs) && !isInsideRoot(rootReal, ancestorReal)) {
      throw hardenError('PATH_VIOLATION', `Path escapes Project.path: ${candidate}`)
    }
    // abs may not exist; return abs only if its dirname chain is inside
    const relToRoot = path.relative(rootReal, abs)
    if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
      throw hardenError('PATH_VIOLATION', `Path escapes Project.path: ${candidate}`)
    }
    return abs
  }
}

/**
 * Assert every relative changed path is inside project (realpath-safe).
 */
export async function assertChangedFilesInsideProject(
  projectRoot: string,
  relativePaths: string[],
): Promise<void> {
  for (const rel of relativePaths) {
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw hardenError(
        'PATH_VIOLATION',
        `Illegal relative path: ${rel}`,
      )
    }
    await assertPathInsideProject(projectRoot, rel)
  }
}

/**
 * Work attachment local-folder paths are READ ONLY references.
 * Never treat them as Codex writable Project.path.
 */
export function isReferenceOnlyFolder(
  candidate: string,
  projectPath: string | undefined,
  referencePaths: string[],
): boolean {
  const c = path.resolve(candidate)
  if (projectPath && path.resolve(projectPath) === c) return false
  return referencePaths.some((r) => path.resolve(r) === c)
}

export function assertReferenceFoldersNotWritableTarget(
  writableProjectPath: string,
  referencePaths: string[],
): void {
  const proj = path.resolve(writableProjectPath)
  for (const ref of referencePaths) {
    if (path.resolve(ref) === proj) {
      throw hardenError(
        'PATH_VIOLATION',
        'Reference attachment folder cannot be the Codex writable project path.',
      )
    }
  }
}
