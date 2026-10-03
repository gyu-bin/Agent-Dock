# Cloud Runtime Phase 1

Updated: 2026-10-03 (Asia/Seoul).

**CLOUD RUNTIME PHASE 1 READY: NO.** Implementation and local fixtures are available. Production health, real public-repository SDK smoke and Supabase SQL checks passed. The authenticated deployed workspace flow and private repository evidence are still pending. An SDK request made from a development machine does not establish that Vercel Functions, Supabase persistence and account ownership work together.

## Scope and architecture

Project Source → Workspace Provider → Runtime.

- Local: existing project path → Local workspace → Local Runtime.
- Cloud: normalized GitHub repository → official Vercel Sandbox SDK → named Sandbox workspace.
- This phase adds foundation verification only. No automatic code edits, commit/push, Cloud Codex authentication, remote ChatGPT OAuth or full Agent workflow migration.
- Office, character assets, Marketing and SNS are unchanged by this phase.

## Audit of previous dependencies

The registry previously resolved explicit path → Settings → environment → `~/.codex/agents`, then returned a display-only mock registry if unavailable. Division discovery also probed the developer's home directory. Vercel included server source but no instruction assets. Local project paths, local Codex CLI/login and shell execution could not supply a cloud workspace.

Project/settings data already used `dataFs.ts` and Supabase `public.fs_files` in Cloud. Project persistence serialized writes only within one Function instance; concurrent instances could overwrite the same snapshot. Workspace metadata had no existing provider, durable Sandbox relationship or distributed lease.

## Implementation and verification matrix

| # | Topic | Implementation / evidence / limit |
|---|---|---|
| 1 | Previous Local-only dependencies | Home registry, division scan, local paths and Codex login audited; Cloud registry no longer probes them. Local execution remains separate. |
| 2 | Bundled agents | 279 TOMLs under `server/assets/agents`; server-only developer instructions; manifest ID/filename/SHA256/version. |
| 3 | Source precedence | Local: explicit → Settings → env → HOME → bundle. Explicit invalid configuration fails closed. Cloud: bundle only; no supported remote source added yet. |
| 4 | Cloud registry | Actual Preview and Production health, fixture and compiled server: bundled / REAL / total 279 / executable 279 / instructionErrors 0. Core research/orchestrator loads pass. |
| 5 | Project source schema | Additive sourceType/repository/owner/workspace fields. Existing Project.path preserved; ownerless records claimable only through single-allowlisted-account API policy. |
| 6 | GitHub credential | Server-only environment provider implements extensible credential interface. `GITHUB_TOKEN` passed separately to SDK; no token-bearing clone URL. |
| 7 | CloudWorkspaceProvider | Lifecycle, structured command execution, files, verification and cleanup interface; no local daemon dependency. |
| 8 | Vercel Sandbox provider | Official `@vercel/sandbox`; named `getOrCreate` and reconnect, Node runtime, canonical repo root. Real public-repository SDK smoke passed; deployed end-to-end smoke pending. |
| 9 | Workspace persistence | Supabase-backed workspace JSON and service-only database lease/fenced save. Both migrations applied to agent-deck Supabase; real lease acquire/fencing/release and project CAS/stale-write rejection passed in rollback transactions. |
| 10 | Repository clone | HTTPS GitHub normalization, repository metadata/default branch lookup, SDK git source, status/HEAD/branch validation, typed failures. Private live clone pending token. |
| 11 | Install/build/test | Detached runner chooses lockfile package manager; npm ci, frozen pnpm, Yarn immutable or classic frozen. Missing lockfile/script is explicitly skipped; failure remains failure. |
| 12 | Serverless restart recovery | Persisted named Sandbox/generation/verification metadata; status GET reconnects and consumes result checkpoint. New service instance reconnect passed using local metadata during real SDK smoke; deployed Supabase-backed recovery pending. |
| 13 | Expired recovery | Expired/not-found status permits reprovision; typed expired state retained. Fixture/live evidence recorded separately. |
| 14 | Concurrency | Workspace DB lease/fencing; project snapshot revision CAS with bounded reload/retry. Independent instance project fixture preserves concurrent creates/updates. |
| 15 | Secrets | SDK credential separated, minimal runner env, redacted output tails; no full instruction/API secret returned. Private live secret scan pending. |
| 16 | Workspace UI | Existing Project Control Center panel: source, branch, revision, status, explicit prepare/verify/terminate; busy status polling. Cloud wizard hides Local source. |
| 17 | Fixtures A–J | Registry A/B pass. Workspace C–J fixture/live results must be recorded below; mocks do not replace real deployment verification. |
| 18 | Typecheck/build | Registry/server/client checks passed during implementation; final integrated checks must be repeated after all changes. |
| 19 | Real Vercel smoke | Authenticated Production create → provision → clone → HEAD → npm ci/typecheck/build passed; test skipped because no script. Supabase persisted ready/passed verified. Deployed cold-start reconnect passed after a fresh Production deployment. Actual SDK public smoke passed: gyu-bin/Agent-Dock, HEAD fad326257e38aa1e69801596cb094fde91a7c3ab; npm ci/typecheck/build passed, test skipped (no script); new service object reconnected; Sandbox cleaned. |
| 20 | Local regression | Existing instruction hardening fixtures pass; Local registry remains filesystem. Client build has no bundled persona/TOML leakage. |
| 21 | Cloud Codex | NOT CONFIGURED. Local Codex path/login are not usable or copied to Cloud. |
| 22 | Cloud ChatGPT Plan | UNAVAILABLE / REQUIRES CLOUD AUTH. Existing local OAuth is unchanged; no API-key fallback introduced. |
| 23 | Remaining blockers | Private GITHUB_TOKEN/repository missing. Existing single-account legacy project ownership migration succeeded. |
| 24 | Phase 1 readiness | NOT READY. Phase 2 cannot start until required live evidence passes. |

