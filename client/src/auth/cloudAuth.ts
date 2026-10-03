/**
 * Cloud login (Vercel deployment): Supabase Auth magic link.
 * Local mode never loads Supabase; the server hands out a local session cookie.
 */
import { create } from 'zustand'
import type { SupabaseClient } from '@supabase/supabase-js'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

export interface AuthConfig {
  cloud: boolean
  configured: boolean
  supabaseUrl: string | null
  anonKey: string | null
  storage: 'supabase' | 'ephemeral' | 'local'
}

export type AuthStatus =
  | 'checking'
  | 'local'          // local server, no login
  | 'ready'          // cloud, signed in + allowed
  | 'signed-out'
  | 'not-allowed'
  | 'misconfigured'

interface AuthState {
  status: AuthStatus
  email: string | null
  storage: AuthConfig['storage'] | null
  set: (p: Partial<Omit<AuthState, 'set'>>) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'checking',
  email: null,
  storage: null,
  set: (p) => set(p),
}))

let supabase: SupabaseClient | null = null

/** Read the current SDK-managed session for API authentication; never cache a token separately. */
export async function getCloudAccessToken(): Promise<string | undefined> {
  if (useAuthStore.getState().status !== 'ready' || !supabase) return undefined
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) {
    useAuthStore.getState().set({ status: 'signed-out', email: null })
    return undefined
  }
  return data.session.access_token
}

async function client(cfg: AuthConfig): Promise<SupabaseClient> {
  if (supabase) return supabase
  const { createClient } = await import('@supabase/supabase-js')
  supabase = createClient(cfg.supabaseUrl!, cfg.anonKey!, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  })
  return supabase
}

async function exchange(token: string): Promise<'ok' | 'not-allowed' | 'invalid' | 'misconfigured'> {
  const res = await fetch(`${API_BASE}/api/session/bootstrap`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.ok) return 'ok'
  const body = (await res.json().catch(() => ({}))) as { reason?: string }
  if (res.status === 503) return 'misconfigured'
  return body.reason === 'not_allowed' ? 'not-allowed' : 'invalid'
}

/**
 * Resolves once the API can be called: local session issued, or cloud user signed in.
 * Returns false when the login screen must be shown instead.
 */
export async function ensureSession(): Promise<boolean> {
  const store = useAuthStore.getState()
  const cfgRes = await fetch(`${API_BASE}/api/auth/config`, { credentials: 'include' }).catch(() => null)
  const cfg = cfgRes && cfgRes.ok ? ((await cfgRes.json()) as AuthConfig) : null

  if (!cfg || !cfg.cloud) {
    await fetch(`${API_BASE}/api/session/bootstrap`, { credentials: 'include' })
    store.set({ status: 'local', storage: cfg?.storage ?? 'local' })
    return true
  }
  store.set({ storage: cfg.storage })
  if (!cfg.configured || !cfg.supabaseUrl || !cfg.anonKey) {
    store.set({ status: 'misconfigured' })
    return false
  }
  const sb = await client(cfg)
  const { data } = await sb.auth.getSession()
  const session = data.session
  if (!session) {
    store.set({ status: 'signed-out', email: null })
    return false
  }
  const result = await exchange(session.access_token)
  if (result !== 'ok') {
    store.set({ status: result === 'not-allowed' ? 'not-allowed' : result === 'misconfigured' ? 'misconfigured' : 'signed-out', email: session.user.email ?? null })
    return false
  }
  store.set({ status: 'ready', email: session.user.email ?? null })
  // Keep the HttpOnly cookie in step with Supabase's token refresh.
  sb.auth.onAuthStateChange((event, next) => {
    if (next && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) void exchange(next.access_token)
    if (event === 'SIGNED_OUT') useAuthStore.getState().set({ status: 'signed-out', email: null })
  })
  return true
}

export async function sendMagicLink(email: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const cfgRes = await fetch(`${API_BASE}/api/auth/config`, { credentials: 'include' })
  const cfg = (await cfgRes.json()) as AuthConfig
  const sb = await client(cfg)
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin },
  })
  return error ? { ok: false, message: error.message } : { ok: true }
}

export async function signOut(): Promise<void> {
  await fetch(`${API_BASE}/api/session/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined)
  await supabase?.auth.signOut().catch(() => undefined)
  useAuthStore.getState().set({ status: 'signed-out', email: null })
}
