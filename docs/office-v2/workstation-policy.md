# Office V2 — Workstation Policy

Canonical capacity comes from `docs/office-v2/office-map-layout.json` (30 slots).

Implementation helper: `client/src/office/v2/workstationPolicy.ts` (not wired to OfficeScene).

## Rules

1. **Idle / Waiting** → Lounge waypoints — **no** permanent desk claim.
2. **Working / Blocked** → department workstation (priority).
3. **Reviewing / Verifying** → may claim desk or Meeting/Testing seats (mapper decides zone; policy assigns desk only for desk-claim statuses).
4. Assignment order within claimants: `working` → `blocked` → `reviewing|verifying`, then `agentId` sort.
5. If group capacity exceeded → **overflow flag**; **do not** spawn extra desks.
6. Engineering uses **Development** group (no Engineering room).
7. Game developers use **game-development** sub-group (4 desks).

## Capacities

| Group | Slots |
|-------|------:|
| product | 4 |
| design | 5 |
| development | 4 |
| game-development | 4 |
| research | 4 |
| marketing | 4 |
| testing | 5 |
| **Total** | **30** |

## Waypoint id pattern

`{group}.desk.{n}` with `gamedev.desk.n` for game-development.