## Configuration

Cloud requires Vercel, Supabase Auth/allowlist, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, browser publishable/anon key and the existing `public.fs_files` table. Sandbox uses deployment OIDC or explicit server credentials `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`. Public repositories do not require `GITHUB_TOKEN`; private repositories require a credential with repository read access.

Local mode remains supported. Local Sandbox smoke can use explicit SDK credentials without changing the application's Local project behavior. Never upload local Codex login/session or ChatGPT tokens.

Required additive migrations:

1. `supabase/migrations/20261003110308_workspace_leases.sql`: service-only acquire/save-fenced/release RPCs.
2. `supabase/migrations/20261003111527_cloud_project_snapshot_cas.sql`: service-only canonical projects.json revision compare-and-set.

Existing data remains in `fs_files`. Missing migration/storage causes typed errors; workspace provision never silently uses ephemeral metadata. Project CAS retries only confirmed concurrent revision conflicts, not unknown network failures. Legacy owner claims preserve existing owners and require the API's single-account allowlist policy.

## API and lifecycle

Authenticated owner-only endpoints:

- `POST /api/projects/:projectId/workspace/provision`
- `GET /api/projects/:projectId/workspace`
- `POST /api/projects/:projectId/workspace/verify`
- `DELETE /api/projects/:projectId/workspace`

Metadata includes repository, branch, named Sandbox ID, provider, owner, status, generation, timestamps, revision and expiry when available. States: provisioning, cloning, ready, busy, failed, expired. Request interruption leaves a durable checkpoint for the next status request. Install/build/test runs detached within Sandbox and is not bound to the Function's 60-second HTTP lifetime. Phase 2 durable queues are still out of scope.

Project/Workspace delete cleans Agent Deck metadata and Sandbox/snapshots. GitHub repository, remote branches and commits are never deleted. Workspace destruction has an explicit UI confirmation. Repositories can execute their own package scripts only in Sandbox; host provider credentials are not copied into that process.

## Recorded local evidence

- `npm run validate:agents`: 279 manifest IDs/files/hashes and required personas.
- `node --import tsx scripts/verify-cloud-registry.mts`: HOME without `.codex`; bundle overrides local paths; Local home precedence; explicit invalid path; integrity failure.
- `node --import tsx scripts/check-agent-instructions.mts`: existing typed-error/preflight/persistence regression.
- `node --import tsx scripts/verify-project-cas.mts`: independent instance creates/updates, stale client revision, bounded conflict retries, legacy ownership, scoped work-state recovery, mocked RPC errors.
- `node --import tsx scripts/verify-cloud-client-auth.mts`: actual auth/API source with mocked SDK/network; current bearer session, refresh, Local cookie behavior and missing-session handling.
- `node scripts/verify-agent-client-isolation.mjs`: all 279 persona samples absent from built client; no TOML assets.

The project CAS fixture uses an atomic mock store and mocked HTTP response to test application semantics. It does not prove the migration works in the target database. Target SQL queries passed separately; deployed restart/concurrency smoke remains required.

