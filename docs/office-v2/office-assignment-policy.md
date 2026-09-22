# Office V2 — Destination Assignment Policy

Canonical runtime destination rules. Implementation:
`client/src/office/v2/officeAssignmentPolicy.ts`

Desk capacity helper (unchanged role): `workstationPolicy.ts`

**Not wired into OfficeScene yet.**

## Status → destination

| Status | destinationType | Slot pool |
|--------|-----------------|-----------|
| idle | lounge | `lounge.*` sit/stand/talk (20) |
| waiting | lounge | same |
| working | workstation | department desk via visual role → group |
| blocked | workstation | same |
| reviewing | meeting | `meeting.seat.1–8` |
| verifying | testing | `testing.desk.1–5` |
| offline | reception \| hidden | `reception.spawn` or no waypoint |

## Capacity / overflow

| Destination | Capacity | Overflow |
|-------------|----------|----------|
| lounge | 20 waypoints | `overflow=true`, no extra furniture |
| workstation | 30 desks (by group) | same |
| meeting | 8 seats | same |
| testing | 5 desks | same |
| reception | shared spawn | always assigned to spawn |
| hidden | — | no waypoint |

Never spawn dynamic furniture when capacity is exceeded.

## Determinism

Same agent set + statuses + options → same assignments.

- Pool slots: preferred index = `visualVariationSeed(agentId) % poolSize`, then walk free slots; claimants ordered by `agentId`.
- Desks: priority `working` → `blocked`, then `agentId`; sequential fill within group.
- Output sorted by `agentId` so React re-renders do not reshuffle.

## Workstation groups

Reuse `workstationGroupForAgent` / `WORKSTATION_CAPACITY` / `workstationWaypointId`.
UI/Engineering divisions map into Development; game-developers use `game-development`.
