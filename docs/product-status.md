# Agent Deck — Product Status

Last updated: 2026-09-23 (Project-first Consolidation)

## Summary

| Area | Status |
|------|--------|
| Project Control Center | **READY** |
| Work Composer + Attachments | **READY** |
| Canonical Task Planner | **READY** (Preview SoT unified) |
| Goals / Routines / Scheduler | **READY** (config: cron triggers) |
| Marketing + Buffer Queue | **CONFIG REQUIRED** (`BUFFER_API_KEY`) |
| OpenAI / Real AI | **CONFIG REQUIRED** (`OPENAI_API_KEY`) |
| Codex | **CONFIG REQUIRED** (`CODEX_BIN` / login) |
| Image Generation | **CONFIG REQUIRED** (OpenAI Image) |
| Media Delivery (R2/S3) | **CONFIG REQUIRED** |
| Threads Direct Connector | **CONFIG REQUIRED** (OAuth apps) |
| Office V2 polish | **FUTURE-FROZEN** |
| SNS Direct Instagram/YouTube | **FUTURE-FROZEN** |
| New Foundations | **FROZEN** — dogfood only |

## READY

- Home (Office visual) + Project Control Center primary work surface
- Project-scoped Team / Tasks / Artifacts / Knowledge / Operations / Tools / Settings
- Work Composer: Text / Image / File / Folder / GitHub / Web URL
- Preview → Commit via `planTask` + `planFingerprint`
- Safety Pipeline (plan / change approval) — no parallel approval system
- Usage / Budget project summary
- Distribution preference: Manual | Buffer

## CONFIG REQUIRED

- `OPENAI_API_KEY` — Real AI Mode
- Codex CLI path / auth
- Web search provider keys (if enabled in Settings)
- `BUFFER_API_KEY` — Buffer distribution
- Media Delivery S3/R2 credentials for production image publish
- Threads OAuth app for direct Threads publish (optional; Buffer preferred)

## FUTURE-FROZEN

- Office V2 asset/map expansions
- Direct Instagram / YouTube / TikTok connectors
- Buffer Analytics full implementation
- Vertical Video Tool
- Shared package migration of `client/src/domain/taskPlanning` (server already dynamic-imports client planner; freeze until dogfood forces it)

## Dogfood entry

1. Open Home → pick / create Project  
2. Enter **Project Control Center**  
3. Ask in 「무엇을 시킬까요?」  
4. Attach references as needed  
5. Approve only when Safety asks  

Architecture freeze: do not add new Foundations until REAL PROJECT DOGFOOD feedback.