## Recorded live evidence

- Production `/api/health`: cloud=true, storage=supabase, registry=bundled/REAL/279, instructionErrors=0, workspace provider configured.
- Public Agent-Dock repository with the real Vercel Sandbox SDK: clone and HEAD validation, install, typecheck, build passed; test skipped (no test script). A new WorkspaceService instance reconnected using persisted local metadata. Sandbox cleaned up afterwards.
- Both Supabase migrations applied; real SQL lease acquisition/fencing and stale project CAS rejection passed in rollback transactions. This verifies SQL mechanics without leaving fixture data.
- Actual Production UI exposed a session transport bug: Supabase login/bootstrap passed, but cookie-only API requests were unauthorized. `apiFetch` now reads the current SDK-managed session and adds a bearer header. No extra token cache or credential copy is introduced; Local cookie authentication is preserved. The source-executing mocked fixture checks session refresh and missing-session behavior. Redeployed authenticated workspace smoke must confirm the fix.
- No valid GitHub credential is available for live private-repository verification. Public SDK smoke does not satisfy private access or deployed Supabase recovery gates.

## Live acceptance gate

Record the deployment URL and timestamp, authenticated account, repository/branch, Sandbox identity and HEAD, each install/typecheck/build/test result, safe output tail, Supabase persisted metadata, reconnect after a new instance, expiry/reprovision, duplicate-provision outcome and cleanup. Scan API/log results for synthetic and real credential values without printing the values. A skipped test is acceptable only when the repository has no test script; an actual failed step cannot be relabeled as passed.

Only after these gates pass should product status become READY. Stop at Phase 1; Phase 2 is Async Job Execution + Cloud AI/Codex Authentication.

## Live evidence (2026-10-03)

Production deployment `dpl_DL3V3HD5eWnef2QeBCvCNYaAtQnf` at https://agent-deck-seven.vercel.app reports cloud=true, storage=supabase, workspaceProvider=vercel-sandbox, configured=true, bundled/REAL/279 executable/0 errors. Preview dpl_Ckjeo1xQZsSABSjEEFwXeQfD9Hjo had no Supabase env; Production existing configuration was used with explicit deployment approval. Vercel build emits pre-existing cross-package TypeScript diagnostics despite deployment Ready; independent strict server/client typechecks and production builds pass.

Real SDK testing exposed and fixed two integration errors: native Git clone root is `/vercel/sandbox`, and revision clones use detached HEAD requiring branch initialization only at creation. Deployment OIDC is request-scoped; diagnostics now uses the official OIDC helper instead of checking only process environment.

Production UI smoke: authenticated existing Supabase account created `Cloud Phase 1 검증` (`proj_b5d4253a`), GitHub `gyu-bin/Agent-Dock`, main, named Sandbox `agent-deck-ff15438a4090f792-b2fa62a1`, HEAD `fad326257e38aa1e69801596cb094fde91a7c3ab`. API detached verification completed install/typecheck/build passed, test skipped. Supabase row `workspaces/proj_b5d4253a.json` persisted ready/passed. Screenshot: `/tmp/agent-deck-cloud-workspace-pass.png`. Protected unauthenticated provision request returned HTTP 401.

Authentication runtime fix: successful Supabase bootstrap previously did not carry usable cookie authentication to subsequent API requests. Client API now reads the current SDK-managed Supabase session for each Bearer request; actual Production registry, legacy project loading, project creation and workspace workflow passed. This uses standard Supabase authentication, not ChatGPT cookies or local Codex credentials.

Cold-start deployment evidence: new deployment `dpl_7NdK5Zr9mSpUg1qn8eoMAXuFeU1B` loaded the same named Sandbox and ready/passed results through the authenticated Workspace UI. Supabase lastUsedAt updated to `2026-10-03T11:47:05.001Z`; Sandbox ID remained `agent-deck-ff15438a4090f792-b2fa62a1`. Main implementation commit: `121d512`.

Security advisor: workspace/fs_files RLS without user policies is intentional server-only access; all four RPCs have anon/authenticated execute=false and service_role=true, verified in actual DB. Existing Auth leaked-password protection warning is unrelated to this migration; [Supabase password protection documentation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Remaining acceptance blocker: no GITHUB_TOKEN is configured in Vercel, and no private fixture repository has been supplied. D is mocked credential-boundary evidence only; a private live clone and real credential leak scan are not claimed passed. Phase 2 remains stopped.
