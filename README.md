# ForthHome — AI House Designer (TypeScript)

Describe your plot and rooms and get a **bespoke AI-designed floor plan** (a new design every time, machine-validated), a **walkable PBR 3D house**, and **photoreal AI renders** steered by your reference images.

## Quick start

Needs **Node 18+**.

```bash
cd house-builder
npm install
cp .env.example .env    # add OPENAI_API_KEY for bespoke AI floor plans + renders
npm run dev             # compiles TypeScript + builds the app, serves on :3000
```

The 3D model and floor plans still work **offline with no keys** (validated template mode).

### Scripts

| Command | What |
|---------|------|
| `npm run dev` | Full build (tsc + vite) + serve on :3000 |
| `npm run build` | Build server (`build/`) + client (`dist/`) |
| `npm run typecheck` | Strict client type-check |
| `npm start` | Serve the last build |
| `npm test` | 23 invariant tests: floor-plan validity + AI generator loop |

## How floor plans are made now

1. **Bespoke generation** — the AI acts as a residential architect and designs a *new* plan for your exact spec and written brief (`server/plan-generator.ts`). A variation seed makes every generation distinct.
2. **Machine validation** — the plan is parsed, repaired, and checked against hard invariants: no overlaps, in-bounds, every room reachable via doors, exact bedroom/bathroom counts, minimum room sizes, windows only on exterior walls, stairs stacked across floors, footprint coverage.
3. **Corrective retry** — on violations the AI gets the exact issue list once and must fix them.
4. **Fallback** — only if there is no key or the AI fails twice does the validated offline template engine step in (the plan is labelled accordingly in the UI).

## AI engines (best-in-class, July 2026)

| Job | Engine | Key |
|-----|--------|-----|
| Photoreal renders + **AI floor-plan renders** | **Nano Banana Pro** (Google `gemini-3-pro-image-preview`) — best-in-class editing + text rendering, 2-5s/image | `GEMINI_API_KEY` (free tier at aistudio.google.com) |
| Bespoke floor-plan reasoning, schemes, vision | OpenAI GPT-4o (Gemini fallback when only that key is set) | `OPENAI_API_KEY` |
| **Text-to-3D furniture** (generated once, cached) | **Rodin by Hyper3D/Deemos** — top-tier 3D generation | `RODIN_API_KEY` (hyper3d.ai) |
| Free CC0 furniture fallback | Poly Pizza | `POLY_PIZZA_KEY` |

Force the image engine with `IMAGE_PROVIDER=gemini` or `openai` in `.env`; with no override, Nano Banana Pro is preferred whenever `GEMINI_API_KEY` is set.

New: on the **Floor plan** tab, press **✨ AI render** — Nano Banana Pro turns the schematic into a marketing-quality presentation plan while preserving every wall, label and dimension.

## Realism

- PBR materials + physical sky + image-based lighting, soft shadows, SSAO + bloom, day/night toggle
- Interior doors are real ajar door leaves with frames; windows get curtains; living spaces get cornices and wall art; garages get a sectional door + driveway
- GLB furniture is strictly fitted to its slot (no more oversized/clipping "broken" meshes); degenerate models are rejected and fall back to procedural furniture
- **Design scheme accents are applied to the 3D model** — generate a scheme and the rugs, sofas and art recolor to match
- Real PBR textures stream from Poly Haven (no key); real furniture with a free `POLY_PIZZA_KEY`

## Architecture (all TypeScript)

| Path | Role |
|------|------|
| `src/engine/types.ts` | Shared domain types (Layout, Room, Spec, SceneItem, ...) |
| `src/engine/layout.ts` | Layout engine + validity/repair/coverage (`fromAIReport`) |
| `src/engine/house3d.ts` | Pure scene description (Node-testable) |
| `src/engine/viewer.ts` | Three.js viewer (PBR, sky/IBL, SSAO+bloom, walk mode) |
| `src/app.ts` | UI, 2D dimensioned plan SVG/PNG export, AI client |
| `server.ts` | HTTP server: static `dist/` + AI + asset proxies (compiled to `build/`) |
| `server/plan-generator.ts` | Bespoke AI floor-plan generation with validate-retry loop |
| `server/providers.ts` | Pluggable AI provider interface (OpenAI default; add Higgsfield etc.), retry with backoff |
| `tests/` | `npm test` — layout invariants + generator loop (mock provider) |
| `legacy-js/` | The previous JavaScript implementation, kept for reference |
| `public/models/` | Cached CC0 furniture GLBs (served via `/api/model`) |

## Honest limits

- The walkable 3D is real-time architectural visualization — photorealism comes from the AI renders tab.
- Bespoke plans cost 1–2 model calls per generation; the offline mode is free.
