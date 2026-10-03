/**
 * Data filesystem adapter.
 *
 * Local mode: plain node:fs.
 * Cloud mode (Vercel + Supabase env): every path under the cloud data root
 * (default /tmp/agent-deck, see loadEnv.applyCloudDataDefaults) is stored as a
 * row in Supabase `public.fs_files` instead of the ephemeral, per-instance /tmp.
 * Paths outside the root (bundled read-only files) still use node:fs.
 *
 * Repositories import { readFile, writeFile, ... } from here instead of
 * node:fs/promises, so their JSON-document semantics stay unchanged.
 */
import * as nodeFs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { isCloudRuntime } from '../loadEnv.js'

export const constants = fsConstants

type Encoding = BufferEncoding | { encoding?: BufferEncoding | null } | null | undefined

function cloudRoot(): string {
  return path.resolve(process.env.AGENT_DECK_CLOUD_ROOT ?? '/tmp/agent-deck')
}

export function cloudStoreConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/** True when data paths are persisted to Supabase instead of local disk. */
export function usesCloudStore(): boolean {
  return isCloudRuntime() && cloudStoreConfigured()
}

/** Returns the storage key for a cloud-backed path, or null for real-fs paths. */
function keyFor(p: string): string | null {
  if (!usesCloudStore()) return null
  const abs = path.resolve(String(p))
  const root = cloudRoot()
  if (abs === root) return ''
  if (abs.startsWith(root + path.sep)) return abs.slice(root.length + 1).split(path.sep).join('/')
  return null
}

function enoent(p: string, op: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), {
    code: 'ENOENT',
    errno: -2,
    syscall: op,
    path: p,
  })
}

function encodingOf(opt: Encoding): BufferEncoding | null {
  if (!opt) return null
  if (typeof opt === 'string') return opt
  return opt.encoding ?? null
}

// ------------------------------------------------------------------ Supabase REST
function base(): string {
  return String(process.env.SUPABASE_URL).replace(/\/$/, '')
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY).trim()
  // New secret keys (sb_secret_…) are not JWTs: Supabase wants them on `apikey` only.
  // Legacy service_role keys are JWTs and also go in Authorization.
  if (key.startsWith('sb_')) return { apikey: key, ...extra }
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra }
}

async function rest(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${base()}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Supabase storage ${init.method ?? 'GET'} failed (${res.status}): ${body.slice(0, 300)}`)
  }
  return res
}

type Row = { content: string; encoding: 'utf8' | 'base64' }

async function getRow(key: string): Promise<Row | null> {
  const res = await rest(`fs_files?path=eq.${encodeURIComponent(key)}&select=content,encoding`)
  const rows = (await res.json()) as Row[]
  return rows[0] ?? null
}

async function putRow(key: string, data: string | Uint8Array): Promise<void> {
  const isText = typeof data === 'string'
  const content = isText ? data : Buffer.from(data).toString('base64')
  await rest('fs_files?on_conflict=path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      path: key,
      content,
      encoding: isText ? 'utf8' : 'base64',
      size: isText ? Buffer.byteLength(data) : data.byteLength,
      updated_at: new Date().toISOString(),
    }),
  })
}

async function deleteRow(key: string): Promise<number> {
  const res = await rest(`fs_files?path=eq.${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  })
  const rows = (await res.json()) as unknown[]
  return rows.length
}

async function listKeys(prefix: string): Promise<string[]> {
  const res = await rest('rpc/fs_list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix }),
  })
  const rows = (await res.json()) as Array<{ path: string }>
  return rows.map((r) => r.path)
}

async function deletePrefix(prefix: string): Promise<void> {
  await rest('rpc/fs_delete_prefix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix }),
  })
}

function decode(row: Row, enc: BufferEncoding | null): string | Buffer {
  const buf = row.encoding === 'base64' ? Buffer.from(row.content, 'base64') : Buffer.from(row.content, 'utf8')
  return enc ? buf.toString(enc) : buf
}

// ------------------------------------------------------------------ fs-compatible API
export async function readFile(p: string): Promise<Buffer>
export async function readFile(p: string, opt: BufferEncoding | { encoding: BufferEncoding }): Promise<string>
export async function readFile(p: string, opt?: Encoding): Promise<string | Buffer>
export async function readFile(p: string, opt?: Encoding): Promise<string | Buffer> {
  const key = keyFor(p)
  if (key === null) return nodeFs.readFile(p, opt as BufferEncoding) as Promise<string | Buffer>
  const row = await getRow(key)
  if (!row) throw enoent(p, 'open')
  return decode(row, encodingOf(opt))
}

export async function writeFile(p: string, data: string | Uint8Array, opt?: unknown): Promise<void> {
  const key = keyFor(p)
  if (key === null) return nodeFs.writeFile(p, data, opt as never)
  await putRow(key, data)
}

export async function mkdir(p: string, opt?: { recursive?: boolean; mode?: number }): Promise<string | undefined> {
  if (keyFor(p) === null) return nodeFs.mkdir(p, opt)
  return undefined // directories are implicit in the cloud store
}

export async function readdir(p: string): Promise<string[]> {
  const key = keyFor(p)
  if (key === null) return nodeFs.readdir(p)
  const prefix = key === '' ? '' : `${key}/`
  const names = new Set<string>()
  for (const k of await listKeys(prefix)) {
    const rest_ = k.slice(prefix.length)
    if (rest_) names.add(rest_.split('/')[0])
  }
  if (names.size === 0) throw enoent(p, 'scandir')
  return [...names].sort()
}

export async function unlink(p: string): Promise<void> {
  const key = keyFor(p)
  if (key === null) return nodeFs.unlink(p)
  const n = await deleteRow(key)
  if (n === 0) throw enoent(p, 'unlink')
}

export async function rm(p: string, opt?: { recursive?: boolean; force?: boolean }): Promise<void> {
  const key = keyFor(p)
  if (key === null) return nodeFs.rm(p, opt)
  const n = await deleteRow(key)
  if (opt?.recursive) await deletePrefix(key === '' ? '' : `${key}/`)
  else if (n === 0 && !opt?.force) throw enoent(p, 'rm')
}

export async function rename(from: string, to: string): Promise<void> {
  const a = keyFor(from)
  const b = keyFor(to)
  if (a === null && b === null) return nodeFs.rename(from, to)
  const data = await readFile(from)
  await writeFile(to, data)
  await unlink(from).catch(() => undefined)
}

export async function access(p: string, mode?: number): Promise<void> {
  const key = keyFor(p)
  if (key === null) return nodeFs.access(p, mode)
  if (key === '') return
  if (await getRow(key)) return
  const children = await listKeys(`${key}/`)
  if (!children.length) throw enoent(p, 'access')
}

export async function chmod(p: string, mode: number): Promise<void> {
  if (keyFor(p) === null) return nodeFs.chmod(p, mode)
}

/** Atomic-ish JSON write: real fs uses temp+fsync+rename; cloud upsert is atomic per row. */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const payload = `${JSON.stringify(data, null, 2)}\n`
  if (keyFor(filePath) !== null) {
    await putRow(keyFor(filePath)!, payload)
    return
  }
  const dir = path.dirname(filePath)
  await nodeFs.mkdir(dir, { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  const fh = await nodeFs.open(tmp, 'w')
  try {
    await fh.writeFile(payload, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await nodeFs.rename(tmp, filePath)
  } catch (err) {
    await nodeFs.unlink(tmp).catch(() => undefined)
    throw err
  }
}
