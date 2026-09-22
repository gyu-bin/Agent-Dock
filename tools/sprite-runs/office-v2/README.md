# Office V2 — sprite-gen configuration

Uses existing `tools/sprite-gen`. Does **not** run generation in the Asset Preparation phase.

## Production target

| Setting | Value |
|---------|-------|
| Frame | **96×96** |
| Frames / anim | **4** |
| Animations | idle, walk-down, walk-up, walk-left, walk-right, work, sit, talk |
| Frames / role | 8 × 4 = **32** |
| Roles this phase | config stubs only; **pilot = developer** |

## Requests

| Role | Request file | Status |
|------|--------------|--------|
| developer (pilot) | `developer.request.json` | ready to run later |
| pm | `pm.request.json` | stub |
| game-developer | `game-developer.request.json` | stub |
| designer | `designer.request.json` | stub |
| researcher | `researcher.request.json` | stub |
| marketer | `marketer.request.json` | stub |
| qa | `qa.request.json` | stub |
| reviewer | `reviewer.request.json` | stub |

## Bake rules (mandatory)

- `work` — **no** desk / laptop / monitor / chair
- `sit` — **no** chair / sofa
- `talk` — **no** other characters / furniture

## Output paths

```
client/public/assets/office-v2/characters/{role}/atlas.png
client/public/assets/office-v2/characters/{role}/manifest.json
```

Pilot drop zone:

```
client/public/assets/office-v2/pilot/characters/developer/
```

## Example (do not run now)

```bash
cd tools/sprite-gen
# follow tools/sprite-gen README with:
#   ../sprite-runs/office-v2/developer.request.json
```

After PASS quality gate, set role `status` to `ready` in:
`client/public/assets/office-v2/manifests/office-v2-characters.json`
and fill `rects` in the role manifest (renderer must not hardcode rows).
