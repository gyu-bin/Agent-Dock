# ChatGPT local OAuth security

This is an OAuth public client for the official OpenAI open-source/local app flow. It does not create an Agent Deck website login session. The user explicitly starts browser authorization; the local server receives the callback at `127.0.0.1` on an available port. Vercel/serverless deployments report this flow as unsupported because that callback cannot reach their runtime.

## Trust boundaries and controls

| Threat | Control |
| --- | --- |
| Login callback forgery/replay | Fresh random state, constant-time comparison, single-use callback, exact host/path/method, five-minute attempt lifetime |
| Stolen authorization code | Fresh S256 PKCE verifier; exact redirect URI retained for exchange |
| Forged or substituted identity | `jose` RS256 signature verification through OpenAI discovery/JWKS; issuer, audience, expiry, issued-at, nonce, subject and authorized-party checks |
| Cross-account token mixing | Issued client ID retained per verified subject; returning login cannot change client ID or subject; active account changes only after complete verification |
| Mistaking login for plan permission | Granted token scopes must contain `chatgpt.tokens.use.direct` before access-token use |
| Token exposure to UI, application artifacts or logs | Protected native local file independent of the generic application/blob store; status exposes profile fields only; authorization URL stays server-side for browser launch |
| Refresh-token rotation races | Shared in-process refresh promise and filesystem session lock across processes; refresh token and access token replaced atomically |
| Network failure deleting a renewable session | Credentials retained on temporary errors; invalid grant requires reauthorization while preserving registration and host identity |
| Signout racing pending login | Signout cancels listener and invalidates the pending generation before clearing tokens |

Credential directory mode is `0700`; atomically replaced files use `0600`. The stable host identifier is a persisted `urn:uuid:` value. Registration mappings survive signout, but access, refresh and retained ID tokens are cleared. Signout attempts the discovered revocation endpoint and reports when remote revocation could not be confirmed.

Audit events contain only event name, timestamp and safe error code. They never contain credentials, profile, authorization URL, code, verifier or callback URL. This protects against network attackers and other OS users, not malicious software already running as the same OS user. A crashed process's session lock is recovered only when its recorded PID is confirmed absent. A missing/corrupt owner or reused PID fails safely as `CHATGPT_SESSION_BUSY` instead of risking duplicate token rotation.

## Verification

`node --import tsx scripts/verify-chatgpt-oauth.mts` uses synthetic RSA keys and mocked OpenAI network responses with a real loopback listener. It checks first registration, saved registration reuse, granted-scope gating, refresh replacement/concurrency, cross-instance refresh, wrong state, nonce, issuer, audience, signature, expiry and subject, owner-only storage, serverless rejection and signout/revocation. It makes no real OAuth or inference request.

The official DevKit was evaluated. Its `@siwc/local` package is an unpublished local workspace requiring an application-supplied OS encryption provider and uses a noncommercial license. This server implements the published OAuth flow using the vetted `jose` JWT library instead of vendoring that workspace or implementing signature cryptography.

Sources: [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference), [official DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit).
