# Office / Character asset integration

## Roles (Cursor)

- **Characters** → `sprite-gen` atlases under `client/public/assets/sprites/roles/{role}/`
- **Furniture / plants / environment** → transparent PNG under `client/public/assets/{furniture,plants,environment}/`
- **UI** → React/CSS

Do **not** invent new furniture SVG art. Keep SheetProps only as fallback until PNGs arrive.

## Registering a PNG

1. Drop file at the path in `client/src/office/assets/officeAssetCatalog.ts`
2. Call `registerProductionPng('furniture/desk.png')` from a small bootstrap (or add to a future scanner)
3. `PropSprite` will prefer PNG automatically

## Required PNG list (not yet shipped)

See `REQUIRED_OFFICE_PNGS` in `officeAssetCatalog.ts`.

### furniture/
desk, dual-monitor-desk, chair, bookshelf, sofa, armchair, coffee-table, coffee-machine, meeting-table, whiteboard, server-rack, reception-desk

### plants/
plant-small, plant-medium, plant-large, tree, garden-plant

### environment/
bench, rug, floor, wall, doorway, grass, garden-path

## sprite-gen Role expansion

Pilot Developer ships as `sprites/roles/developer` (body-only work row after bake fix).

Planned roles: pm, developer, game-designer, designer, researcher, marketer, tester, manager

States: idle, walk-down/up/left/right, work, talk

Generate with `tools/sprite-runs/` — Role Base + recolor variation later (not 279 uniques).

```bash
# Example: regenerate developer work row (no furniture bake)
cd tools/sprite-gen && source .venv/bin/activate
# see tools/README.md
```
