# Office V2 — Workstation Policy (desk helper)

Canonical **destination** policy: [`office-assignment-policy.md`](./office-assignment-policy.md)  
(`client/src/office/v2/officeAssignmentPolicy.ts`).

This file documents the **desk capacity helper** only:
`client/src/office/v2/workstationPolicy.ts` (not wired to OfficeScene).

## Rules

1. **Working / Blocked** → department workstation desks.
2. **Idle / Waiting / Reviewing / Verifying / Offline** → handled by `officeAssignmentPolicy` (lounge / meeting / testing / reception|hidden) — **not** here.
3. Assignment order within desk claimants: `working` → `blocked`, then `agentId` sort.
4. If group capacity exceeded → **overflow flag**; **do not** spawn extra desks.
5. Engineering uses **Development** group (no Engineering room).
6. Game developers use **game-development** sub-group (4 desks).

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
