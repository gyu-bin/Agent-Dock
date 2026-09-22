import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const IGNORE_DIR = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
  'tmp',
  '.tmp',
])

export type FileFingerprint = Map<string, string>

async function walk(
  root: string,
  dir: string,
  out: FileFingerprint,
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') {
      if (entry.name === '.git') continue
      // skip most dotfiles/dirs except allowing .env.example above
      if (entry.isDirectory()) continue
    }
    if (IGNORE_DIR.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(root, full, out)
      continue
    }
    if (!entry.isFile()) continue
    try {
      const st = await stat(full)
      if (st.size > 2_000_000) {
        out.set(path.relative(root, full), `size:${st.size}:mtime:${st.mtimeMs}`)
        continue
      }
      const buf = await readFile(full)
      const hash = createHash('sha256').update(buf).digest('hex')
      out.set(path.relative(root, full), hash)
    } catch {
      // ignore unreadable
    }
  }
}

export async function snapshotProjectFiles(
  projectRoot: string,
): Promise<FileFingerprint> {
  const map: FileFingerprint = new Map()
  await walk(projectRoot, projectRoot, map)
  return map
}

export function diffFingerprints(
  before: FileFingerprint,
  after: FileFingerprint,
): string[] {
  const changed: string[] = []
  for (const [file, hash] of after) {
    if (before.get(file) !== hash) changed.push(file)
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changed.push(file)
  }
  return [...new Set(changed)].sort()
}
