# Agent Deck Office v2 — Map Specification

> **Status:** Spec draft only. No production code, assets, or OfficeScene changes in this phase.  
> **Canonical data:** [`office-map-layout.json`](./office-map-layout.json)  
> **Types draft:** [`office-map-types.ts`](./office-map-types.ts)

---

## 0. Goal

Deliver a **playable 2D / 2.5D office map** that Codex (or any implementer) can build against without inventing layout.

The map must support:

- Character movement on a waypoint graph
- sprite-gen animations
- Furniture collision (AABB)
- Agent runtime status → placement
- Depth / z ordering
- Renderer independence (DOM today, Pixi later)

This is **not** concept art. It is a game map domain document.

---

## 1. Camera & Perspective

| Rule | Decision |
|------|----------|
| Projection | **2D top-down + light 2.5D depth** (sprites face camera slightly) |
| Camera | **Fixed**, fit-contain to viewport |
| Floors | Single floor — **no stairs, no multi-storey** |
| Perspective | Furniture and characters share the **same** art perspective |
| Forbidden | Full isometric 3D, vanishing-point rooms, CSS `%` position as SoT |

Screen size (1440 / 1920) must **not** redefine map coordinates. The renderer scales the 1600×1000 logical map to fit.

---

## 2. Coordinate System

```
Origin: top-left
+x → right
+y → down
Units: logical (not CSS px, not %)

Map size: 1600 × 1000
Outer wall inset: 20u
Usable floor ≈ 1560 × 960
```

### Why logical units

- Zoom / pan can be added later without rewriting placements
- Collision and pathfinding stay deterministic
- DOM and Pixi both consume the same numbers

### Mapping to screen (renderer concern)

```
scale = min(viewW / map.width, viewH / map.height)
screenX = offsetX + logicalX * scale
screenY = offsetY + logicalY * scale
```

---

## 3. Floor Plan Overview

```
┌──────────────────────────────────────────────────────────────┐
│  PRODUCT     DESIGN      DEVELOPMENT (+GameDev)   RESEARCH   │  y 40–320
│────────────────────── MAIN HALLWAY (north) ──────────────────│  y 320–380
│                         ☕ LOUNGE                             │  y 380–620
│────────────────────── MAIN HALLWAY (south) ──────────────────│  y 620–680
│  MARKETING    MEETING      QA/TESTING         RECEPTION      │  y 680–960
└──────────────────────────────────────────────────────────────┘
```

**Excluded from this map:** Garden (future separate scene).

**Engineering:** maps into **Development** workstation pool (no separate room).  
**Game Development:** **sub-zone** on the east side of Development.

---

## 4. Zones (rectangles)

| Zone ID | Kind | Bounds (x,y,w,h) | Floor |
|---------|------|------------------|-------|
| `product` | department | 20, 40, 370, 280 | office-neutral |
| `design` | department | 400, 40, 370, 280 | office-neutral |
| `development` | department | 780, 40, 420, 280 | office-neutral |
| `game-development` | subzone ⊂ development | 990, 50, 200, 250 | office-neutral |
| `research` | department | 1210, 40, 370, 280 | office-neutral |
| `hall-north` | hallway | 20, 320, 1560, 60 | office-neutral |
| `lounge` | lounge | 80, 380, 1440, 240 | lounge |
| `hall-south` | hallway | 20, 620, 1560, 60 | office-neutral |
| `hall-center` | hallway | 720, 300, 160, 400 | office-neutral |
| `marketing` | department | 20, 680, 340, 280 | office-neutral |
| `meeting` | meeting | 380, 680, 360, 280 | meeting |
| `testing` | department | 760, 680, 360, 280 | office-neutral |
| `reception` | reception | 1140, 680, 440, 280 | reception |

### Logical non-overlap check

- Top band rooms share y-range but are separated by ~10–15u wall strips (see collisions).
- Lounge sits strictly between hall-north and hall-south.
- Bottom rooms share y-range; walls at x≈355 / 735 / 1115.
- `hall-center` overlaps lounge vertically by design (junction corridor through social hub).

