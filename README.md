# ForthHome — AI House Designer (MVP)

Describe your plot and rooms, get a **walkable 3D house**, an **accurate 2D floor plan**, and optional **AI interior/exterior renders** guided by your reference images.

## Quick start

Needs **Node 18+**. No `npm install`.

```bash
cd house-builder
cp .env.example .env   # optional — fill keys for AI features
node server.js
```

Open **http://localhost:3000**. A sample house builds on load.

## What you can do (MVP)

| Step | What | Needs API key? |
|------|------|----------------|
| 1 | Set **plot size**, **floors**, **bedrooms**, **bathrooms**, **kitchens**, dining/garage, **style** | No |
| 2 | **Generate house** → walkable **3D model** (Orbit + first-person Walk) | No |
| 3 | **Floor plan** tab → dimensions, furniture, SVG/PNG download | No |
| 4 | **Design scheme** → AI palette + per-room notes | `OPENAI_API_KEY` |
| 5 | **Photoreal renders** → exterior + room photos | `OPENAI_API_KEY` + org verified for image model |
| 6 | **Reference images** → upload or **Search web** (Unsplash) to steer renders | Unsplash key for search only |

### 3D controls

- **Orbit / Walk** — in Walk: click scene, **WASD** + mouse, **Shift** run, **C** no-clip, **Esc** release
- **Level** buttons switch floors; **Cutaway** hides roof/ceilings

### AI tips (save usage)

- Start with **Design scheme** (cheap text model) before renders
- Add 1–3 **reference images** so each render needs fewer retries
- Use **Test OpenAI** if renders fail — usually org verification for `gpt-image-1`

## Environment variables

See `.env.example`. Minimum for full MVP:

```env
OPENAI_API_KEY=sk-...
UNSPLASH_ACCESS_KEY=...   # optional, for web inspiration search
```

## Architecture

| File | Role |
|------|------|
| `public/layout.js` | Floor-plan engine (rooms, corridor, doors, windows) |
| `public/house3d.js` | 3D scene builder + Three.js walk-through viewer |
| `public/app.js` | UI wiring, 2D plan SVG, AI client |
| `public/vendor/` | Bundled Three.js (works offline) |
| `server.js` | Static server + OpenAI + Unsplash proxy |

## Honest limits

- 3D is **real-time architectural visualization** (furnished, walkable) — not a photograph. Photorealism comes from the AI renders tab.
- Layout uses a proven **central-corridor** scheme — sensible and accurate, not a custom architect drawing.
- Floor switching uses Level buttons (stairs are visual only).
