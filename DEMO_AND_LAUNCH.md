# ForthHome demo and launch brief

## Product promise

ForthHome turns a residential brief into a validated concept plan, a furnished walkable model, and a consistent client presentation set. It is a concept-design tool, not stamped construction documentation.

The first paying customer should be a small residential architect, builder, real-estate marketer, or interior studio that needs to win client approval faster. Do not launch as a generic game-asset generator and an architect replacement at the same time.

## Five-minute demo

1. Start with **Describe a home** and use a concrete client brief.
2. Review the generated plan before opening 3D. Point out provenance, room-count match, circulation, coverage, daylight, and the saved design version.
3. Switch to **Visualize**, use the floor/cutaway controls, and show that the model comes from the accepted plan.
4. Generate one exterior and one interior view. Explain that both use the canonical plan and 3D capture as references.
5. Export the plan from **Plan** and the prototype GLB from **Visualize**.

If the AI provider is unavailable, say so openly and demonstrate the seeded offline planner. Never call an offline fallback “AI generated.”

## Monetization hypothesis

Use subscriptions plus render credits so image-generation cost cannot outrun revenue.

- **Free**: one active project, watermarked draft presentation, limited low-quality renders.
- **Studio**: target $29/month; more projects, multi-floor planning, medium-quality render credits, SVG/PNG export.
- **Pro**: target $79/month; client branding, high-quality render credits, revision history, prototype GLB export, commercial project rights.
- **Team**: target $199/month; shared workspace, approvals, higher quotas, priority rendering.

Treat those prices as a test, not a promise. [Maket's current pricing](https://www.maket.ai/pricing) provides a useful consumer benchmark at $20/month with generation credits, while professional spatial-design products price materially higher. ForthHome should sell time saved and presentation quality, not unlimited expensive generations.

## What must exist before charging strangers

- Real authentication, per-user projects, database persistence, Stripe billing, quotas, usage metering, and background render jobs.
- A replaceable, valid provider key stored only on the server.
- Error monitoring, backups, privacy/terms pages, deletion controls, and provider-cost alerts.
- Architect review language on every exported concept pack.
- Verified licenses for every redistributed model and texture. The current GLB export is a prototype; see `ASSET_PROVENANCE.md`.

## First validation sprint

Recruit five local architects/builders and run ten real briefs. Measure: plan acceptance without regeneration, time to client-ready pack, revisions per accepted plan, render cost per project, and willingness to pay. The launch gate is not “looks impressive”; it is at least 7/10 briefs producing an acceptable concept plan and three users asking to use it again.
