import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Request, Response, NextFunction } from 'express'
import { isCloudRuntime } from '../loadEnv.js'
import { hardenError } from './hardenErrors.js'
import { bearerFrom, verifyAccessToken } from './cloudAuth.js'

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
  // Stable across serverless cold starts when set in Vercel env.
  const fromEnv = process.env.AGENT_DECK_SESSION_TOKEN?.trim()
  if (fromEnv && fromEnv.length >= 32) {
    cachedToken = fromEnv
    return fromEnv
  }

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

/** Safe origins for browser clients (Vite default + optional allowlist). */
export const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true // same-origin / curl / vite proxy without Origin
  if (ALLOWED_ORIGINS.has(origin)) return true

  const extras = (process.env.AGENT_DECK_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (extras.includes(origin)) return true

  if (isCloudRuntime()) {
    try {
      const host = new URL(origin).hostname
      if (host.endsWith('.vercel.app')) return true
      const vercelUrl = process.env.VERCEL_URL?.replace(/^https?:\/\//, '')
      if (vercelUrl && host === vercelUrl) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

/**
 * Issue HttpOnly cookie — token value is not rendered in UI.
 */
export function issueSessionCookie(res: Response, cloudToken?: string): void {
  // Cloud: the cookie carries the verified Supabase access token (≈1h, refreshed by the client).
  const token = cloudToken ?? getLocalSessionToken()
  const secure = isCloudRuntime() ? '; Secure' : ''
  const sameSite = isCloudRuntime() ? 'Lax' : 'Strict'
  const maxAge = cloudToken ? 3600 : 86400
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=${maxAge}`,
  )
}

export function clearSessionCookie(res: Response): void {
  const secure = isCloudRuntime() ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`)
}

function sendUnauthorized(res: Response, detail: string): void {
  const err = hardenError('SESSION_UNAUTHORIZED', detail)
  res.status(err.status).json({ error: err.message, code: err.code, userMessageKo: err.userMessageKo })
}

/** Cloud: valid Supabase token (cookie or Bearer) for an allowlisted email. */
export async function requireCloudSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = bearerFrom(req) ?? extractToken(req)
  const result = await verifyAccessToken(token)
  if (result.ok) {
    next()
    return
  }
  if (result.reason === 'not_configured') {
    res.status(503).json({
      error: 'Cloud auth is not configured (SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_DECK_ALLOWED_EMAILS).',
      code: 'AUTH_NOT_CONFIGURED',
      userMessageKo: '클라우드 로그인 설정이 아직 안 되어 있어요. Vercel 환경변수를 확인해 주세요.',
    })
    return
  }
  sendUnauthorized(res, result.reason === 'not_allowed' ? 'Email not allowed' : 'Missing or invalid login session')
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
  if (isCloudRuntime()) {
    void requireCloudSession(req, res, next)
    return
  }
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
