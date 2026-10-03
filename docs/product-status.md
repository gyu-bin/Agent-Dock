# Agent Deck — Product Status

Last updated: 2026-10-03 (Cloud Runtime Phase 1 implementation; live deployment verification pending)

## Summary

| Area | Status |
|------|--------|
| Project Control Center | **READY** |
| Work Composer + Attachments | **READY** |
| Canonical Task Planner | **READY** (Preview SoT unified) |
| Goals / Routines / Scheduler | **READY** (config: cron triggers) |
| Marketing + Buffer Queue | **CONFIG REQUIRED** (`BUFFER_API_KEY`) |
| ChatGPT Plan / Real AI | **LOCAL VERIFIED** — user OAuth and one live Responses request passed |
| OpenAI API | **OPTIONAL / CONFIG REQUIRED** — explicit mode, separate API billing |
| Codex | **CONFIG REQUIRED** (`CODEX_BIN` / login) |
| Image Generation | **CONFIG REQUIRED** (OpenAI Image) |
| Media Delivery (R2/S3) | **CONFIG REQUIRED** |
| Threads Direct Connector | **CONFIG REQUIRED** (OAuth apps) |
| Active pixel office | Reception removed; lounge/terrace/garden connected; map and browser checked |
| SNS direct account connection | **CONFIG REQUIRED / LOCAL** — Threads existing; four new OAuth flows fixture-tested, real app login pending; publishing unavailable for new four |
| Cloud Agent Registry | **LIVE VERIFIED** — Production bundled REAL, 279 executable, no instruction errors |
| Cloud GitHub Workspace | **PUBLIC DEPLOYMENT VERIFIED** — GitHub create/provision/HEAD/verify + Supabase results, ownership and CAS/leases |
| Vercel Sandbox | **PUBLIC DEPLOYMENT VERIFIED** — install/typecheck/build passed; tests skipped (no script), private clone pending |
| Cloud Codex | **NOT CONFIGURED / NEXT PHASE** — local CLI credentials are not transferred |
| Cloud ChatGPT Plan | **UNAVAILABLE / NEXT PHASE** — local OAuth remains local-only |
| Local Runtime | **SUPPORTED** |
| Cloud Runtime Phase 1 | **NOT READY** — private repository evidence and deployed cold-start reconnect pending |

## READY

- Home (Office visual) + Project Control Center primary work surface
- Project-scoped Team / Tasks / Artifacts / Knowledge / Operations / Tools / Settings
- Work Composer: Text / Image / File / Folder / GitHub / Web URL
- Preview → Commit via `planTask` + `planFingerprint`
- Safety Pipeline (plan / change approval) — no parallel approval system
- Usage / Budget project summary
- Distribution preference: Manual | Buffer

## CONFIG REQUIRED

- Local ChatGPT login + plan permission — default Real AI
- `OPENAI_API_KEY` — explicitly selected API mode and image generation
- Codex CLI path / auth
- Web search provider keys (if enabled in Settings)
- `BUFFER_API_KEY` — Buffer distribution
- Media Delivery S3/R2 credentials for production image publish
- Threads OAuth app for direct Threads publish (optional; Buffer preferred)

## FUTURE-FROZEN

- Additional Office V2 asset/map expansions
- Direct Instagram / X / YouTube / Reddit publishing and cloud OAuth; TikTok connector
- Buffer Analytics full implementation
- Vertical Video Tool
- Shared package migration of `client/src/domain/taskPlanning` (server already dynamic-imports client planner; freeze until dogfood forces it)

## Dogfood entry

1. Open Home → pick / create Project  
2. Enter **Project Control Center**  
3. Ask in 「무엇을 시킬까요?」  
4. Attach references as needed  
5. Approve only when Safety asks  

Authorized exception to architecture freeze: Cloud Runtime Phase 1 foundation only. See [implementation and verification report](cloud-runtime-phase1.md). Phase 2 remains blocked until Phase 1 passes.

## ChatGPT integration evidence

OAuth A–D and provider E–J use synthetic tokens/streams. Typecheck/build and attachment/planning/usage/settings regressions passed. User completed actual account login, and one live plan inference succeeded (21 input / 12 output tokens). Original market-analysis workflow and live vision/file/search capabilities remain unverified; the one-request limit was respected. See [implementation report](chatgpt-plan-integration.md).

## Work UI and office activity

Advanced tasks layout repaired and redesigned; Home live work summary added; idle agents roam the connected lounge/garden with assignment precedence and reduced-motion support. See [verification and SNS setup](work-ui-and-social-connections.md).

## Cloud Runtime Phase 1

Bundled registry and project persistence/ownership fixtures pass locally. Both service-only Supabase migrations and real SQL lease/CAS checks passed; Production health confirms Sandbox configuration. Workspace creation and verification do not require AI provider authentication. Authenticated deployed workspace/restart smoke and private clone must be recorded before changing this phase to READY. Existing Office, character, Marketing, SNS and OAuth behavior are outside this phase.
