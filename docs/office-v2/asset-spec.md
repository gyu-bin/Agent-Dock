# Agent Deck Office v2 — Asset Specification

> Spec only. No PNG generation in this phase.  
> Aligns with existing catalog ideas in `client/src/office/assets/officeAssetCatalog.ts` but is **not** wired to production.

---

## 1. Global Art Rules

All furniture & environment assets:

| Rule | Value |
|------|--------|
| Format | Transparent PNG |
| Perspective | Shared 2D / light 2.5D (same as characters) |
| Outline | Consistent dark outline weight |
| Lighting | Soft top-left key light |
| Palette | Warm office family (matches product tokens: cream floors, soft wood, navy accents) |
| Anchor | Documented per asset (`anchorX`, `anchorY`) — usually bottom-center |
| Scale | Logical size in map units declared in manifest (not CSS %) |

Characters are specified separately in [`character-sprite-spec.md`](./character-sprite-spec.md).

---

## 2. Furniture Manifest Schema

```json
{
  "id": "desk",
  "src": "furniture/desk.png",
  "category": "desk",
  "width": 90,
  "height": 55,
  "anchorX": 0.5,
  "anchorY": 1.0,
  "collision": { "x": -45, "y": -50, "w": 90, "h": 45 },
  "depthBias": 0,
  "blocksWalk": true,
  "tags": ["workstation"]
}
```

- `collision` is relative to world position `(x, y)` after placing the furniture instance.
- Instance overrides may appear in `office-map-layout.json`.

---

## 3. Required Furniture Assets

### Work

| id | Approx logical size (w×h) | Notes |
|----|---------------------------|-------|
| `desk` | 90×55 | Standard single monitor desk |
| `desk-dual-monitor` | 110×55 | Design / Dev / GameDev |
| `chair` | 36×40 | Meeting + optional desk chairs |
| `monitor` | 28×24 | Optional prop if not baked into desk |
| `laptop` | 22×14 | Optional desktop prop |

### Lounge

| id | Size | Notes |
|----|------|-------|
| `sofa` | 160×50 | 2 sit slots |
| `armchair` | 60×50 | |
| `coffee-table` | 100×45 | |
| `coffee-machine` | 60×45 | |

### Storage / Display

| id | Size | Notes |
|----|------|-------|
| `bookshelf` | 60×55 | Tall; depthBias +10 (behind characters if y smaller) |
| `whiteboard` | 160×40 | Meeting north wall |
| `meeting-table` | 200×90 | Central blocker |
| `reception-desk` | 160×60 | |
| `server-rack` | 50×50 | Dev / QA |
| `storage` | 50×40 | Optional cabinet |
| `lamp` | 30×40 | Non-blocking preferred |

### Plants

| id | Size |
|----|------|
| `plant-small` | 28×32 |
| `plant-medium` | 40×40 |
| `plant-large` | 55×55 |

### Count (unique furniture sprites)

**19 unique furniture IDs** listed above (monitor/laptop optional → **17 required minimum**).

---

## 4. Environment Assets

Tile / repeatable structure:

### Floors

| id | Usage |
|----|--------|
| `floor-office-neutral` | Departments + hallways |
| `floor-lounge` | Lounge (warmer wood / rug base) |
| `floor-meeting` | Meeting room |
| `floor-reception` | Reception |

Optional overlays: `rug`, `rug-pink` (lounge).

### Walls

| id | Usage |
|----|--------|
| `wall-horizontal` | North/south room separators |
| `wall-vertical` | East/west room separators |
| `wall-corner` | Corners |
| `glass-partition` | Soft visual walls |
| `doorway` | Door opening graphic |

### Count (environment)

**4 floors + 5 wall pieces = 9 environment assets** (plus 0–2 rugs).

---

## 5. Environment Manifest Schema

```json
{
  "id": "floor-lounge",
  "src": "environment/floor-lounge.png",
  "tileable": true,
  "tileWidth": 64,
  "tileHeight": 64
}
```

```json
{
  "id": "wall-vertical",
  "src": "environment/wall-vertical.png",
  "tileable": true,
  "tileWidth": 16,
  "tileHeight": 64,
  "anchorX": 0.5,
  "anchorY": 1.0
}
```

---

## 6. Placement Rules

1. Furniture `x,y` in map JSON = **anchor point in world space**.
2. Collision AABB must not cover hallway walk strips (validate offline).
3. Desk interaction waypoints sit on the walkable side of the desk (south in this map).
4. Bookshelves / whiteboards use higher `depthBias` so characters walk in front when `y` is larger.

---

## 7. Naming & Paths (proposed)

```
assets/office-v2/
  furniture/
    desk.png
    desk-dual-monitor.png
    ...
  environment/
    floor-office-neutral.png
    wall-horizontal.png
    ...
  manifest/
    furniture.json
    environment.json
```

Do not commit generated binaries in the Spec phase.

---

## 8. Reuse from current Office

Existing catalog IDs that map cleanly:

- desk, dual-monitor-desk → `desk`, `desk-dual-monitor`
- sofa, armchair, coffee-table, coffee-machine, bookshelf
- meeting-table, whiteboard, reception-desk, server-rack
- plant-small / medium / large
- floor, wood-floor, wall, doorway

May need redraw for **consistent perspective** before v2 ships.

---

## 9. Asset production checklist (later)

- [ ] Shared outline / lighting reference sheet
- [ ] 17+ furniture PNGs
- [ ] 9 environment tiles
- [ ] Manifest JSON with collision + anchors
- [ ] Visual QA on 1600×1000 debug map
- [ ] Collision overlap report vs walkable rects
