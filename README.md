# ForthHome

ForthHome is a residential concept-design studio: describe a home, review a machine-validated floor plan, explore the furnished 3D model, and create a consistent presentation set.

It is intentionally honest about scope. The exported plans and models are concept assets for client demos, visualization and prototyping; they are not stamped construction documents or a substitute for a licensed local architect/engineer.

## Run it

Requires Node.js 18 or newer.

```bash
npm install
copy .env.example .env
npm run dev
```

Open the local URL printed by the server. On Windows systems that block PowerShell npm scripts, use `npm.cmd run dev`.

Useful commands:

```bash
npm run build
npm run typecheck
npm test
npm start
```

## Product workflow

1. **Create** — enter a client brief or upload a clean floor-plan image.
2. **Plan** — review the plan first, including provenance, requested-room fidelity and quality checks.
3. **Visualize** — inspect the accepted plan as a furnished, walkable Three.js model.
4. **Present** — create plan/scene-conditioned images and export SVG, PNG or prototype GLB.

The app does not spend AI credits on page load. If an AI geometry result fails validation, the interface clearly identifies the seeded constraint-planned result instead of pretending a fallback is AI-generated.

## Floor planning

The offline engine is a seeded procedural space planner, not a small catalog of reused plans. It evaluates multiple candidates and keeps the highest-scoring valid layout. A seed makes each result reproducible; a fresh generation produces a new variation.

Even without an AI key, a conservative prompt interpreter applies explicit bedroom/bathroom/floor counts, supported style words, garage/dining choices and named spaces such as offices, laundries, pantries, prayer rooms and gyms before planning.

The validator checks:

- true geometric union coverage, bounds and overlaps;
- exact requested room counts, including named custom rooms;
- connected circulation from the entrance or landing;
- doors placed on shared walls and exterior-only windows;
- room minimums and sensible circulation width;
- aligned, bounded multi-floor stairs;
- candidate quality before a result is accepted.

AI is useful for understanding the written brief and proposing geometry, but machine validation is the release gate. The deterministic planner remains fully usable without a provider key.

## AI providers

Keys stay on the server and are never included in the browser bundle.

| Workload | Default | Environment variable |
|---|---|---|
| Plan reasoning | `gpt-5.6-sol` | `OPENAI_PLAN_MODEL` |
| Briefs/schemes | `gpt-5.6-terra` | `OPENAI_TEXT_MODEL` |
| OpenAI images | `gpt-image-2` | `OPENAI_IMAGE_MODEL` |
| Gemini images | `gemini-3-pro-image` | `GEMINI_IMAGE_MODEL` |

Set `IMAGE_PROVIDER=openai` or `gemini`. The diagnostics action checks the configured key and model access. Merely finding a key in `.env` is shown as “configured,” not falsely reported as connected.

Photoreal image requests include the canonical plan capture and current 3D scene so generated views remain tied to the selected project. Image models can still introduce visual inconsistencies; the dimensioned SVG/PNG plan remains the geometry source of truth.

## Exports and assets

- Dimensioned floor plan: SVG and PNG.
- Presentation images: provider-generated PNG.
- 3D concept model: binary glTF (`.glb`) with generated architecture, furniture available in the current scene and embedded materials.

The bundled/cached furniture files do not currently have verified redistribution records. Do not sell or redistribute exported GLBs until each dependency has an approved license. See [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).

## Deployment controls

The local server includes request-size limits, provider timeouts, a strict model allowlist, bounded model downloads, safe static-path handling and an hourly AI-route limit. Configure:

```dotenv
AI_RATE_LIMIT_PER_HOUR=30
AI_OFFLINE=0
# APP_ACCESS_TOKEN=replace-for-a-private-demo
# TRUST_PROXY=0
```

These controls are appropriate for a private MVP demo, not a public SaaS launch. Before charging users, add real authentication, per-user projects, durable storage, Stripe billing, usage metering, background jobs, monitoring and backups. [DEMO_AND_LAUNCH.md](DEMO_AND_LAUNCH.md) defines the recommended launch gate.

## Structure

| Path | Purpose |
|---|---|
| `src/app.ts` | Product workflow, plan renderer, persistence and exports |
| `src/styles.css` | Responsive architectural-studio design system |
| `src/engine/layout.ts` | Procedural planning, repair, validation and ranking |
| `src/engine/house3d.ts` | Plan-to-scene description and furnishing |
| `src/engine/viewer.ts` | Three.js renderer, walkthrough, capture and GLB export |
| `server/plan-generator.ts` | AI plan prompt and corrective validation loop |
| `server/providers.ts` | OpenAI/Gemini adapters and retries |
| `server.ts` | API routes, provider guards, asset proxies and static server |
| `tests/` | Geometry, adversarial validator, provider and stairwell regressions |
