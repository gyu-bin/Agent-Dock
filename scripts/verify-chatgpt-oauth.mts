import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, rm, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { ChatGPTAuthService, ChatGPTAuthError } from '../server/src/chatgpt/chatgptAuthService.js'

const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-deck-oauth-'))
const keys = await generateKeyPair('RS256'), otherKeys = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' }
let now = Date.now(), nonce = '', bad: string | undefined, direct = true, refreshCount = 0, posted: URLSearchParams[] = [], tokenFailure: string | undefined
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input)
  if (url.endsWith('openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke' })
  if (url.endsWith('/jwks')) return Response.json({ keys: [jwk] })
  if (url.endsWith('/revoke')) return new Response(null, { status: 200 })
  const p = new URLSearchParams(String(init?.body)); posted.push(p)
  if (p.get('grant_type') === 'refresh_token') {
    if (tokenFailure === 'network') throw Error('synthetic network failure')
    if (tokenFailure === 'revoked') return Response.json({ error: 'invalid_grant' }, { status: 400 })
    refreshCount++; assert.equal(p.get('refresh_token'), `refresh-${refreshCount}`); assert.equal(p.has('scope'), false)
    return Response.json({ access_token: `access-${refreshCount + 1}`, refresh_token: `refresh-${refreshCount + 1}`, token_type: 'Bearer', expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct' })
  }
  assert.equal(p.get('client_id'), 'oaiapp_fixture'); assert.equal(p.get('resource'), 'https://api.openai.com/v1')
  assert.ok(p.get('code_verifier'))
  const idToken = await new SignJWT({ sub: bad === 'subject' ? 'other' : 'subject', nonce: bad === 'nonce' ? 'invalid' : nonce, email: 'fixture@example.test', name: 'Fixture' }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setIssuer(bad === 'issuer' ? 'https://attacker.invalid' : 'https://auth.openai.com').setAudience(bad === 'audience' ? 'wrong' : 'oaiapp_fixture').setIssuedAt(Math.floor(now / 1000)).setExpirationTime(Math.floor(now / 1000) + (bad === 'expired' ? -1 : 3600)).sign(bad === 'signature' ? otherKeys.privateKey : keys.privateKey)
  return Response.json({ id_token: idToken, access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 3600, scope: direct ? 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' : 'openid profile email' })
}
const service = new ChatGPTAuthService({ dir, fetch: fetcher, now: () => now, supported: true })
async function start(newAccount = false) { const flow = await service.startSignIn({ newAccount }); const u = new URL(flow.authorizationUrl); nonce = u.searchParams.get('nonce')!; return u }
async function callback(u: URL, extra: Record<string, string> = {}) { const callback = new URL(u.searchParams.get('redirect_uri')!); callback.search = new URLSearchParams({ state: u.searchParams.get('state')!, code: 'fixture', client_id: 'oaiapp_fixture', ...extra }).toString(); return fetch(callback) }
try {
  const first = await start(); assert.equal(first.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(first.searchParams.get('agent_name_hint'), 'Agent Deck'); assert.ok(first.searchParams.get('ext_agent_host_id')?.startsWith('urn:uuid:')); assert.equal(new URL(first.searchParams.get('redirect_uri')!).hostname, '127.0.0.1')
  assert.equal((await callback(first, { state: 'bad' })).status, 400); assert.equal(posted.length, 0)
  assert.equal((await callback(first)).status, 200); assert.equal((await service.getStatus()).planUsageEnabled, true)
  const saved = JSON.parse(await readFile(path.join(dir, 'connections.json'), 'utf8')); assert.equal(saved.activeId, 'oaiapp_fixture'); assert.equal((await stat(path.join(dir, 'connections.json'))).mode & 0o777, 0o600); assert.equal((await stat(dir)).mode & 0o777, 0o700)
  const returning = await start(); assert.equal(returning.searchParams.get('client_id'), 'oaiapp_fixture'); assert.equal(returning.searchParams.has('agent_name_hint'), false); assert.equal(returning.searchParams.get('ext_agent_host_id'), first.searchParams.get('ext_agent_host_id')); assert.ok(returning.searchParams.get('id_token_hint'))
  assert.equal((await callback(returning, { client_id: 'oaiapp_wrong' })).status, 400); assert.equal((await service.getStatus()).signedIn, true)
  for (bad of ['nonce', 'issuer', 'audience', 'expired', 'signature', 'subject']) { const u = await start(); assert.equal((await callback(u)).status, 400); assert.equal((await service.getStatus()).account?.subject, 'subject') }
  bad = undefined; direct = false; assert.equal((await callback(await start())).status, 200); const status = await service.getStatus(); assert.equal(status.signedIn, true); assert.equal(status.planUsageEnabled, false); assert.equal(JSON.stringify(status).includes('access-1'), false)
  await assert.rejects(service.getAccessToken(), (e: unknown) => e instanceof ChatGPTAuthError && e.code === 'CHATGPT_PLAN_PERMISSION_REQUIRED')
  direct = true; assert.equal((await callback(await start())).status, 200); now += 3_601_000
  assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => service.getAccessToken())), Array(8).fill('access-2')); assert.equal(refreshCount, 1)
  // Another server instance reloads the rotated token rather than using an old in-memory token.
  const second = new ChatGPTAuthService({ dir, fetch: fetcher, now: () => now, supported: true }); now += 3_601_000; assert.equal(await second.getAccessToken(), 'access-3'); assert.equal(refreshCount, 2)
  now += 3_601_000; tokenFailure = 'network'
  const beforeFailure = await readFile(path.join(dir, 'connections.json'), 'utf8')
  await assert.rejects(service.getAccessToken(), (e: unknown) => e instanceof ChatGPTAuthError && e.code === 'CHATGPT_NETWORK_ERROR')
  assert.equal(await readFile(path.join(dir, 'connections.json'), 'utf8'), beforeFailure)
  tokenFailure = 'revoked'
  await assert.rejects(service.getAccessToken(), (e: unknown) => e instanceof ChatGPTAuthError && e.code === 'CHATGPT_SESSION_EXPIRED')
  assert.equal((await service.getStatus()).signedIn, false)
  const expiredState = JSON.parse(await readFile(path.join(dir, 'connections.json'), 'utf8')); assert.equal(expiredState.registrations.oaiapp_fixture.refreshToken, 'refresh-3')
  tokenFailure = undefined
  assert.equal((await callback(await start())).status, 200)
  assert.equal((await service.disconnect()).remoteRevoked, true); assert.equal((await service.getStatus()).signedIn, false); assert.equal((await start()).searchParams.get('client_id'), 'oaiapp_fixture'); await service.cancelSignIn()
  const cloud = new ChatGPTAuthService({ supported: false }); assert.equal((await cloud.getStatus()).supported, false); await assert.rejects(cloud.startSignIn(), (e: unknown) => e instanceof ChatGPTAuthError && e.code === 'CHATGPT_LOCAL_ONLY')
  const previousCloud = process.env.AGENT_DECK_CLOUD; process.env.AGENT_DECK_CLOUD = '1'
  try { assert.equal((await new ChatGPTAuthService({ dir }).getStatus()).supported, false) } finally { if (previousCloud === undefined) delete process.env.AGENT_DECK_CLOUD; else process.env.AGENT_DECK_CLOUD = previousCloud }
  await mkdir(path.join(dir, '.session-lock')); await writeFile(path.join(dir, '.session-lock', 'owner'), '2147483647')
  await start(); await service.cancelSignIn()
  const cancelled = service.startSignIn(); await service.cancelSignIn()
  await assert.rejects(cancelled, (e: unknown) => e instanceof ChatGPTAuthError && e.code === 'CHATGPT_SIGNIN_CANCELLED')
  const concurrent = service.startSignIn()
  await assert.rejects(service.startSignIn(), (e: unknown) => e instanceof ChatGPTAuthError && e.code === 'CHATGPT_SESSION_BUSY')
  await concurrent; await service.cancelSignIn()
  console.log('PASS OAuth A-D: registration, returning login, scope permission, refresh rotation; state, nonce, issuer/audience, signature, expiry, account mismatch, storage permissions, cloud guard, revocation')
} finally { await service.cancelSignIn(); await rm(dir, { recursive: true, force: true }) }
