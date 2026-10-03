import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the actual client auth/API sources with SDK/network adapters only;
// synthetic sessions remain inside this isolated fixture.
let token: string | null = 'synthetic-first-session'
let sessionReads = 0
const requests: { path: string; headers: Headers; init?: RequestInit }[] = []
const sdk = { auth: {
  getSession: async () => { sessionReads++; return { data: { session: token ? { access_token: token, user: { email: 'fixture@example.test' } } : null }, error: null } },
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
} }
const fetchAdapter = async (input: string, init?: RequestInit) => {
  requests.push({ path: input, headers: new Headers(init?.headers), init })
  if (input.endsWith('/api/auth/config')) return Response.json({ cloud: true, configured: true, supabaseUrl: 'https://fixture.invalid', anonKey: 'synthetic-publishable', storage: 'supabase' })
  if (input.endsWith('/api/session/bootstrap')) return Response.json({ ok: true })
  return Response.json({ agents: [], source: 'bundled', total: 279, revision: 1 })
}
function fakeCreate(initializer: (set: (patch: object) => void) => object) {
  let state: object
  const set = (patch: object) => { state = { ...state, ...patch } }
  state = initializer(set)
  return Object.assign(() => state, { getState: () => state })
}
async function loadSource(file: string, requireAdapter: (name: string) => unknown) {
  const source = (await readFile(file, 'utf8')).replaceAll("import.meta.env.VITE_API_URL ?? ''", "''")
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const module = { exports: {} as Record<string, any> }
  vm.runInNewContext(compiled, { module, exports: module.exports, require: requireAdapter, fetch: fetchAdapter, Headers, Response, URL, AbortSignal, console }, { filename: file })
  return module.exports
}
const auth = await loadSource('client/src/auth/cloudAuth.ts', (name) => {
  if (name === 'zustand') return { create: fakeCreate }
  if (name === '@supabase/supabase-js') return { createClient: () => sdk }
  throw new Error(`Unexpected auth dependency: ${name}`)
})
const api = await loadSource('client/src/api/client.ts', (name) => {
  if (name === '../auth/cloudAuth') return auth
  throw new Error(`Unexpected API dependency: ${name}`)
})
assert.equal(await auth.ensureSession(), true)
assert.equal(auth.useAuthStore.getState().status, 'ready')
await api.fetchRegistry()
assert.equal(requests.at(-1)?.headers.get('Authorization'), 'Bearer synthetic-first-session')
token = 'synthetic-refreshed-session'
await api.fetchProjects()
assert.equal(requests.at(-1)?.headers.get('Authorization'), 'Bearer synthetic-refreshed-session')
assert.equal(requests.at(-1)?.init?.credentials, 'include')
console.log('Cloud auth PASS: authenticated bootstrap followed by bearer API requests; refreshed SDK session used on next request')
auth.useAuthStore.getState().set({ status: 'local' })
const before = sessionReads
await api.fetchRegistry()
assert.equal(requests.at(-1)?.headers.get('Authorization'), null)
assert.equal(sessionReads, before)
assert.equal(requests.at(-1)?.init?.credentials, 'include')
console.log('Local auth PASS: session cookie retained; no SDK session read or bearer added')
auth.useAuthStore.getState().set({ status: 'ready' })
token = null
assert.equal(await auth.getCloudAccessToken(), undefined)
assert.equal(auth.useAuthStore.getState().status, 'signed-out')
console.log('Missing session PASS: signed-out state; no stale token reuse')
