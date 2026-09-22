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

**Never** register placeholder / low-quality PNGs as `ready`.

## Pilot intake

| Pilot | Drop path | Manifest ids |
|-------|-----------|--------------|
| Furniture | `pilot/furniture/` then promote to `furniture/` | desk, chair, sofa, plant-small |
| Character | `pilot/characters/developer/` | developer atlas + filled rects |

After gate PASS → copy into final path → set `status: "ready"`.

## Related code (not wired to OfficeScene yet)

`client/src/office/v2/` — visual role mapper, workstation policy, manifest types.
