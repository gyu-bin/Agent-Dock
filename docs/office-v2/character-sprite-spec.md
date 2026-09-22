# Agent Deck Office v2 — Character Sprite Specification

> Spec only. No sprite-gen execution in this phase.  
> Builds on existing ideas in `client/src/office/sprites/` and `visual/agentVisual.ts`.

---

## 1. Scope

sprite-gen applies to **characters only**.

Furniture / environment are separate static PNGs ([`asset-spec.md`](./asset-spec.md)).

**Forbidden:** generating unique sprites for all 279 registry agents.

---

## 2. Role Bases (8)

| Role Base ID | Typical divisions | Default zone when working |
|--------------|-------------------|---------------------------|
| `pm` | product, project-management, strategy | product |
| `developer` | engineering, specialized, spatial-computing | development |
| `game-developer` | game-development | game-development |
| `designer` | design | design |
| `researcher` | research, academic, gis, healthcare | research |
| `marketer` | marketing, sales, paid-media | marketing |
| `qa` | testing | testing |
| `reviewer` | testing / meeting overflow | testing / meeting |

Mapping from Agent → Role Base is deterministic (division + specialty tags). Existing `VisualRole` logic can be adapted.

---

## 3. Required Animations

Every Role Base ships these clips:

| Animation | Directions | Frames | Notes |
|-----------|------------|--------|-------|
| `idle` | 1 (front) or 4 | 4–6 | Breathing / slight sway |
| `walk-down` | down | 4–6 | |
| `walk-up` | up | 4–6 | |
| `walk-left` | left | 4–6 | May mirror `walk-right` if art allows |
| `walk-right` | right | 4–6 | |
| `work` | 1 (face desk) | 4–6 | Typing / pointing at monitor |
| `sit` | 1 | 4–6 | Sofa / meeting / armchair |
| `talk` | 1–2 | 4–6 | Handoff / review chat |

Optional later: `blocked` (reuse idle + UI indicator), `review` (reuse sit/talk).

### Frame size

Prefer **uniform frame size** across all roles:

- Candidate A: **64×64**
- Candidate B: **96×96**

Final pick after first sprite-gen pilot. Anchor: **bottom-center** of frame ≈ feet.

---

## 4. Character Manifest Schema

```json
{
  "roleId": "developer",
  "frameWidth": 64,
  "frameHeight": 64,
  "anchorX": 0.5,
  "anchorY": 1.0,
  "animations": {
    "idle": { "src": "characters/developer/idle.png", "frames": 4, "fps": 6 },
    "walk-down": { "src": "characters/developer/walk-down.png", "frames": 6, "fps": 10 },
    "walk-up": { "src": "characters/developer/walk-up.png", "frames": 6, "fps": 10 },
    "walk-left": { "src": "characters/developer/walk-left.png", "frames": 6, "fps": 10 },
    "walk-right": { "src": "characters/developer/walk-right.png", "frames": 6, "fps": 10 },
    "work": { "src": "characters/developer/work.png", "frames": 4, "fps": 8 },
    "sit": { "src": "characters/developer/sit.png", "frames": 4, "fps": 4 },
    "talk": { "src": "characters/developer/talk.png", "frames": 4, "fps": 8 }
  },
  "variations": {
    "hair": ["a", "b", "c", "d"],
    "outfit": ["navy", "teal", "coral", "sand"],
    "skin": ["1", "2", "3"],
    "accessory": ["none", "glasses", "headset", "badge"]
  }
}
```

If sprite-gen outputs a single atlas sheet, replace per-anim `src` with `{ "atlas": "...", "frames": [...] }`.

---

## 5. Variation System

```
renderedCharacter = RoleBase + VariationSet(agentId)
```

### Deterministic selection

```
seed = hash(agentId)
hair       = hairs[seed % N_hair]
outfit     = outfits[(seed >> 3) % N_outfit]
skin       = skins[(seed >> 6) % N_skin]
accessory  = accessories[(seed >> 9) % N_accessory]
```

Same agent always looks the same across sessions.

### Counts (recommended)

| Channel | Options |
|---------|---------|
| hair | 4 |
| outfit palette | 4 |
| skin tone | 3 |
| accessory | 4 (incl. none) |

Total looks per role ≈ 4×4×3×4 = **192** without new base art.

### Generation strategy

1. Generate **8 Role Base** atlases (canonical look).  
2. Apply palette swaps / layer kits for variation (prefer runtime tint / layered sheets over 192×8 gens).  
3. Only re-gen bases when silhouette changes.

---

## 6. Runtime Animation Mapping

| Office character state | Clip |
|------------------------|------|
| idle (standing) | `idle` |
| idle (on sit waypoint) | `sit` |
| walking | `walk-{direction}` |
| working | `work` |
| talking | `talk` |
| reviewing | `sit` or `talk` |
| blocked | `idle` + blocked indicator overlay |

Direction while walking:

```
if |dx| > |dy| → left/right
else → up/down
```

---

## 7. On-Screen Caps

| Metric | Value |
|--------|-------|
| Recommended team on floor | 5–15 |
| Hard render cap | ~30 |
| Concurrent unique Role Bases | ≤ 8 |

Overflow agents remain in registry / list UI — not spawned on the map.

---

## 8. Speech Bubble Coupling

Bubbles are **not** part of the sprite sheet.  
They are UI overlays (layer 6) triggered by events. Keep text short Korean.

---

## 9. File Layout (proposed)

```
assets/office-v2/characters/
  pm/
  developer/
  game-developer/
  designer/
  researcher/
  marketer/
  qa/
  reviewer/
  manifest.json
```

---

## 10. Asset count summary

| Item | Count |
|------|-------|
| Role bases | 8 |
| Animations per role | 8 |
| Frames per anim (avg) | 5 |
| Base frame sheets (if separate files) | 8 × 8 = **64 sheets** |
| Or atlases | **8 atlases** (preferred) |
| Variation layers / palettes | ~15 shared kits |

**Recommended ship target:** 8 role atlases + shared variation kits.

---

## 11. Reuse from current Office

Reusable concepts:

- `statusToAnimation` / room status mapping (`agentVisual.ts`)
- `roleSprites.ts` / atlas character pipeline
- Lounge waypoint scatter pattern (migrate to absolute lounge.* IDs)
- Room capacity caps

Not reusable as-is:

- CSS `%` room anchors
- PixelCharacter fallback as final art
- Per-agent unique sprites
