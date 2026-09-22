# Office V2 — Asset Quality Gate

Use before flipping any manifest `status` from `missing` → `ready`.

## Checklist (per PNG / atlas)

- [ ] Transparent background (no baked scene)
- [ ] Correct fixed top-down / slight 2.5D perspective (matches pack)
- [ ] Scale consistent with character standing height ≈ 72 logical units
- [ ] Clean alpha (no white/magenta halo)
- [ ] No baked character inside furniture
- [ ] No baked furniture inside character animations (`work` / `sit` / `talk`)
- [ ] No baked text / logos / watermarks
- [ ] Soft pastel + clean outline; no photorealism / dramatic lighting
- [ ] Anchor matches manifest (`bottom-center` unless floor tile)
- [ ] Collision is logical footprint — not full transparent bbox
- [ ] Palette matches Office V2 family (warm cream / soft wood / navy accents)
- [ ] Resolution sufficient for 1440–1920 fit-contain (≥2× logical size preferred)

## Character-specific

- [ ] Frame size **96×96**
- [ ] 8 animations × 4 frames present
- [ ] Manifest `rects` filled from atlas (renderer does not hardcode rows)
- [ ] `work` / `sit` / `talk` are body-only

## Furniture pilot set

desk · chair · sofa · plant-small

## Character pilot

developer

## Process

1. Drop files into `pilot/...`
2. Run checklist
3. On PASS: promote to Production path + set `ready`
4. On FAIL: leave `missing` or mark `rejected` with notes
