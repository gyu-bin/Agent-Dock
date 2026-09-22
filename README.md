# Agent Deck

AI Studio Control Center — organize AI agents like a company, visualize work in a 2D Office, and (later) run tasks via GPT / Codex.

> Design reference: `references/agent-deck-ui-reference.png`

## Phase 1/2 (this branch of work)

- Desktop layout: Sidebar · Top Bar · **2D Office (hero)** · AI Chat (mock) · Bottom status
- Domain models: Agent, Project, Task, Department, Team presets
- Zustand store + seed data
- Local Node server with Agent Registry (reads `~/.codex/agents/*.toml`, falls back to mock)
- AI provider is **Mock Mode** only — no API keys, no fake “Connected” state

## Stack

- Client: React + Vite + TypeScript + Zustand + Lucide
- Server: Express + TOML parser
- Office: DOM / CSS / SVG (PixiJS-ready separation)

## Setup

```bash
npm install
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:8787  

Optional: `AGENT_DECK_AGENTS_DIR=/path/to/agents` to override the Codex agents directory.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Client + server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |

## Agent divisions

Division comes from the **agency-agents directory layout** (not heuristics):

1. Prefer live scan of `~/Desktop/Coding/agency-agents` (override with `AGENT_DECK_AGENCY_DIR`)
2. Fall back to committed `shared/agencyDivisionMap.json`

Regenerate the committed map:

```bash
npm run generate:divisions
```

Codex agent slug = `slugify(frontmatter name)` from the source `.md` file; folder name = division.

Example: `product/product-trend-researcher.md` → `trend-researcher` → **product**.

## Notes

- Does **not** modify `agency-agents` or other external repos.
- Phase 2/2 will connect chat, project creation, and task pipeline without rewriting Office/layout shells.
