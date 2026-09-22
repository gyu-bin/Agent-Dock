# Office V2 Asset Pack — README

Production asset root for Office V2.

```
client/public/assets/office-v2/
  environment/     # floor + wall tiles (PNG when ready)
  furniture/       # 19 furniture PNGs (when ready)
  characters/      # 8 role atlases + per-role manifest.json
  manifests/       # pack-level manifests (SoT for status)
  pilot/           # drop zone for Furniture/Character pilots
```

## Spec SoT (do not diverge)

- `docs/office-v2/office-map-layout.json`
- `docs/office-v2/asset-spec.md`
- `docs/office-v2/character-sprite-spec.md`

## Status values

| status | meaning |
|--------|---------|
| `missing` | Path reserved; no Production PNG yet |
| `ready` | Passed quality gate; safe for renderer |
| `rejected` | Failed gate; keep out of Production |

The current pack promotes the repository's existing transparent PNG office art while the dedicated image generation quota is unavailable. The additional lounge, meeting, monitor, whiteboard, bookshelf, coffee, plant, floor, wall, and doorway assets are wired into the reference layout. The desk and sofa pilots still contain decorative chair/cat silhouettes; replace those two files with the quality-gated split layers before final art sign-off.

Home rendering uses the existing role pose set (`client/public/assets/characters/*`) as a deterministic visual fallback for PM, developer, game developer, designer, researcher, marketer, QA, and reviewer. The developer atlas remains the animation pilot and can replace the fallback role poses when each dedicated role atlas passes the same gate.

## Pilot intake

| Pilot | Drop path | Manifest ids |
|-------|-----------|--------------|
| Furniture | `pilot/furniture/` then promote to `furniture/` | desk, chair, sofa, plant-small, desk-dual-monitor, armchair, coffee-table, coffee-machine, bookshelf, whiteboard, meeting-table, plant-medium, plant-large |
| Character | `pilot/characters/developer/` | developer atlas + filled rects |

After gate PASS → copy into final path → set `status: "ready"`.

## Related code

`client/src/office/v2/` — Office V2 renderer, map coordinates, visual role mapper, workstation policy, manifest types.

The production Home route uses `OfficeV2Scene`. The dedicated pilot loop is available at `/pilot.html` in the Vite build.