---

## 5. Lounge (Social Hub)

Lounge is the default home for **idle / waiting** agents.

### Furniture (anchors)

| ID | Asset | (x, y) |
|----|-------|--------|
| lounge.sofa.1 | sofa | 420, 480 |
| lounge.sofa.2 | sofa | 620, 480 |
| lounge.armchair.1 | armchair | 300, 540 |
| lounge.armchair.2 | armchair | 760, 540 |
| lounge.coffee-table.1 | coffee-table | 520, 540 |
| lounge.coffee-machine.1 | coffee-machine | 980, 430 |
| lounge.bookshelf.1 | bookshelf | 180, 430 |
| lounge.plant.1 / .2 | plant-large / medium | 1400,450 / 200,580 |
| lounge.lamp.1 | lamp | 860, 430 |

### Waypoints (capacity ≥ 16 agents without single-file stacking)

Sit: `lounge.sofa.1–4`, `lounge.armchair.1–2`  
Stand / social: `lounge.stand.1–9`, `lounge.coffee.1–2`, `lounge.bookshelf.1`, `lounge.talk.1–2`  
Exits: `lounge.exit.north` (800,390), `lounge.exit.south` (800,610)

Assignment rule: hash(`agentId`) % free waypoints in pool → stable scatter.

---

## 6. Workstations

Agents **never** path to the desk sprite origin. They path to the **interaction waypoint** (`*.desk.N`).

| Zone | Workstation count | IDs |
|------|-------------------|-----|
| Product | 4 | product.ws.1–4 |
| Design | 5 | design.ws.1–5 |
| Development | 4 | development.ws.1–4 |
| Game Development | 4 | gamedev.ws.1–4 |
| Research | 4 | research.ws.1–4 |
| Marketing | 4 | marketing.ws.1–4 |
| Testing | 5 | testing.ws.1–5 |

Each workstation:

```
desk furniture
+ chair (may share desk asset for v1)
+ interactionWaypointId  ← character stands/sits here
+ optional talkWaypointId ← handoff Option A
```

**Engineering** agents claim Development slots first; overflow uses GameDev talk points or Lounge if team > desk count.

---

## 7. Meeting Room

| Element | ID / notes |
|---------|------------|
| Table | meeting.table.1 @ (560, 820) |
| Whiteboard | meeting.whiteboard.1 @ (560, 720) |
| Seats | meeting.seat.1–8 around table |
| Entry | meeting.entry @ (560, 700) |

Used by: `reviewing`, optional handoff Option B, overflow verify.

---

## 8. Reception

Small footprint:

- `reception.desk.1`
- `reception.wait.1–2`
- `reception.spawn` (offline / enter)
- `reception.entry`

---

## 9. Walkable Areas

Explicit walkable rectangles (see JSON `walkable[]`):

1. Top band interior  
2. Hall north  
3. Lounge interior  
4. Hall south  
5. Bottom band interior  
6. Hall center junction  

Characters **do not** free-roam. Pathfinding uses the **waypoint graph**. Walkable + collisions exist for:

- future navmesh upgrade
- validating that waypoints sit inside walkable regions
- rejecting illegal spawn positions

### Blocked objects

Walls, desks, sofas, bookshelves, meeting table, reception desk, large plants, server racks.

Glass doorway strips are marked `reason: "glass"` — visually open, optionally soft-block for free-move; **graph edges still pass through room entries**.

---

## 10. Navigation Graph

Hub:

```
lounge.exit.north ─┬─ hall.north.mid ─┬─ product.entry → desk.*
                   │                  ├─ design.entry → desk.*
                   │                  ├─ development.entry → desk.* / gamedev.*
                   │                  └─ research.entry → desk.*
hall.center ───────┤
                   │
lounge.exit.south ─┴─ hall.south.mid ─┬─ marketing.entry → desk.*
                                      ├─ meeting.entry → seat.*
                                      ├─ testing.entry → desk.*
                                      └─ reception.entry → wait/desk/spawn
```

