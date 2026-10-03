/**
 * Cloud (Vercel) authentication: Supabase Auth access tokens + email allowlist.
 *
 * Local mode keeps the random local-session cookie (localSession.ts).
 * In cloud mode the same cookie carries the user's Supabase access token,
 * which the server verifies against Supabase on each request (short cache).
 * Fails closed: missing config or an empty allowlist rejects everyone.
 */
import type { Request } from 'express'

const CACHE_MS = 60_000
const cache = new Map<string, { email: string; userId: string; until: number }>()

export interface CloudAuthConfig {
  supabaseUrl: string
  anonKey: string
}

export function cloudAuthConfig(): CloudAuthConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL?.trim()
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY)?.trim()
  if (!supabaseUrl || !anonKey) return null
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), anonKey }
}

export function allowedEmails(): string[] {
  return (process.env.AGENT_DECK_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function bearerFrom(req: Request): string | null {
  const h = req.header('authorization')
  if (h && /^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim() || null
  return null
}

export type VerifyResult =
  | { ok: true; email: string; userId: string }
  | { ok: false; reason: 'not_configured' | 'invalid' | 'not_allowed'; email?: string }

export async function verifyAccessToken(token: string | null): Promise<VerifyResult> {
  const cfg = cloudAuthConfig()
  const allow = allowedEmails()
  if (!cfg || allow.length === 0) return { ok: false, reason: 'not_configured' }
  if (!token) return { ok: false, reason: 'invalid' }

  const now = Date.now()
  const hit = cache.get(token)
  let email: string | null = hit && hit.until > now ? hit.email : null
  let userId: string | null = hit && hit.until > now ? hit.userId : null
  if (!email || !userId) {
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` },
    }).catch(() => null)
    if (!res || !res.ok) return { ok: false, reason: 'invalid' }
    const user = (await res.json().catch(() => null)) as { email?: string; id?: string } | null
    email = user?.email?.toLowerCase() ?? null
    userId = user?.id ?? null
    if (!email || !userId) return { ok: false, reason: 'invalid' }
    cache.set(token, { email, userId, until: now + CACHE_MS })
    if (cache.size > 200) {
      for (const [k, v] of cache) if (v.until <= now) cache.delete(k)
    }
  }
  if (!allow.includes(email)) return { ok: false, reason: 'not_allowed', email }
  return { ok: true, email, userId: userId! }
}
