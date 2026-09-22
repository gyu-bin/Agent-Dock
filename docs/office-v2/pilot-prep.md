# Office V2 Pilot Intake

## Furniture Pilot

Place candidates here first:

`client/public/assets/office-v2/pilot/furniture/`

| File name | Manifest id |
|-----------|-------------|
| desk.png | desk |
| chair.png | chair |
| sofa.png | sofa |
| plant-small.png | plant-small |

Then run [`asset-quality-gate.md`](./asset-quality-gate.md).  
On PASS → copy to `client/public/assets/office-v2/furniture/` and set `status: "ready"` in `office-v2-furniture.json`.

## Character Pilot

`client/public/assets/office-v2/pilot/characters/developer/`

Expected after sprite-gen:

- `atlas.png` (or sheet)
- updated `manifest.json` with filled `rects`

Promote to `characters/developer/` and mark ready in `office-v2-characters.json`.

## sprite-gen request

`tools/sprite-runs/office-v2/developer.request.json`  
(96×96, 8 anims × 4 frames, body-only bake rules)

Do not run mass generation for all 8 roles until developer pilot PASSes.
