# ForthHome - AI House Builder (MVP)

Design a home from a few inputs (land size, floors, rooms, kitchens, baths, style),
get an **intelligent floor plan** and a **furnished, realistically-lit 3D model**,
then **walk through it in first person**. An optional **AI Interior Designer**
(OpenAI) generates a cohesive color scheme that recolors the whole house, plus
photorealistic interior renders.

---

## Quick start

Needs **Node.js 18+** (`node -v`). No `npm install` required.

```bash
cd house-builder
node server.js
```

Open **http://localhost:3000**. A sample house generates on load.

---

## SECURITY — rotate your OpenAI key

The key you pasted in chat is in `.env` so the app works, **but it is now
exposed**. Please:

1. Go to <https://platform.openai.com/api-keys> and **revoke** that key.
2. Create a new one and paste it into `.env` as `OPENAI_API_KEY=...`.

`.env` is already in `.gitignore`, so it will not be committed.

---

## What's new vs the first version

- **Intelligent layout** — a real central hallway connects the front door, the
  stairs and every room. Rooms are double-loaded off the corridor with deliberate
  doors; windows only appear on exterior walls. Public rooms (living/kitchen/
  dining/garage) go on the ground floor, bedrooms and baths upstairs.
- **Designed interiors** — every room is furnished and styled: per-room flooring
  (wood / tile / carpet / concrete), painted walls, rugs, artwork, ceiling lights,
  plants, baseboards and door frames. Detailed furniture for living, bedroom,
  kitchen, bathroom, dining and garage.
- **Realistic rendering** — image-based lighting (Three.js RoomEnvironment),
  ACES filmic tone-mapping, sRGB color, soft shadows, reflective glass, and
  procedurally-generated material textures.
- **5 styles** — modern, traditional, scandinavian, minimalist, industrial,
  each with its own palette, materials and roof type.
- **AI Interior Designer** (OpenAI) — see below.

---

## Using it

1. Set land, rooms, floors and style on the left, press **Generate house**.
2. **Orbit** to inspect; **Cutaway** hides the roof for a dollhouse view (with a
   floor selected it shows that level and below).
3. **Walk** — click the scene, then `W A S D` + mouse, `Shift` to run, `C` for
   no-clip if you ever get stuck, `Esc` to release. Use the `L1/L2…` buttons to
   change levels.
4. **Export** the floor plan (PNG) or the 3D model (GLB).

### AI Interior Designer (optional, uses OpenAI credits)

- **Generate design scheme** — calls `gpt-4o-mini` to produce a cohesive palette
  + per-room colors + notes. With *Apply palette* on, the whole 3D house is
  instantly recolored to that scheme.
- **Inspiration render** — calls the image model (`gpt-image-1`) to produce a
  photorealistic render of the selected room in your style. Renders cost a few
  cents each; the model is set by `OPENAI_IMAGE_MODEL` in `.env`.

---

## Environment variables (`.env`)

| Key | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required for the AI designer. |
| `OPENAI_TEXT_MODEL` | Default `gpt-4o-mini` (design scheme). |
| `OPENAI_IMAGE_MODEL` | Default `gpt-image-1` (interior renders). |
| `UNSPLASH_ACCESS_KEY` | Optional — enables "Search web" reference images. |
| `PORT` | Default 3000. |

Only the core 3D app needs **no keys at all**.

---

## Files

| File | Purpose |
|---|---|
| `server.js` | Zero-dependency Node server + OpenAI endpoints (keys stay server-side). |
| `public/index.html` | UI shell + styles. |
| `public/app.js` | Layout engine, 3D builder, interiors, walkthrough, AI client. |
| `.env` / `.env.example` | Your keys (gitignored) / template. |

---

## Known limits & next steps

- Layout is a central-corridor scheme (no curved walls or L-shaped wings yet).
- Floors change via the level buttons rather than physically climbing stairs.
- Furniture is clean primitives (recognizable, not photoreal) — the AI renders
  fill the photoreal gap.

Good next steps: let an uploaded reference image drive the palette automatically,
add door/window placement controls, a cost estimate from area + fixtures, and
save/load of designs.
