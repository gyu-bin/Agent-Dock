# Office V2 — Existing Asset Audit (V1 → V2)

Audit of `client/public/assets/{furniture,plants,environment,sprites}` against Office V2 Visual Contract.

**Images were not modified in this phase.**

Legend:

| Tag | Meaning |
|-----|---------|
| KEEP | Close enough; may promote after light re-export / rename |
| IMPROVE | Usable base but needs perspective/scale/outline fix |
| REPLACE | Wrong perspective, baked content, or style drift — recreate |

## Furniture

| V1 file | V2 id | Verdict | Notes |
|---------|-------|---------|-------|
| desk.png | desk | IMPROVE | Likely pack extract; verify perspective vs V2 contract |
| dual-monitor-desk.png | desk-dual-monitor | IMPROVE | Rename + perspective check |
| chair.png | chair | IMPROVE | |
| armchair.png / armchair-*.png | armchair | IMPROVE | Pick one silhouette; drop color variants or treat as variation |
| sofa.png | sofa | IMPROVE | |
| coffee-table.png | coffee-table | IMPROVE | |
| coffee-machine.png | coffee-machine | IMPROVE | |
| bookshelf.png | bookshelf | IMPROVE | |
| whiteboard.png | whiteboard | IMPROVE | Ensure no baked text |
| meeting-table.png | meeting-table | IMPROVE | Scale vs character critical |
| reception-desk.png | reception-desk | IMPROVE | |
| server-rack.png | server-rack | IMPROVE | |
| floor-lamp.png | lamp | IMPROVE | Map id `lamp` |
| — | monitor | REPLACE | Missing as standalone |
| — | laptop | REPLACE | Missing as standalone |
| — | storage | REPLACE | Missing |
| beanbag-*.png | — | REPLACE | Not in V2 production list |
| bar-stool.png | — | REPLACE | Not in V2 list (optional later) |
| coffee-bar.png | — | REPLACE | Not in V2 list |
| vending-machine.png | — | REPLACE | Not in V2 list |
| presentation-display.png | — | REPLACE | Prefer whiteboard |
| mascot-cat.png | — | REPLACE | Character/mascot — not furniture pack |
| chair-gaming.png / chair-alt.png | — | REPLACE | Extra variants |

## Plants

| V1 file | V2 id | Verdict |
|---------|-------|---------|
| plant-small.png | plant-small | IMPROVE |
| plant-medium.png | plant-medium | IMPROVE |
| plant-large.png | plant-large | IMPROVE |
| tree.png / garden-plant.png | — | REPLACE (Garden out of V2 map) |

## Environment

| V1 file | V2 id | Verdict | Notes |
|---------|-------|---------|-------|
| floor.png / wood-floor.png | floor-office / floor-lounge | IMPROVE | Split into 4 floor ids |
| wall.png | wall-horizontal / wall-vertical | REPLACE | Need separate H/V + corner |
| doorway.png | doorway | IMPROVE | |
| rug.png / rug-pink.png | rug / rug-pink | IMPROVE | Optional |
| grass / garden-path / entrance-door / bench | — | REPLACE | Garden / unused in V2 map |
| — | glass-partition | REPLACE | Missing |
| — | wall-corner | REPLACE | Missing |
| — | floor-meeting / floor-reception | REPLACE | Missing dedicated tiles |

## Characters (sprites)

| V1 | V2 | Verdict | Notes |
|----|----|---------|-------|
| sprites/roles/developer (128px pilot) | characters/developer | IMPROVE | Retarget **96×96**; verify body-only work/sit; add `sit` row |
| other roles | 7 roles | REPLACE | Not shipped for V2 yet |

## Summary counts

| Verdict | Approx |
|---------|--------|
| KEEP | 0 (none auto-promoted without gate) |
| IMPROVE | ~20 existing candidates |
| REPLACE | missing + out-of-scope + wall split |

V2 manifests remain **`status: missing`** until Quality Gate PASS — existing V1 PNGs are **not** registered as Production V2.
