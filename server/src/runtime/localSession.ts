import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Request, Response, NextFunction } from 'express'
import { hardenError } from './hardenErrors.js'

const SESSION_HEADER = 'x-agent-deck-session'
const COOKIE_NAME = 'agent_deck_session'

function defaultSessionFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_SESSION_FILE ??
    path.resolve(here, '../../data/.local-session')
  )
}

let cachedToken: string | null = null

export async function initLocalSession(): Promise<string> {
  const file = defaultSessionFile()
  await mkdir(path.dirname(file), { recursive: true })
  // Prefer existing token across soft restarts in same data dir (dev)
  try {
    const existing = (await readFile(file, 'utf8')).trim()
    if (existing.length >= 32) {
      cachedToken = existing
      return existing
    }
  } catch {
    /* create new */
  }
  const token = randomBytes(32).toString('hex')
  await writeFile(file, token, { mode: 0o600 })
  cachedToken = token
  return token
}

export function getLocalSessionToken(): string {
  if (!cachedToken) {
    throw new Error('Local session not initialized')
  }
  return cachedToken
}

export function sessionFilePath(): string {
  return defaultSessionFile()
}

function extractToken(req: Request): string | null {
  const header = req.header(SESSION_HEADER)?.trim()
  if (header) return header
  const cookie = req.headers.cookie
  if (!cookie) return null
  const parts = cookie.split(';')
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=')
    if (k === COOKIE_NAME) return rest.join('=').trim() || null
  }
  return null
}

export function isLocalhostAddress(addr: string | undefined): boolean {
  if (!addr) return false
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr === 'localhost'
  )
}

/** Safe origins for browser clients (Vite default). */
export const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true // same-origin / curl / vite proxy without Origin
  return ALLOWED_ORIGINS.has(origin)
}

/**
 * Issue HttpOnly cookie — token value is not rendered in UI.
 * Only for localhost clients.
 */
export function issueSessionCookie(res: Response): void {
  const token = getLocalSessionToken()
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
  )
}

/**
 * Protect mutation / dangerous APIs.
 * Read-only health/bootstrap may skip.
 */
export function requireLocalSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = extractToken(req)
  const expected = getLocalSessionToken()
  if (!token || token !== expected) {
    const err = hardenError(
      'SESSION_UNAUTHORIZED',
      'Missing or invalid local session credential',
    )
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      userMessageKo: err.userMessageKo,
    })
    return
  }
  next()
}

export { SESSION_HEADER, COOKIE_NAME }
