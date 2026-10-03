/** Local public-client OAuth. Credentials never enter the application data/blob store. */
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, readFile, writeFile, rename, chmod, unlink, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRemoteJWKSet, jwtVerify, customFetch, type JWTPayload } from 'jose'
import { isCloudRuntime } from '../loadEnv.js'

const ISSUER = 'https://auth.openai.com'
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`
const TOKEN = `${ISSUER}/api/accounts/oauth/token`
const RESOURCE = 'https://api.openai.com/v1'
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const DIRECT = 'chatgpt.tokens.use.direct'

export class ChatGPTAuthError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 401) { super(message) }
}
type Account = { subject: string; email?: string; name?: string; picture?: string; clientId: string }
type Registration = Account & { issuer: string; idToken?: string; accessToken?: string; refreshToken?: string; scopes: string[]; expiresAt: number; earliestRefreshAt: number; requiresReauthorization?: boolean }
type Store = { version: 1; hostId: string; activeId?: string; registrations: Record<string, Registration> }
export type ChatGPTAuthStatus = { supported: boolean; signedIn: boolean; planUsageEnabled: boolean; account?: Account; loginPending: boolean; lastError?: { code: string; message: string }; registrations: Account[] }
type Options = { dir?: string; fetch?: typeof fetch; supported?: boolean; now?: () => number; verifyIdToken?: (token: string, clientId: string, nonce?: string) => Promise<JWTPayload>; audit?: (event: { event: string; code?: string; at: string }) => void }
type Pending = { server: Server; timer: ReturnType<typeof setTimeout>; state: string; nonce: string; verifier: string; redirect: string; selected?: Registration; generation: number; used: boolean }

function fail(code: string, message: string, status = 401): ChatGPTAuthError { return new ChatGPTAuthError(code, message, status) }
function safeEqual(a: string, b: string): boolean { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
function authEndpoint(value: unknown): URL { const u = new URL(String(value)); if (u.protocol !== 'https:' || u.origin !== ISSUER || u.username || u.password) throw fail('CHATGPT_AUTH_CONFIGURATION_INVALID', 'ChatGPT 인증 설정을 확인하지 못했습니다.', 502); return u }
const publicAccount = (r: Registration): Account => ({ subject: r.subject, email: r.email, name: r.name, picture: r.picture, clientId: r.clientId })

export class ChatGPTAuthService {
  private readonly dir: string
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private get supported(): boolean { return this.options.supported ?? !(isCloudRuntime() || process.env.AWS_LAMBDA_FUNCTION_NAME) }
  private pending?: Pending
  private generation = 0
  private refreshFlight?: Promise<string>
  private signinFlight?: Promise<{ authorizationUrl: string; attemptId: string }>
  private lastError?: { code: string; message: string }
  private discovery?: Promise<{ jwks_uri: string; revocation_endpoint?: string }>
  private keySet?: ReturnType<typeof createRemoteJWKSet>
  constructor(private readonly options: Options = {}) {
    this.dir = options.dir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/credentials/chatgpt')
    this.fetcher = options.fetch ?? fetch
    this.now = options.now ?? Date.now
  }
  private audit(event: string, code?: string): void { this.options.audit?.({ event, code, at: new Date(this.now()).toISOString() }) }
  private requireLocal(): void { if (!this.supported) throw fail('CHATGPT_LOCAL_ONLY', 'ChatGPT 플랜 연결은 이 컴퓨터에서 실행 중인 Agent Deck에서 사용할 수 있습니다.', 409) }
  private async read(): Promise<Store> {
    try {
      const s = JSON.parse(await readFile(path.join(this.dir, 'connections.json'), 'utf8')) as Store
      if (s.version !== 1 || !/^urn:uuid:[a-f0-9-]{36}$/i.test(s.hostId) || !s.registrations) throw Error('invalid')
      return s
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, hostId: `urn:uuid:${randomUUID()}`, registrations: {} }; throw fail('CHATGPT_CREDENTIAL_STORAGE_ERROR', 'ChatGPT 연결 정보를 읽지 못했습니다.', 500) }
  }
  private async save(s: Store): Promise<void> {
    const target = path.join(this.dir, 'connections.json'), tmp = `${target}.${randomUUID()}.tmp`
    try { await writeFile(tmp, JSON.stringify(s), { mode: 0o600, flag: 'wx' }); await chmod(tmp, 0o600); await rename(tmp, target) }
    catch { await unlink(tmp).catch(() => {}); throw fail('CHATGPT_CREDENTIAL_STORAGE_ERROR', 'ChatGPT 연결 정보를 저장하지 못했습니다.', 500) }
  }
  // A filesystem lock also prevents separate local server processes rotating the same token.
  private async locked<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 }); await chmod(this.dir, 0o700)
    const lock = path.join(this.dir, '.session-lock'), deadline = Date.now() + 15_000
    for (;;) {
      try { await mkdir(lock, { mode: 0o700 }); await writeFile(path.join(lock, 'owner'), String(process.pid), { mode: 0o600, flag: 'wx' }); break }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw fail('CHATGPT_CREDENTIAL_STORAGE_ERROR', 'ChatGPT 연결 저장소를 사용할 수 없습니다.', 500)
        await this.recoverDeadLock(lock)
        if (Date.now() > deadline) throw fail('CHATGPT_SESSION_BUSY', '다른 ChatGPT 연결 요청이 진행 중입니다.', 409)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    try { return await fn(await this.read()) } finally { await unlink(path.join(lock, 'owner')); await rmdir(lock) }
  }
  private async recoverDeadLock(lock: string): Promise<void> {
    // Only reclaim a positively identified dead process; age alone cannot prove a refresh is finished.
    const recovery = path.join(this.dir, '.lock-recovery')
    try { await mkdir(recovery, { mode: 0o700 }) } catch { return }
    try {
      let pid: number
      try { pid = Number(await readFile(path.join(lock, 'owner'), 'utf8')) } catch { return }
      if (!Number.isInteger(pid) || pid <= 0) return
      try { process.kill(pid, 0); return } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') return }
      await unlink(path.join(lock, 'owner'))
      await rmdir(lock)
      this.audit('dead_session_lock_recovered')
    } catch { /* Another process may already have finished; retry the exclusive lock. */ }
    finally { await rmdir(recovery).catch(() => {}) }
  }
  async getStatus(): Promise<ChatGPTAuthStatus> {
    if (!this.supported) return { supported: false, signedIn: false, planUsageEnabled: false, loginPending: false, registrations: [] }
    const s = await this.read(), r = s.activeId ? s.registrations[s.activeId] : undefined
    const signedIn = !!r?.accessToken && !r.requiresReauthorization
    return { supported: true, signedIn, planUsageEnabled: signedIn && !!r?.scopes.includes(DIRECT), account: r ? publicAccount(r) : undefined, loginPending: !!this.pending, lastError: this.lastError, registrations: Object.values(s.registrations).map(publicAccount) }
  }
  async cancelSignIn(): Promise<void> { this.generation++; const p = this.pending; this.pending = undefined; if (p) { clearTimeout(p.timer); p.server.close(); p.server.closeAllConnections() } }
  async startSignIn(input: { newAccount?: boolean; registrationId?: string } = {}): Promise<{ authorizationUrl: string; attemptId: string }> {
    if (this.signinFlight) throw fail('CHATGPT_SESSION_BUSY', '다른 ChatGPT 연결 요청이 진행 중입니다.', 409)
    this.signinFlight = this.beginSignIn(input)
    try { return await this.signinFlight } finally { this.signinFlight = undefined }
  }
  private async beginSignIn(input: { newAccount?: boolean; registrationId?: string }): Promise<{ authorizationUrl: string; attemptId: string }> {
    this.requireLocal()
    const cancelling = this.cancelSignIn()
    const generation = this.generation
    await cancelling
    this.lastError = undefined
    const s = await this.locked(async store => { await this.save(store); return store })
    if (generation !== this.generation) throw fail('CHATGPT_SIGNIN_CANCELLED', 'ChatGPT 연결 요청이 취소됐습니다.')
    const selected = input.newAccount ? undefined : s.registrations[input.registrationId ?? s.activeId ?? '']
    if (input.registrationId && !selected) throw fail('CHATGPT_SIGNIN_REQUIRED', '저장된 ChatGPT 계정을 찾지 못했습니다.')
    const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url')
    const server = createServer((req, res) => {
      const p = this.pending
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'"); res.setHeader('Referrer-Policy', 'no-referrer')
      if (!p || p.server !== server) { res.writeHead(410); res.end('Sign-in expired.'); return }
      const url = new URL(req.url ?? '/', p.redirect)
      if (req.method !== 'GET' || url.pathname !== '/auth/callback' || req.headers.host !== new URL(p.redirect).host) { res.writeHead(404); res.end(); return }
      const states = url.searchParams.getAll('state')
      if (states.length !== 1 || !safeEqual(states[0], p.state) || p.used) { this.audit('signin_rejected', 'CHATGPT_STATE_MISMATCH'); res.writeHead(400); res.end('Invalid sign-in callback.'); return }
      p.used = true; clearTimeout(p.timer)
      void this.complete(p, url).then(() => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Agent Deck</title><p>ChatGPT 연결 완료. Agent Deck으로 돌아가세요.</p>') }).catch((e: unknown) => {
        const err = e instanceof ChatGPTAuthError ? e : fail('CHATGPT_SIGNIN_FAILED', 'ChatGPT 연결을 완료하지 못했습니다.', 502)
        this.lastError = { code: err.code, message: err.message }; this.audit('signin_failed', err.code)
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(err.message)
      }).finally(() => { if (this.pending === p) this.pending = undefined; server.close() })
    })
    await new Promise<void>((resolve, reject) => { server.once('error', () => reject(fail('CHATGPT_CALLBACK_UNAVAILABLE', '로그인 콜백을 열지 못했습니다.', 503))); server.listen(0, '127.0.0.1', resolve) })
    if (generation !== this.generation) { server.close(); throw fail('CHATGPT_SIGNIN_CANCELLED', 'ChatGPT 연결 요청이 취소됐습니다.') }
    const address = server.address(); if (!address || typeof address === 'string') { server.close(); throw fail('CHATGPT_CALLBACK_UNAVAILABLE', '로그인 콜백을 열지 못했습니다.', 503) }
    const redirect = `http://127.0.0.1:${address.port}/auth/callback`
    const timer = setTimeout(() => { if (this.pending?.server === server) { void this.cancelSignIn(); this.lastError = { code: 'CHATGPT_SIGNIN_TIMEOUT', message: 'ChatGPT 연결 시간이 만료됐습니다. 다시 연결해주세요.' }; this.audit('signin_failed', 'CHATGPT_SIGNIN_TIMEOUT') } }, 5 * 60_000); timer.unref()
    this.pending = { server, timer, state, nonce, verifier, redirect, selected, generation, used: false }
    const url = new URL(AUTHORIZE)
    url.search = new URLSearchParams({ client_id: selected?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: s.hostId, response_type: 'code', redirect_uri: redirect, scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString()
    if (selected) { if (selected.idToken) url.searchParams.set('id_token_hint', selected.idToken); if (selected.email) url.searchParams.set('login_hint', selected.email) } else url.searchParams.set('agent_name_hint', 'Agent Deck')
    this.audit('signin_started'); return { authorizationUrl: url.toString(), attemptId: randomUUID() }
  }
  private async configuration() {
    this.discovery ??= (async () => { const res = await this.fetcher(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000), redirect: 'error' }); if (!res.ok) throw Error(); const doc = await res.json() as Record<string, unknown>; if (doc.issuer !== ISSUER) throw Error(); return { jwks_uri: authEndpoint(doc.jwks_uri).toString(), revocation_endpoint: doc.revocation_endpoint ? authEndpoint(doc.revocation_endpoint).toString() : undefined } })().catch(() => { this.discovery = undefined; throw fail('CHATGPT_AUTH_CONFIGURATION_INVALID', 'ChatGPT 인증 설정을 확인하지 못했습니다.', 502) })
    return this.discovery
  }
  private async verify(token: string, clientId: string, nonce?: string): Promise<JWTPayload> {
    try {
      let payload: JWTPayload
      if (this.options.verifyIdToken) payload = await this.options.verifyIdToken(token, clientId, nonce)
      else { const config = await this.configuration(); this.keySet ??= createRemoteJWKSet(new URL(config.jwks_uri), { [customFetch]: this.fetcher }); ({ payload } = await jwtVerify(token, this.keySet, { issuer: ISSUER, audience: clientId, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'], currentDate: new Date(this.now()) })) }
      if (!payload.sub || payload.iss !== ISSUER || (nonce !== undefined && payload.nonce !== nonce)) throw Error()
      if (payload.azp !== undefined && payload.azp !== clientId) throw Error()
      if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) throw Error()
      return payload
    } catch { throw fail('CHATGPT_ID_TOKEN_INVALID', 'ChatGPT 계정 인증을 검증하지 못했습니다.') }
  }
  private async token(params: Record<string, string>): Promise<Record<string, unknown>> {
    let res: Response
    try { res = await this.fetcher(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20_000), redirect: 'error' }) } catch { throw fail('CHATGPT_NETWORK_ERROR', 'ChatGPT 연결 서버에 접속하지 못했습니다. 잠시 후 다시 시도해주세요.', 502) }
    if (!res.ok) { let code: unknown; try { code = ((await res.json()) as { error?: unknown }).error } catch {} if (code === 'invalid_grant') throw fail('CHATGPT_SESSION_EXPIRED', 'ChatGPT에 다시 연결해주세요.'); throw fail('CHATGPT_TOKEN_EXCHANGE_FAILED', 'ChatGPT 연결 갱신에 실패했습니다.', 502) }
    try { return await res.json() as Record<string, unknown> } catch { throw fail('CHATGPT_TOKEN_EXCHANGE_FAILED', 'ChatGPT 연결 응답을 읽지 못했습니다.', 502) }
  }
  private tokenFields(t: Record<string, unknown>, previous?: Registration) {
    if (typeof t.access_token !== 'string' || !t.access_token || typeof t.refresh_token !== 'string' || !t.refresh_token || String(t.token_type).toLowerCase() !== 'bearer' || typeof t.expires_in !== 'number' || !Number.isFinite(t.expires_in) || t.expires_in <= 0) throw fail('CHATGPT_TOKEN_EXCHANGE_FAILED', 'ChatGPT 연결 응답이 올바르지 않습니다.', 502)
    const scopes = typeof t.scope === 'string' ? t.scope.split(/\s+/).filter(Boolean) : previous?.scopes
    if (!scopes) throw fail('CHATGPT_TOKEN_EXCHANGE_FAILED', 'ChatGPT 사용 권한을 확인하지 못했습니다.', 502)
    const earliest = typeof t.earliest_refresh_at === 'number' ? t.earliest_refresh_at * 1000 : typeof t.earliest_refresh_at === 'string' ? Date.parse(t.earliest_refresh_at) : 0
    return { accessToken: t.access_token, refreshToken: t.refresh_token, scopes, expiresAt: this.now() + t.expires_in * 1000, earliestRefreshAt: Number.isFinite(earliest) ? earliest : 0, requiresReauthorization: false }
  }
  private async complete(p: Pending, url: URL): Promise<void> {
    if (url.searchParams.has('error')) throw fail('CHATGPT_SIGNIN_DENIED', 'ChatGPT 연결이 승인되지 않았습니다.')
    const codes = url.searchParams.getAll('code'), ids = url.searchParams.getAll('client_id')
    const clientId = ids[0] ?? p.selected?.clientId
    if (codes.length !== 1 || !codes[0] || ids.length > 1 || !clientId?.startsWith('oaiapp_') || (p.selected && clientId !== p.selected.clientId)) throw fail('CHATGPT_REGISTRATION_INVALID', 'ChatGPT 앱 등록을 확인하지 못했습니다.')
    const t = await this.token({ grant_type: 'authorization_code', client_id: clientId, code: codes[0], code_verifier: p.verifier, redirect_uri: p.redirect, resource: RESOURCE })
    if (typeof t.id_token !== 'string') throw fail('CHATGPT_ID_TOKEN_INVALID', 'ChatGPT 계정 인증을 검증하지 못했습니다.')
    const identity = await this.verify(t.id_token, clientId, p.nonce)
    if (p.selected && identity.sub !== p.selected.subject) throw fail('CHATGPT_ACCOUNT_MISMATCH', '선택한 ChatGPT 계정과 로그인한 계정이 다릅니다.')
    const fields = this.tokenFields(t)
    await this.locked(async s => {
      if (p.generation !== this.generation) throw fail('CHATGPT_SIGNIN_CANCELLED', 'ChatGPT 연결 요청이 취소됐습니다.')
      if (s.registrations[clientId] && s.registrations[clientId].subject !== identity.sub) throw fail('CHATGPT_ACCOUNT_MISMATCH', 'ChatGPT 앱 등록과 계정 정보가 일치하지 않습니다.')
      s.registrations[clientId] = { clientId, issuer: ISSUER, subject: identity.sub!, email: typeof identity.email === 'string' ? identity.email : undefined, name: typeof identity.name === 'string' ? identity.name : undefined, picture: typeof identity.picture === 'string' ? identity.picture : undefined, idToken: t.id_token as string, ...fields }
      s.activeId = clientId
      await this.save(s)
    })
    this.lastError = undefined; this.audit('signin_completed')
  }
  async getAccessToken(): Promise<string> {
    this.requireLocal()
    this.refreshFlight ??= this.locked(async s => {
      const r = s.activeId ? s.registrations[s.activeId] : undefined
      if (!r?.accessToken || r.requiresReauthorization) throw fail('CHATGPT_SIGNIN_REQUIRED', 'ChatGPT 연결이 필요합니다.')
      if (!r.scopes.includes(DIRECT)) throw fail('CHATGPT_PLAN_PERMISSION_REQUIRED', 'Agent Deck에서 ChatGPT 플랜 사용을 허용해주세요.')
      if (r.expiresAt > this.now() + 60_000 || (r.earliestRefreshAt > this.now() && r.expiresAt > this.now())) return r.accessToken
      if (r.earliestRefreshAt > this.now()) throw fail('CHATGPT_SESSION_REFRESH_PENDING', 'ChatGPT 연결 갱신을 잠시 후 다시 시도해주세요.', 503)
      if (!r.refreshToken) throw fail('CHATGPT_SESSION_EXPIRED', 'ChatGPT에 다시 연결해주세요.')
      try {
        const t = await this.token({ grant_type: 'refresh_token', client_id: r.clientId, refresh_token: r.refreshToken, resource: RESOURCE })
        if (typeof t.id_token === 'string') { const id = await this.verify(t.id_token, r.clientId); if (id.sub !== r.subject) throw fail('CHATGPT_ACCOUNT_MISMATCH', 'ChatGPT 계정 정보가 일치하지 않습니다.'); r.idToken = t.id_token }
        Object.assign(r, this.tokenFields(t, r)); await this.save(s); this.audit('session_refreshed'); return r.accessToken!
      } catch (e) { if (e instanceof ChatGPTAuthError && e.code === 'CHATGPT_SESSION_EXPIRED') { r.requiresReauthorization = true; await this.save(s) } this.audit('refresh_failed', e instanceof ChatGPTAuthError ? e.code : 'CHATGPT_REFRESH_FAILED'); throw e }
    }).finally(() => { this.refreshFlight = undefined })
    return this.refreshFlight
  }
  async disconnect(): Promise<{ remoteRevoked: boolean; message?: string }> {
    this.requireLocal(); await this.cancelSignIn()
    return this.locked(async s => { const r = s.activeId ? s.registrations[s.activeId] : undefined; let remoteRevoked = !r?.refreshToken
      if (r?.refreshToken) { try { const c = await this.configuration(); if (c.revocation_endpoint) { const res = await this.fetcher(c.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: r.refreshToken, token_type_hint: 'refresh_token', client_id: r.clientId }), signal: AbortSignal.timeout(10_000), redirect: 'error' }); remoteRevoked = res.status === 200 } } catch {} }
      if (r) { delete r.accessToken; delete r.refreshToken; delete r.idToken; r.scopes = []; r.expiresAt = 0; r.requiresReauthorization = false; await this.save(s) }
      this.lastError = undefined; this.audit('signed_out', remoteRevoked ? undefined : 'REMOTE_REVOCATION_UNCONFIRMED')
      return { remoteRevoked, message: remoteRevoked ? undefined : '이 컴퓨터의 연결은 해제됐습니다. 원격 연결 해제는 확인하지 못했으니 ChatGPT Settings에서도 연결을 해제할 수 있습니다.' }
    })
  }
}
export const chatgptAuthService = new ChatGPTAuthService({ audit: event => console.info('[chatgpt-auth]', JSON.stringify(event)) })
