# ForthHome — 3D House Designer

Set your land, rooms and style, and get a **walkable 3D house** you can explore
in first person — built on a **unit-tested floor-plan engine** so the layout is
always geometrically correct. Two extra tabs add an **accurate 2D plan** and
**photorealistic AI renders** of each room.

## Quick start

Needs **Node 18+**. No `npm install`.

```bash
cd house-builder
node server.js
```

Open **http://localhost:3000** (a sample house builds on load). The 3D needs
WebGL — any modern browser. If 3D ever fails it shows the error on screen rather
than going black.

## The 3D model (main tab)

- **Orbit / Walk** toggle. In **Walk**: click the scene, then **W A S D** + mouse
  to look, **Shift** to run, **C** for no-clip, **Esc** to release.
- **Level** buttons switch floors; **Cutaway** hides the roof/ceilings to peek in.
- Furnished rooms (beds, sofas, kitchen counters, dining sets, baths, wardrobes,
  cars), windows, doors, stairs, roof and yard — all placed from the floor plan.

## Floor plan tab

A clean architectural drawing (walls, door swings, windows, plan-view furniture,
dimensions, north arrow). Download as **SVG** or **PNG**.

## Photoreal renders tab (OpenAI)

Click a view (Exterior, Living room, …) for a magazine-quality photo of that
space. Uploaded **reference images** steer the look.

> **Why renders may fail:** `gpt-image-1` requires your OpenAI **organization to
> be verified** (DALL·E 3 was retired in 2026, so there's no fallback). Use the
> **Test OpenAI** button — it reports the exact issue. Also **rotate the key you
> pasted in chat** (it's exposed): revoke at platform.openai.com/api-keys, put a
> fresh one in `.env`. The Design-scheme text feature works without verification.

## Files

| File | Purpose |
|---|---|
| `public/layout.js` | Pure, unit-tested floor-plan engine. |
| `public/house3d.js` | Pure `describeHouse()` (unit-tested) + the Three.js walk-through viewer. |
| `public/app.js` | UI: 3D + 2D plan + AI client. |
| `public/index.html` | UI shell (loads Three.js r128 from CDN). |
| `server.js` | Zero-dependency server + OpenAI endpoints + `/diagnose`. |

## Honest limits

- The 3D is **clean real-time architectural visualization** (think tidy game/CAD
  look), not a photograph. True photorealism comes from the AI renders tab.
- Layout is a central-corridor scheme — correct and sensible, not a bespoke
  architect's plan (no curved walls / wings yet).
- Floors switch via the Level buttons (you don't climb the stairs).