### Path algorithm (v1)

1. Dijkstra / A* on undirected waypoint edges  
2. Cost = Euclidean distance (override with `edge.cost` if set)  
3. Character walks edge polyline; animation = `walking` + facing from Δx/Δy  

No navmesh required for v1.

---

## 11. Character Movement Model

### States

`idle | walking | working | talking | sitting | reviewing | blocked`

### Directions

`up | down | left | right`  
Facing derived from movement delta; at rest use waypoint `face`.

### Lifecycle example

```
Lounge idle
 → task assigned
 → walk hall → development.entry → development.desk.N
 → work
 → handoff (talk at desk OR meeting seats)
 → work / review
 → complete
 → walk → lounge.*
 → idle
```

---

## 12. Depth / Z Ordering

Static layers:

| Layer | Content |
|------|---------|
| 0 | Floor tiles |
| 1 | Floor decoration (rugs) |
| 2 | Furniture back (bookshelves, whiteboard) |
| 3 | Characters — **dynamic sort by `y`** |
| 4 | Furniture front (desk tops, sofa arms if needed) |
| 5 | Wall foreground / glass overlays |
| 6 | Speech bubbles |

Rule: when character `y` is behind a desk collision bottom edge, character draws under `furniture-front` of that desk.

---

## 13. Runtime Mapping

| Agent status | Zone | Animation |
|--------------|------|-----------|
| idle | lounge waypoint pool | idle / sit |
| waiting | lounge | idle / sit |
| working | division → workstation | working |
| blocked | same workstation + blocked indicator | blocked |
| reviewing | meeting.seat.* | reviewing / sit |
| verifying | testing desks (fallback meeting) | working |
| offline | reception.spawn or hidden | idle |

Division → zone table: see `divisionToZone` in layout JSON.

### Capacity

- Render **project team only** (not full 279 registry)
- Recommended 5–15 on floor
- Hard cap ~30; overflow stays in registry UI only

---

## 14. Handoff

| Option | Behavior |
|--------|----------|
| **A** | Agent A walks to B’s `talkWaypointId` beside workstation |
| **B** | Both walk to `meeting.seat.*` |

Selection is a **workflow policy** (not map data). Map only guarantees both destination sets exist.

---

## 15. Speech Bubbles

Show only on meaningful events: task start, handoff, blocked, review, complete.  
Short Korean copy. Layer 6. Never permanent.

---

## 16. Renderer Independence

Recommended modules (future production — not written now):

```
officeMap.ts          // load OfficeMap JSON
officeNavigation.ts   // graph pathfinding
officeRuntimeMapper.ts // Agent status → PlacementIntent
        ↓
Renderer (DOM / Pixi)
```

Map JSON must not contain CSS classes, React components, or Pixi display objects.

---

## 17. Coordinate validation notes

Manual checks performed on draft:

- Desk interaction waypoints sit **south of** desk collision (work face-up into monitor)
- Lounge sit points fall on sofa/armchair footprints, not hall strips
- Zone entry points sit on hallway–room borders
- No two workstation interaction points share identical (x,y)
- Hallway waypoints form a continuous east–west chain

Known soft conflicts (acceptable in v1):

- `hall-center` overlaps lounge bounds (intentional junction)
- Door glass rects overlap entry waypoints slightly (visual only)

---

## 18. Implementation phases (for later)

1. Promote types + load layout JSON (no art)
2. Draw debug rectangles / waypoints
3. Drop furniture placeholders
4. Wire runtime mapper + teleport (no walk)
5. Pathfinding walk + facing
6. sprite-gen characters + depth sort
7. Speech / blocked indicators
8. Pixi migration (optional)

---

## Related docs

- [`asset-spec.md`](./asset-spec.md) — furniture & environment
- [`character-sprite-spec.md`](./character-sprite-spec.md) — roles, anims, variation
- [`office-map-layout.json`](./office-map-layout.json) — numeric SoT
