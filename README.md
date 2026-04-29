# DHA Iron Vein — INDOPACOM Resilient Operational Network for Vital Expeditionary Inventory Nodes

End-to-end medical logistics decision-support platform for the **Modern Marine 2026** competition. DHA Iron Vein takes the hub-and-spoke USINDOPACOM Class VIII supply network and makes it *visible, predictable, and actionable* for Commanders, Logisticians, Medical Planners, and Analysts operating in a contested theater.

The platform fuses a real DLA / DMLSS-compatible medical-supply catalog and a ~389k-row imported Supply Demo dataset with a deterministic theater simulation, a 30-day predictive sustainment engine, casualty-driven medical readiness, blood-products-first viability tracking, scenario-time supplier degradation, and a provider-agnostic AI orchestrator (OpenAI **gpt-5.4** ↔ Google **gemini-2.5-pro**, switchable per request) — all surfaced through a live operations console, a scenario console, a leadership opener deck, and a full scenario brief.

> **Operational date in the demo:** 27 April 2026
> **AOR:** USINDOPACOM theater — TLAMM hubs, regional MTFs, BAS / clinic spokes, supplier mix across DLA / DOD / commercial / host-nation / allied channels
> **Default posture:** FPCON BRAVO (operator-adjustable from the header)
> **Visual identity:** USMC scarlet `#BA0C2F` and gold `#FFCC00` on a deep tactical neutral; no emojis anywhere

---

## Table of contents

1. [What's in the box](#whats-in-the-box)
2. [The artifacts](#the-artifacts)
3. [Quick start](#quick-start)
4. [Architecture at a glance](#architecture-at-a-glance)
5. [API surface](#api-surface)
6. [Roles & DMLSS posture](#roles--dmlss-posture)
7. [Engineering notes](#engineering-notes)
8. [Operational impact](#operational-impact)
9. [How decision support becomes near-instantaneous](#how-decision-support-becomes-near-instantaneous)
10. [Module operating manual](#module-operating-manual)
11. [Security posture](#security-posture)
12. [DoW IL5 deployment posture](#dow-il5-deployment-posture)
13. [License & status](#license--status)

---

## What's in the box

A pnpm monorepo with four user-facing artifacts (plus an internal design sandbox) and a shared library layer.

```
workspace/
├── artifacts/
│   ├── api-server/         Express + Drizzle backend (REST, sim, AI, auth, MFA, exports)
│   ├── command/            React + Vite operations console        (path "/")
│   ├── scenario-brief/     React + Vite 14-slide scenario deck    (path "/scenario-brief")
│   ├── marines-opener/     React + Vite 3-slide leadership opener (path "/marines-opener")
│   └── mockup-sandbox/     UI variant preview server (design-only, not user-facing)
├── lib/
│   ├── api-spec/           OpenAPI 3.1 contract + orval codegen targets
│   ├── api-client-react/   Generated typed React Query client
│   ├── api-zod/            Generated Zod schemas (server validation)
│   ├── db/                 Drizzle ORM schema + seed/ingest scripts
│   ├── sim/                Pure-TS theater simulation, cascades, recommendations
│   ├── ai-orchestrator/    Provider-agnostic LLM router (OpenAI + Gemini)
│   ├── replit-auth-web/    Replit OIDC client for the web app
│   ├── exports/            CSV/XLSX export helpers
│   └── integrations-*      Replit AI integrations proxies (no third-party keys)
├── docs/
│   └── supply-demo-import.md   Reference for the Supply demo import pipeline
├── SECURITY.md             Security controls, threat model, key rotation
├── replit.md               Project memory
└── README.md               (this file)
```

Each artifact runs as its own service behind the workspace's path-routed proxy, so the user can switch among them from the preview-pane dropdown.

---

## The artifacts

### `artifacts/command/` — Live operations console (path `/`)
The DHA Iron Vein operations app. USMC scarlet-and-gold dark theme on a deep neutral background. Pages, in nav order:

- **Command Overview** (`/`) — Theater Vital Signs strip, persona switcher, AI Brief card, Mission-Risk Stoplight Matrix, Time-to-Fail Leaderboard, Constraint Cascade card, Cold-Chain Pulse, Walking-Blood-Bank-by-ABO chips, live activity stream, resized live map.
- **Network Map** (`/network`) — Full-screen deck.gl + MapLibre map covering the official USINDOPACOM AOR with animated trip particles, threat-tier-colored nodes, ad-hoc theater zones, the Layers panel (Blood Products / Supplies / Custom with sub-layers), the Blood Readiness sidebar (default Blood Products lens, click-through to Site Detail Blood Readiness tab), and TLAMM-hub treatment.
- **Locations** (`/locations`) — Sortable directory of all theater nodes with role badges (Role 1 / 2 / 3), TLAMM badges, AOR, and stock posture.
- **Site Detail** (`/sites/:nodeId`) — Tabs: **Blood Readiness** (default) → Inventory → Alerts → Activity → Forecast → TLAMM Stockpile (when applicable). Editable Population at Risk. Site-level recommendations rail.
- **Item Detail** (`/items/:itemId`) — Network-wide DOS, where-stocked table, sortable supplier list with lead-time and reliability, NDC / manufacturer / UNSPSC / size / GHX commodity attributes, procedure cross-reference.
- **Orders Board** (`/orders`) — Kanban (Submitted / Acknowledged / In Transit / Received) with uniform cards, item / destination / supplier names, "Triggered by" line, shipment progress and editable ETA, milestones and notes in the activity history.
- **Order Detail** (`/orders/:id`) — Full PO envelope, line items, supplier info, route/ETA, shipment progress, activity history with notes formatted as a separate line, Print PO.
- **Casualty Planner** (`/casualty`) — Event picker + patient-mix entry → required materiel by class with sufficiency badges, clinician + PPE staffing, per-item shortfall list with promote, patient-reroute suggestions, single-click "Order everything still short" bulk flow.
- **Procedures** (`/procedures`) — Procedure library with Primary / Secondary / Tertiary supply tiers and Role-of-care filter.
- **Suppliers** (`/suppliers`) — Catalog coverage per supplier, lead time, reliability, channel.
- **Scenarios** (`/scenarios`) — Preset events (war / contested first, weather last) and custom builder with affected nodes, theater zones, and impacted-supplier degradation; live `ScenarioResult` panel with AI brief, per-node and per-item impact tables, recommendations, cascade story, supplier alternatives.
- **Copilot** (`/copilot`) — Streaming chat strictly grounded in solution data (refuses out-of-scope questions); provider toggle (OpenAI / Gemini).
- **Tags** (`/tags`) — Global tag taxonomy with usage counts, AI auto-tag batches, tag detail view with cross-entity rollup.
- **Data Admin** (`/data`) — DB health, table row counts, seed status, Supply Demo import / reconcile / activate / rollback, AI provider status.
- **Settings** (`/settings`) — AI provider toggle, alert thresholds, theme.
- **Profile** (`/profile`) — Identity from Replit, role selection, MFA enrollment status, recovery codes, reset-authenticator action.

Other shell components: header **FPCON pill** (operator-adjustable across ALPHA / BRAVO / CHARLIE / DELTA, persists in `localStorage`, broadcasts a custom event), **role switcher**, **Cmd-K Search Palette** (sites, items, suppliers, orders, scenarios, tags), **Alerts Rail** slide-out, smart-tag chips on every entity, motion-preference handling that gracefully degrades pulses and trip particles when the OS reports `prefers-reduced-motion`.

### `artifacts/scenario-brief/` — Operational scenario brief (path `/scenario-brief`)
14-slide deck (Title, Problem, Mission, Architecture, Data Model, Live Ops, Engine, Scenarios, Walkthrough, Copilot, Decisions, Roles, Compare, Demo) in the same USMC scarlet-and-gold palette as the main app. Mirrors and extends the in-app Scenario Console.

### `artifacts/marines-opener/` — DHA Iron Vein leadership opener (path `/marines-opener`)
3-slide opener (Title / Hook → Stakes → What We Deliver) designed to land in 90 seconds before the live demo. Same visual system as the main app.

### `artifacts/api-server/` — Backend (path `/api`)
Express + Drizzle. Serves the OpenAPI contract, the typed REST surface, the deterministic sim, the AI orchestrator, the seed and Supply Demo import pipelines, the export helpers, the auth + MFA flow, and the audit log.

### `artifacts/mockup-sandbox/` — Design preview (internal)
Variant preview server used by the design subagent. Not part of the user-facing product.

---

## Quick start

Prerequisites: pnpm (managed by Replit), a PostgreSQL `DATABASE_URL`, the `DATA_ENCRYPTION_KEY` Replit Secret, and the AI integration env vars (auto-provided in this Replit).

```bash
pnpm install
pnpm --filter @workspace/db run db:push                       # create tables
pnpm --filter @workspace/api-server tsx src/seed/run.ts       # seed network + catalog
pnpm run security:verify                                      # prove encryption + role gates

# Workflows configured in this Replit (auto-started):
#   artifacts/api-server: API Server          → /api/*
#   artifacts/command: web                    → /
#   artifacts/scenario-brief: web             → /scenario-brief
#   artifacts/marines-opener: web             → /marines-opener
#   artifacts/mockup-sandbox: Preview         → (internal, design)
```

The preview pane routes automatically. The operations app loads at `/`, the leadership opener at `/marines-opener`, the scenario brief at `/scenario-brief`.

---

## Architecture at a glance

```
        ┌────────────────────────────────────────────────────────┐
        │  command (React + Vite)  →  "/"                        │
        │  Overview · Network · Locations · Site/Item Detail     │
        │  Orders · Casualty · Procedures · Scenarios · Copilot  │
        │  Tags · Data Admin · Settings · Profile                │
        │  Header: FPCON pill · Role switcher · Cmd-K · Alerts   │
        └─────────────┬──────────────────────────────────────────┘
                      │  REST (typed via orval-generated React Query client)
                      │  Replit OIDC + TOTP MFA cookie session
                      ▼
        ┌────────────────────────────────────────────────────────┐
        │  api-server (Express)  →  /api/*                       │
        │  auth · mfa · profile · settings · health              │
        │  network · sites · items · catalog · inventory         │
        │  suppliers · orders · alerts · activity · tags         │
        │  predictive · scenarios · casualty · procedures        │
        │  blood · overview · dashboard · copilot · admin        │
        │  admin/supply-import · exports                         │
        └────────┬─────────────────────────────┬─────────────────┘
                 │                             │
                 ▼                             ▼
        ┌──────────────────┐         ┌────────────────────────────┐
        │  lib/sim         │         │  lib/ai-orchestrator       │
        │  forecast        │         │  OpenAI gpt-5.4   │ swap   │
        │  recommendations │         │  Google           │ at     │
        │  cascades        │         │  gemini-2.5-pro   │ runtime│
        │  supplierImpact  │         │  prompts · tag-suggester   │
        │  staffing        │         │  Replit AI proxies         │
        │  casualty        │         │                            │
        └────────┬─────────┘         └────────┬───────────────────┘
                 │                            │
                 ▼                            ▼
        ┌────────────────────────────────────────────────────────┐
        │  lib/db (Drizzle + Postgres) — DMLSS-compatible        │
        │  Core: nodes · routes · items · catalog_entries        │
        │        inventory_balances · orders · order_lines       │
        │        shipments · alerts · activity_entries           │
        │        recommendations · scenarios · suppliers         │
        │        supplier_items · theater_zones · tags ·         │
        │        tag_assignments · profiles                      │
        │  Medical: patient_types · patient_item_requirements    │
        │           event_types · event_patient_mix              │
        │           procedures · procedure_supplies              │
        │           procedure_roles                              │
        │  Blood: blood_lots · cold_chain_assets · donor_pools   │
        │         temperature_events                             │
        │  Auth/Sec: users · sessions · user_mfa · audit_log     │
        │  Isolated import: supply_demo_v2_catalog               │
        │                   supply_demo_v2_facilities            │
        │                   supply_demo_v2_issues                │
        │                   supply_demo_v2_runs                  │
        └────────────────────────────────────────────────────────┘
```

---

## API surface

Selected; full contract in `lib/api-spec/openapi.yaml`. Every route except `/healthz`, the auth/MFA endpoints, and the OpenAPI doc requires an authenticated session with a fresh MFA verification.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`  | `/healthz` | Liveness |
| `GET`  | `/auth/user` · `GET /login` · `GET /callback` · `POST /logout` | Replit OIDC |
| `GET`  | `/mfa/status` · `POST /mfa/enroll/start` · `POST /mfa/enroll/verify` · `POST /mfa/verify` · `POST /mfa/reset` · `POST /mfa/recovery-codes/regenerate` | Microsoft Authenticator (TOTP) |
| `GET`  | `/profile` · `PATCH /profile` | Per-user identity and role |
| `GET`  | `/dashboard/overview` · `/dashboard/risk` · `/dashboard/blood-readiness` | KPI rollups |
| `GET`  | `/overview/cascade` · `/overview/leaderboard` · `/overview/cold-chain-pulse` · `/overview/activity-stream` · `/overview/mission-risk-matrix` · `/overview/ai-brief` | Command-bridge widgets |
| `GET`  | `/network/nodes` · `/network/routes` · `/network/snapshot` · `/network/zones` · `POST /network/zones` · `DELETE /network/zones/:zoneId` | Topology + ad-hoc theater zones |
| `GET`  | `/sites` · `/sites/:nodeId` · `/sites/:nodeId/blood-readiness` · `PATCH /sites/:nodeId/par` | Site directory + Blood Readiness + editable PAR |
| `GET`  | `/items` · `/items/:itemId` · `PATCH /items/:itemId` · `/items/:itemId/procedures` · `/catalog/items` · `/inventory/balances` · `/suppliers` | Catalog + supplier coverage |
| `GET`  | `/orders` · `POST /orders` · `GET /orders/:orderId` · `PATCH /orders/:orderId` · `PATCH /shipments/:shipmentId` | Orders board, role-gated PO creation, shipment progress + ETA edits |
| `GET`  | `/predictive/recommendations` · `POST /predictive/forecast` · `POST /predictive/recommendations/:id/promote` | Ranked re-supply, projection, single-click promote with companion-item bulk |
| `GET`  | `/scenarios` · `/scenarios/preset-events` · `POST /scenarios` · `POST /scenarios/preview` · `GET/PATCH/DELETE /scenarios/:scenarioId` | Scenario console + cascade simulation + supplier-impact |
| `POST` | `/casualty/evaluate` · `GET /patient-types` · `GET /event-types` · `GET /procedures` · `GET /procedures/:id` | Casualty-driven medical readiness |
| `GET/POST` | `/copilot/conversations` · `GET /copilot/conversations/:id` · `POST /copilot/conversations/:id/messages` | Streaming, grounded chat |
| `GET/POST` | `/tags` · `POST /tags/suggest` · `POST /tags/auto-tag` · `GET /tags/:slug` · `GET/POST/DELETE /tags/for/:entityType/:entityId` | Global smart tags |
| `GET`  | `/alerts` · `POST /alerts/:alertId/ack` · `GET /activity` | Live ops feed |
| `GET`  | `/exports/orders.csv` · `/exports/balances.xlsx` | Bulk exports |
| `POST` | `/admin/supply-import/run` · `/admin/supply-import/reconcile` · `/admin/supply-import/activate` · `/admin/supply-import/rollback` · `GET /admin/supply-import/status` · `POST /admin/reseed` · `GET /admin/seed-status` | Admin (intended for analyst-tier operators; routes are mounted behind the same `requireAuth` + MFA gate as the rest of the API) |

`POST /orders`, `PATCH /orders/:orderId`, and the promote-to-PO flow are explicitly gated by `requireRole("commander", "logistician")` middleware. Analyst and Medical Planner sessions return `403` from the API and have the corresponding buttons hidden in the UI. Other write endpoints inherit the baseline `requireAuth` + MFA-fresh session gate; role gating beyond that is documented per-route in the OpenAPI spec.

---

## Roles & DMLSS posture

The role switcher (top-right, persisted per-user in the DB after login) re-weights the dashboard and gates write actions:

- **Commander** — theater DOS, FPCON, top-risk hubs, decision recommendations, AI brief, mission-risk matrix.
- **Logistician** — orders pipeline, ETAs, route stress, shipment progress, exports; full PO authority.
- **Medical Planner** — Casualty Planner, blood readiness, procedure-driven recommendations, scenario console; cannot create POs.
- **Analyst** — full data admin, model switching, raw recommendations, audit trails; cannot create POs.

Documents (purchase orders, exports) are formatted to be drop-in compatible with DMLSS / MILSTRIP-style workflows.

---

## Engineering notes

- **TypeScript end-to-end**, single source of truth: OpenAPI → orval → typed React Query hooks for the client and Zod schemas for server validation. Drift between client and server is impossible — it would fail typecheck.
- **Pure-function sim** (`lib/sim`) — fully unit-testable, no I/O, no LLM dependence. The AI is additive, never load-bearing.
- **Provider-agnostic AI** — every AI call goes through `lib/ai-orchestrator` with a `provider` field; both OpenAI and Google Gemini are reached through Replit's AI Integrations proxy (no third-party keys, no PII leaving the perimeter).
- **Deterministic seed** — the same `pnpm seed` produces the same demo state each run; the Supply Demo import is reversible via a single rollback endpoint.
- **No emojis**, anywhere — military-professional visual register.
- **Reduced-motion aware** — every animated surface (map pulses, trip particles, leaderboard reorder, activity stream, sparklines, scenario cascade reveal) honors `prefers-reduced-motion` and the per-user map-animation toggle.

---

## Operational impact

DHA Iron Vein collapses workflows that today require hours of manual staffing — phone calls between hubs, spreadsheet drift, email chains, ad-hoc voice coordination — into a few clicks against a single common operating picture. What follows is what each role can now do *in seconds*, framed by what they can still do when the INDOPACOM theater is contested.

### Commander
A commander opening the **Command Overview** sees, in one frame: theater Vital Signs (viable blood units, blood DOS, cold-chain health, walking-blood-bank donors, reagent days, in-transit shipments, open alerts, pending recommendations) with delta arrows since the last refresh; an AI Brief naming the top risk, top recommended action, and top change since the last brief; a Mission-Risk Stoplight Matrix mapping notional missions to supply categories; a Time-to-Fail Leaderboard ranking the ten most-fragile sites; and a Constraint Cascade card calling out single-point-of-failure narratives. From here a commander can lift the FPCON to CHARLIE in one click and the whole theme reflects the posture; pivot to **Scenarios** and replay a Yokosuka cold-storage strike or a Luzon Strait sea-lane interdiction in seconds; and approve or reject a bulk re-supply for the most exposed hub from one card. **In a contested INDOPACOM environment** — degraded comms, kinetic strikes on hubs, supplier compromise, casualty surge — the commander never has to wait for a J4 staff call to know which spokes are about to go black on blood, which TLAMM has the depth to backstop them, and which scenario branch the engine recommends. The alternative — phoning each hub for hand-tabulated DOS, then waiting for a logistics shop to redraft a supply plan — is a tempo loss the platform eliminates.

### Logistician
A logistician working the **Orders Board** sees uniform cards with item, destination, source, quantity, units, priority, ETA, requested-delivery date, status, and a "Triggered by" line citing the recommendation or operator that created it. They can click any card to open the full PO envelope, edit the shipment ETA inline when the lift slips, drop a free-text note that lands as its own readable line in the activity history, and bulk-promote a recommended re-supply across multiple suppliers with a real per-supplier subtotal in the confirmation dialog. The recommendations rail filters out suppliers that don't carry the item, refuses to write a $0 PO, and surfaces the TLAMM as the primary source before falling back to commercial / host-nation alternatives. **In a contested environment** — denied airspace, port closure, supplier offline — the logistician can pivot the sourcing path in the same UI: the engine has already ranked the next-best supplier with the new ETA delta, the cascade card has already explained why the primary went dark, and the bulk-promote dialog turns the rerouting decision into a two-click action. Without the platform this same pivot is a hand-built sourcing matrix in Excel, a dozen emails to procurement, and hours of latency the patient cannot afford.

### Medical Planner
A medical planner opening the **Casualty Planner** picks an event (Major Combat, MASCAL, Typhoon, Pandemic) and the patient-type mix prefills with realistic defaults; entering expected casualty counts immediately produces required materiel grouped by Blood / Other Medical with sufficiency badges, the clinicians needed to cover the load, the PPE that staffing implies, per-item shortfall lines with the next-best supplier ranked against the patient arrival window, and patient-reroute suggestions naming nearby sites that *can* absorb the unmet subset with rationale. A single "Order everything still short for this site" button creates the bulk PO. Site Detail opens to a **Blood Readiness** tab with viable units by component and ABO, expirations at 24 h / 72 h / 7 d, cold-chain assets and fuel days, donor pool with walking-blood-bank by ABO, and testing supplies flagged as "constrains collection" or "constrains transfusion." **In a contested environment** — mass-casualty surge after a kinetic event, cold-chain failure under attack, reagent shortage cutting donor screening — the planner can answer "do we have what we need for 120 trauma casualties at Camp Foster in 48 hours, and if not, where do we send the patients?" in well under a minute. The alternative — phoning each MTF, manually tallying lots and donors, hand-checking reagent stock, then guessing at a reroute — is the workflow this platform was built to retire.

### Analyst
An analyst has the full **Data Admin**, the AI provider toggle, the recommendations stream with rationale strings citing real node and item IDs, the audit log of every write (who, what, when, from where), the **Tags** admin page with AI auto-tag batches and cross-entity rollups, and the Supply Demo import pipeline (run / reconcile / activate / rollback). The Copilot is strictly grounded in solution data and refuses anything outside it, so its citations are inspectable rather than hallucinated. **In a contested environment** — comms degraded, intel partial, decisions on a clock — the analyst can attribute every commander-visible number to its source row, swap providers if one degrades, re-run a scenario with new assumptions, and tag the resulting cluster of orders / sites / alerts as one named disruption that everyone else can navigate to with one click. The alternative is a brittle chain of spreadsheets and email threads that nobody can audit after the fact.

---

## How decision support becomes near-instantaneous

The platform reaches "seconds, not hours" by stacking five technical levers, each delivered by a specific module:

1. **Deterministic in-process projection** — `lib/sim` is a pure-TypeScript theater simulator (`forecast.ts`, `recommendations.ts`, `cascades.ts`, `supplierImpact.ts`, `staffing.ts`, `casualty.ts`). It runs in the API process with no external service hop and no LLM dependence; a 30-day projection across the network resolves in tens of milliseconds. Recommendations exist with or without the model.
2. **Provider-agnostic LLM rationale on top of structured output** — `lib/ai-orchestrator` is a strategy-pattern router (`provider.ts`, `prompts.ts`, `tag-suggester.ts`). It receives the sim's structured output as context and returns natural-language rationale, AI briefs, and tag suggestions. Provider is a per-request field (`openai` / `gemini`); both are reached through the Replit AI Integrations proxies (`lib/integrations-openai-ai-server`, `lib/integrations-gemini-ai`) with no third-party keys. The Copilot is locked to in-scope solution data and refuses everything else, so latency is spent answering, not hedging.
3. **Single typed contract eliminating drift** — `lib/api-spec/openapi.yaml` is the source of truth; `orval.config.ts` generates a typed React Query client (`lib/api-client-react`) and Zod schemas (`lib/api-zod`) used by the server for runtime validation. Adding a field is a one-place change; removing one fails typecheck on both sides. There is no glue layer to keep in sync.
4. **Pre-computed rollups with mutation-driven invalidation** — `artifacts/command` consumes the snapshot and overview endpoints exposed by `artifacts/api-server`. Rollups (theater Vital Signs, Time-to-Fail Leaderboard, Mission-Risk Matrix, Cold-Chain Pulse, Walking-Blood-Bank-by-ABO) are computed server-side, and the React Query client invalidates dependent queries as mutations land — so a promote-to-PO or a PAR edit refreshes the affected widgets in place rather than triggering a wholesale poll. The first paint draws skeletons; subsequent updates replace values without scroll jump.
5. **Persistent DMLSS-compatible data backbone with an isolated import lane** — `lib/db` carries the operational schema, the medical / blood / casualty extensions, the security tables, and the isolated `supply_demo_v2_*` staging schema. The Supply Demo importer (`artifacts/api-server/src/lib/supply-import/`) parses, dedups, reconciles, and activates ~389k rows without touching the operational tables until activation, and a single rollback endpoint reverses it cleanly.

The scenario console (in-app `/scenarios` plus `lib/sim/src/scenarios.ts`) and the leadership decks (`artifacts/scenario-brief`, `artifacts/marines-opener`) close the loop: the same engine that drives the live console drives the recorded brief, so what the commander rehearses in slides is what the platform actually does in the live tool.

---

## Module operating manual

For every module: **Objective → What it does → How it works in the software → AI involvement → Operating instructions → Contested-environment uplift.**

### 1. Live operations console — `artifacts/command/`

**Objective.** Give every operator a single common operating picture for the INDOPACOM Class VIII supply chain, framed for their role.

**What it does.** Surfaces theater rollups, the live network, every site and item drill-down, the orders pipeline, the casualty planner, procedures, scenarios, the copilot, smart tags, data admin, profile, and settings. Provides the FPCON pill, role switcher, Cmd-K palette, alerts rail, smart-tag chips, and motion-preference handling shared across every page.

**How it works in the software.** React + Vite app routed by `wouter` from `artifacts/command/src/App.tsx`. Layout in `components/layout/Layout.tsx` with `FpconPill.tsx` in the header (state in `localStorage`, broadcast via a custom event), `RoleBadge.tsx` for role switching, `SearchPalette.tsx` for Cmd-K (sites / items / suppliers / orders / scenarios / tags), `AlertsRail.tsx` for the slide-out feed. Pages live under `pages/`: `CommandOverview`, `NetworkMap`, `Locations`, `SiteDetail`, `ItemDetail`, `OrdersBoard`, `OrderDetail`, `CasualtyPlanner`, `Procedures`, `Suppliers`, `Scenarios`, `Copilot`, `Tags`, `DataAdmin`, `Settings`, `Profile`. Theme tokens in `src/index.css` (USMC scarlet `#BA0C2F`, gold `#FFCC00`, deep neutral background, layered surfaces). All data flows through the orval-generated typed React Query hooks against `/api/*`. CSV / XLSX exports through `lib/exports`. Print-ready DMLSS-style POs render in `OrderDetail` with a printer icon shortcut from the Orders Board. Reduced-motion handled by `hooks/use-reduced-motion.tsx` plus per-user toggles persisted on the profile.

**AI involvement.** The console itself is presentation. AI participates only where the underlying endpoint is AI-backed: the **Command Overview AI Brief card** consumes `/api/overview/ai-brief`, **scenario brief narratives** consume the scenarios endpoint, **smart-tag suggestions** consume `/api/tags/suggest`, the **Copilot page** streams from `/api/copilot/conversations/:id/messages`. Every AI-derived surface carries the "Powered by AI" badge.

**Operating instructions.** Sign in via the Sign-in screen, complete the Microsoft Authenticator second factor (or enroll on first login by scanning the QR with Microsoft Authenticator / Google Authenticator and downloading the 10 recovery codes). The Overview opens by default. Use the persona tab strip to reorder widgets for Commander / Logistician / Medical Planner / Analyst. Use the FPCON pill to lift posture. Press `⌘K` / `Ctrl-K` to jump anywhere. Click any tag chip to see every record carrying that tag. Click any leaderboard row to land on the corresponding Site Detail Blood Readiness tab.

**Contested-environment uplift.** When INDOPACOM goes contested, every minute the operator spends switching tools is a minute the supply chain is invisible. The console keeps the supply picture, the scenarios, the AI brief, the orders pipeline, and the casualty planner inside one shell with one auth, one theme, and one keyboard shortcut to reach any entity. FPCON-from-header makes posture changes a single click instead of a comms loop. Reduced-motion handling and a tactical list-view fallback when WebGL is unavailable mean the console keeps working in low-bandwidth or hardened-thin-client conditions. The alternative — three browser tabs, two spreadsheets, and a phone — collapses under contested-comms pressure exactly when the theater needs it most.

### 2. Predictive sustainment engine — `lib/sim/` and `/api/predictive/*`

**Objective.** Project Days-of-Supply (DOS) and time-to-fail across every (site, item) pair for the next 30 days, deterministically and without external dependencies.

**What it does.** Computes daily burn from PAR × encounter rate × per-patient bill-of-materials × waste factor; layers in confirmed inbound shipments and lead times; emits per-site per-item DOS, days-to-fail, and ranked replenishment recommendations. Honors editable PAR per site so commanders can model surge without reseeding.

**How it works in the software.** Pure-function modules in `lib/sim/src/`: `forecast.ts` (per-day projection), `recommendations.ts` (ranked re-supply COAs with sourcing path), `staffing.ts` (clinician + PPE math), `casualty.ts` (event → patient mix → required materiel), `cascades.ts` (cold-chain, reagent, airlift secondary effects), `supplierImpact.ts` (scenario-time supplier degradation), `network.ts` (graph / route helpers), `risk.ts` (theater rollups). Exposed by `artifacts/api-server/src/routes/predictive.ts` at `GET /api/predictive/recommendations`, `POST /api/predictive/forecast`, and `POST /api/predictive/recommendations/:id/promote` (with companion-item bulk-promote and supplier-carries gating). Recommendations carry rationale strings that name node / item / supplier IDs; cost is rendered with two decimals via `formatCurrency`.

**AI involvement.** The engine itself is fully deterministic. The AI is layered on top: `lib/ai-orchestrator` consumes the structured `RecommendationEnvelope` and produces a natural-language rationale and the AI Brief on the Overview. Removing the model leaves the recommendations intact.

**Operating instructions.** Open Site Detail → Recommended Actions to see ranked COAs with the sourcing path (TLAMM-first, supplier alternatives, cost, ETA, rationale). Click "Promote" to open the Promote dialog; the supplier dropdown is gated to suppliers that actually carry the item; the bulk-promote toggle adds Primary-tier companion supplies. Edit Population at Risk inline on Site Detail to model a surge — every dependent number recomputes within the next refresh.

**Contested-environment uplift.** Deterministic, in-process projection gives the staff a re-plan in tens of milliseconds whether the AI is reachable or not. When commercial LLM endpoints flap or the perimeter goes hard, the recommendations still rank, the rationale still names the source row, the promote-to-PO still works. The alternative — a sustainment shop rebuilding burn projections in Excel after a cascading failure — costs the theater hours per re-plan; here it costs the operator a click.

### 3. AI orchestrator and Copilot — `lib/ai-orchestrator/` and `/api/copilot/*`

**Objective.** Provide a provider-agnostic LLM bridge that adds rationale, narrative, and natural-language Q&A on top of structured solution data, without ever leaving the Replit perimeter for keys.

**What it does.** Routes every AI call to OpenAI **gpt-5.4** or Google **gemini-2.5-pro** via a per-request `provider` field. Hosts the Copilot system prompt (locked to in-scope solution data), the smart-tag suggester, the AI Brief generator, and the scenario narrative generator.

**How it works in the software.** `lib/ai-orchestrator/src/provider.ts` exposes `streamChat` and `completeChat` against both providers via `lib/integrations-openai-ai-server` and `lib/integrations-gemini-ai`. `prompts.ts` carries the strict-grounding system prompt: in-scope is nodes, items, suppliers, orders, shipments, alerts, recommendations, scenarios, forecasts, risk/DOS, activity, theater state — everything else gets a one-sentence polite refusal plus 2–3 example in-scope prompts. `tag-suggester.ts` takes a structured entity record plus the existing tag library and returns strict JSON `{ tag, isNew, rationale, confidence }`. `types.ts` carries `DEFAULT_OPENAI_MODEL = "gpt-5.4"` and `DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"`. The Copilot endpoint is `artifacts/api-server/src/routes/copilot.ts`; tag endpoints are in `routes/tags.ts`; the AI Brief endpoint is `routes/overview.ts` (`/overview/ai-brief`).

**AI involvement.** This module *is* the AI. Inputs are always structured (a recommendation envelope, a tag-target summary, a scenario result, the current snapshot). Outputs are short, cited, and stripped of model self-reference. The Copilot is rate-limited and audit-logged.

**Operating instructions.** From the Copilot page, ask any solution-grounded question ("Which sites are below 5 days viable blood DOS?", "What's in flight to Bagram?", "Summarize open critical alerts"). Toggle provider in Settings. From any detail view (Site, Item, Supplier, Order, Shipment, Scenario, Alert, Blood Lot) click "Suggest tags" — review and accept or dismiss each suggestion. From the Tags admin page run an "Auto-tag a batch" pass over recent or untagged records.

**Contested-environment uplift.** A single failure of one provider does not blind the platform — the toggle moves traffic to the other in one click, and every AI surface is additive on top of deterministic output, so a full LLM outage degrades the platform to "no rationale strings" rather than "no recommendations." The strict-grounding rule prevents the Copilot from inventing nodes or items under pressure, which is the failure mode that gets people killed in real ops.

### 4. Scenario console and cascade simulation — `/scenarios` + `lib/sim/src/scenarios.ts` + `/api/scenarios/*`

**Objective.** Let any operator replay a contested INDOPACOM event against the live data and see the secondary effects, the supplier rerouting, and the recommended counter-actions.

**What it does.** Ships a curated catalog of preset events ordered war-first (PRC Taiwan blockade, Senkaku/Diaoyu kinetic incident, anti-access denial of CONUS resupply, Luzon Strait sea-lane interdiction, Yokosuka strike-package, undersea cable cut + comms denial, then degraded-comms / cyber, then logistics disruptions, then weather / typhoon last) and a custom builder with affected nodes, theater zones, perturbation sliders (population multiplier, encounter multiplier, route delay days, route reliability delta, waste multiplier, horizon days), and **impacted suppliers** with capacity multiplier, lead-time delta, reliability delta, and outage days. Cascades: cold-chain failure ages and condemns blood lots; reagent shortage throttles donor screening; airlift loss extends transit and shrinks viable units arriving.

**How it works in the software.** Page at `artifacts/command/src/pages/Scenarios.tsx` with builder panel and a `ScenarioResult` panel rendering AI brief, per-node table, per-item table, timeline (Recharts), recommendations, cascade story, and a Supplier Impact section. Server at `artifacts/api-server/src/routes/scenarios.ts` (list / preset-events / preview / run / save / get / patch / delete). Engine at `lib/sim/src/scenarios.ts` calling `cascades.ts` (cold-chain, reagent, airlift) and `supplierImpact.ts` (per-supplier degradation honoring outage duration vs. horizon). Persisted to the `scenarios` table; saved scenarios re-run with the same impacted-supplier configuration. Tooltips on every builder field.

**AI involvement.** The cascade and recommendation math is deterministic. The AI orchestrator generates the natural-language brief and cascade story from the structured result; both surfaces carry the AI badge.

**Operating instructions.** From `/scenarios` click a preset card or open the builder. In the builder, name the scenario, pick a kind, multi-select affected nodes from the dropdown, optionally select theater zones, set perturbation sliders, optionally flag impacted suppliers (manually or auto-flagged by zone/country with override). Click "Run Scenario." Review the AI brief, per-node and per-item impact tables, the timeline, the recommendations, and the Supplier Impact section. Save to replay later.

**Contested-environment uplift.** Cascades are exactly the failure modes a peer adversary will try to force: cold-storage strikes on the regional freezer farm, reagent shortages that knock Pacific donor screening offline, airlift denial that pushes sea-lift past viability, supplier compromise that takes the primary source dark. The console makes the consequences visible in seconds — including the named alternative supplier that should be engaged and the cost / ETA delta — before the kinetic event happens. Without it, the staff is reverse-engineering the cascade on whiteboards while patients wait.

### 5. Data backbone — `lib/db/`

**Objective.** Carry every piece of state the platform reasons over, in a DMLSS-compatible shape, with an isolated lane for large external imports.

**What it does.** Defines the operational schema (nodes, routes, items, catalog_entries, inventory_balances, orders, order_lines, shipments, alerts, activity_entries, recommendations, scenarios, suppliers, supplier_items, theater_zones, tags, tag_assignments, profiles), the medical extensions (patient_types, patient_item_requirements, event_types, event_patient_mix, procedures, procedure_supplies, procedure_roles, plus `nodes.role` for echelon-of-care), the blood foundation (blood_lots, cold_chain_assets, donor_pools, temperature_events), the security tables (users, sessions, user_mfa, audit_log), and the isolated Supply Demo import schema (`supply_demo_v2_catalog`, `supply_demo_v2_facilities`, `supply_demo_v2_issues`, `supply_demo_v2_runs`).

**How it works in the software.** Drizzle ORM modules under `lib/db/src/schema/` (`network.ts`, `items.ts`, `inventory.ts`, `orders.ts`, `operational.ts`, `recommendations.ts`, `alerts.ts`, `activity.ts`, `scenarios.ts`, `suppliers.ts`, `theater_zones.ts`, `procedures.ts`, `casualty.ts`, `blood.ts`, `tags.ts`, `profile.ts`, `auth.ts`, `mfa.ts`, `messages.ts`, `conversations.ts`, `snapshots.ts`, `supply_demo_v2.ts`, `catalog.ts`, `settings.ts`, plus `index.ts`). Seed pipeline at `artifacts/api-server/src/seed/run.ts` driven by `lib/db/seed-data/dataset.xlsx` and `medical_supply_inventory.csv`. Supply Demo import pipeline at `artifacts/api-server/src/lib/supply-import/` with parse → dedup → reconcile → activate → rollback phases, documented in `docs/supply-demo-import.md`. Sensitive columns (profile email, contact info, settings secrets, scenario narratives, order shipping/contact, MFA secret) are stored as `bytea` ciphertext via `pgcrypto` keyed from the `DATA_ENCRYPTION_KEY` Replit Secret.

**AI involvement.** None directly — the data layer is mechanical. AI consumers (Copilot context, AI Brief, tag suggester, scenario narrative) read structured snapshots from this layer.

**Operating instructions.** Initial setup: `pnpm --filter @workspace/db run db:push` then `pnpm --filter @workspace/api-server tsx src/seed/run.ts`. From Data Admin: monitor table row counts, storage size, vacuum/analyze health; trigger `Supply Import → Run / Reconcile / Activate / Rollback` to bring the imported facilities and catalog entries onto the live map and inventory; re-seed for a clean demo state. Verify encryption with `pnpm run security:verify`.

**Contested-environment uplift.** A persistent, typed, encrypted-at-rest backbone is the difference between a tool that survives a sustained operation and a demo that breaks under load. The isolated `supply_demo_v2_*` schema means the staff can ingest a real DMLSS-compatible feed without ever touching the operational tables — and roll it back cleanly if it lands wrong — so the platform stays usable while data is moving. Encryption keyed from a Replit Secret means a host compromise does not yield human-readable PII, contact info, or AI keys in a `pg_dump`.

### 6. API server and contract — `artifacts/api-server/` + `lib/api-spec/`

**Objective.** Be the single typed surface every other component talks to, with the OpenAPI contract as the source of truth.

**What it does.** Hosts every REST endpoint listed in [API surface](#api-surface). Validates every request and response against the spec. Generates the typed React Query client and the Zod schemas the server itself uses for runtime validation. Mounts the auth + MFA routes, the audit log, the security headers, the rate limits, and CORS / CSRF.

**How it works in the software.** Express app in `artifacts/api-server/src/app.ts` with Helmet (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), `express-rate-limit` on auth and write endpoints, double-submit CSRF, structured pino audit logs on every write. Route modules under `src/routes/` (24 route files covering every domain). OpenAPI contract at `lib/api-spec/openapi.yaml`; `orval.config.ts` generates `lib/api-client-react/src/generated/api.ts` (React Query hooks) and `lib/api-zod/src/generated/` (Zod schemas + TS types).

**AI involvement.** None. The contract carries the AI endpoints (`/copilot/*`, `/tags/suggest`, `/overview/ai-brief`) but the server itself is mechanical.

**Operating instructions.** When adding a field, edit `openapi.yaml`, run codegen, update the route handler, redeploy. When checking the API directly, hit `https://${REPLIT_DEV_DOMAIN}/api/healthz` for liveness and `/api/dashboard/overview` for the same payload the Overview consumes. Authenticated routes require the cookie session and a fresh MFA verification; unauthenticated calls return `401`.

**Contested-environment uplift.** A single typed contract means a hot-fix shipped under pressure cannot drift the client and the server. Helmet, rate limits, CSRF, audit logs, and lockout-on-MFA-failure mean the surface holds up against the kind of probing that comes with a contested information environment. The alternative — bespoke per-route validation, ad-hoc client types, no audit — is exactly the surface that gets compromised first.

### 7. Auth + security posture — Replit OIDC + TOTP MFA + role-based PO permissions + at-rest encryption

**Objective.** Keep the platform safe enough to run in front of senior leadership and recognizable as a DoD-style decision-support tool.

**What it does.** Forces every visitor through Replit OIDC sign-in. Forces a Microsoft Authenticator (TOTP, RFC 6238, ±1 step drift) second factor on every fresh session, with one-time enrollment (QR + manual key + 10 downloadable recovery codes), lockout after 5 failures in 5 minutes, and audit-logged enroll / success / failure / reset events. Binds profile and role to the logged-in user. Gates `POST /orders`, `PATCH /orders/:orderId`, and the promote-to-PO flow to `commander` and `logistician` roles. Encrypts sensitive columns at rest. Enforces transit security with HSTS, strict CSP, secure cookies, and CORS locked to the deployed origin. Sessions and MFA verification last a single 12-hour absolute window with no idle timeout — so a logged-in operator will not get bounced mid-presentation.

**How it works in the software.** Auth and MFA routes at `artifacts/api-server/src/routes/auth.ts` and `routes/mfa.ts`. Schema at `lib/db/src/schema/auth.ts` and `mfa.ts`. Web client at `lib/replit-auth-web` plus `<MfaGate>` wrapper in the command app. `requireAuth` and `requireRole(...)` middleware applied in `routes/index.ts`. Encryption helpers in `lib/db` using `pgcrypto` + `DATA_ENCRYPTION_KEY` Replit Secret. SECURITY.md at the repo root documents the threat model, controls, key rotation, and any waived dependency findings. `pnpm run security:verify` proves on-disk ciphertext is unreadable, the application path decrypts correctly, an Analyst session is `403` on order creation, an MFA-unverified Logistician session is `401 mfa_required`, and HTTPS responses include `Strict-Transport-Security`.

**AI involvement.** None. AI surfaces inherit the same auth gates as everything else.

**Operating instructions.** First login: complete Replit OIDC, then scan the QR with Microsoft Authenticator (or any RFC 6238 TOTP app), enter the first 6-digit code, download the 10 recovery codes. Subsequent logins: enter a fresh 6-digit code. From Profile: regenerate recovery codes, reset the authenticator, sign out. Admin: rotate `DATA_ENCRYPTION_KEY` per the SECURITY.md procedure.

**Contested-environment uplift.** Sign-in plus a second factor plus role-gated PO authority means a stolen session cookie is not enough to write a PO that diverts material — the attacker also needs the operator's authenticator, and a Medical Planner / Analyst session is structurally incapable of writing orders. At-rest encryption keyed from a Replit Secret means a database snapshot does not yield PII or AI keys. The 12-hour absolute lifetime with no idle-out lets the platform survive a long demo or a long watch shift without forcing re-auth in the middle of a decision. The alternative — a single shared persona with no MFA, no role gating, and plaintext PII — is the posture this task explicitly retired.

### 8. Casualty-driven medical readiness — `/casualty` + `/api/casualty/*` + `/api/procedures/*`

**Objective.** Let an operator answer "do we have what we need for *N* casualties of *this mix* arriving at *this site* in *this window*, and if not, where do we send the patients?"

**What it does.** Picks an event type (Earthquake, Typhoon, Pandemic, Major Combat, Counter-Insurgency, MASCAL) which prefills a default patient mix (Trauma–Severe / Moderate / Minor, Burn, Pediatric, Medical/Disease, OB, Routine). Operator overrides counts and an optional resupply ETA. Computes required materiel grouped by Blood / Other Medical with per-item sufficiency badges (green / amber / red), clinician staffing math (surgeons / nurses / techs), derived PPE demand (gloves / masks / gowns / eye protection), per-item shortfall list with the next-best supplier ranked against the patient arrival window, and patient-reroute suggestions (nearby sites that can absorb the unmet subset, ranked by sufficiency + distance + residual capacity, each with a rationale string). One "Order everything still short for this site" button creates a bulk PO across the right suppliers. Procedures are first-class: each procedure carries Primary / Secondary / Tertiary supply tiers and is tagged with Roles 1 / 2 / 3 of care; demand sites carry a Role badge.

**How it works in the software.** Page `artifacts/command/src/pages/CasualtyPlanner.tsx` plus a Procedures page at `pages/Procedures.tsx`. Endpoints at `artifacts/api-server/src/routes/casualty.ts` (`POST /casualty/evaluate`, `GET /patient-types`, `GET /event-types`) and `routes/procedures.ts` (`GET /procedures`, `GET /procedures/:id`, `GET /items/:itemId/procedures`). Engine in `lib/sim/src/casualty.ts` and `staffing.ts`, with `evaluateSiteSufficiency` and `suggestPatientReroutes` reusing `rankSuppliersForShortfall`. Schema in `lib/db/src/schema/casualty.ts` and `procedures.ts` (`patient_types`, `patient_item_requirements`, `event_types`, `event_patient_mix`, `procedures`, `procedure_supplies`, `procedure_roles`). New Order dialog renders a "Companion supplies for this procedure" panel when the picked item is procedure-driving; the recommendations rail surfaces `+N companion supplies` chips and a "Promote with companion supplies" toggle in the Promote dialog.

**AI involvement.** The math is deterministic. The reroute rationale strings and the bundled-recommendation summary can be augmented by the AI orchestrator on demand, but no decision math depends on the model.

**Operating instructions.** Open `/casualty` (or the embedded panel on Site Detail), pick an event, accept or override the patient mix, optionally enter a resupply ETA, run the evaluation. Review required materiel grouped by class with the Blood / Medical / Both toggle, sufficiency badges, clinician + PPE block, and shortfall list. Click any shortfall to promote the next-best supplier individually, or click "Order everything still short for this site" for the bulk path. Use the patient-reroute panel to identify a destination MTF that can absorb the unmet load.

**Contested-environment uplift.** Mass-casualty surge after a kinetic event is the canonical INDOPACOM medical contingency. The planner makes the receiving picture concrete in seconds: which supplies will run out, when, who can backstop them, and which neighboring MTF is the right reroute target with a rationale a commander can read aloud. The alternative — phoning each MTF, hand-tallying lots and reagents, guessing at a reroute, then drafting the bulk PO by hand — is a multi-hour workflow under conditions that do not afford hours. The procedure model also catches the "we have the blood but not the crossmatch kits" failure mode the legacy stock-only model misses entirely.

### 9. Blood readiness — `/sites/:nodeId` Blood Readiness tab + Network Blood Products lens + `/api/blood/*`

**Objective.** Make the blood-products picture (per-unit viability, cold chain, donors, testing supplies) the default lens for a blood-products-first decision tool.

**What it does.** Site Detail opens to a Blood Readiness tab that shows: viable units by component and ABO with expirations at 24 h / 72 h / 7 d and viable DOS; cold-chain assets with current temperature, NOMINAL / EXCURSION / FAILED status, generator presence, fuel days, and a node-level health percent; donor pool with eligible donors, weekly collection capacity, an effective-capacity readout that flags reagent constraints, and walking-blood-bank chips by ABO; testing & collection supplies with on-hand, days-of-supply, criticality, and "constrains collection" or "constrains transfusion" badges. The Network Map defaults to the Blood Products layer with sub-layers for LTOWB, PRBC, FFP / Plasma, Platelets, Cryo, FDP. A Blood Readiness sidebar widget on the Network page shows tier counts (Critical / Watch / Nominal), the top 5 most-fragile sites, and click-throughs into the Site Detail Blood Readiness tab. The Command Overview Walking-Blood-Bank-by-ABO chip strip and Cold-Chain Pulse waveform expose the same picture at the theater rollup level.

**How it works in the software.** Components in `artifacts/command/src/components/site/blood/` (`BloodReadinessTab.tsx`, `ViableUnitsPanel.tsx`, `ColdChainPanel.tsx`, `DonorPoolPanel.tsx`, `TestingSuppliesPanel.tsx`). Endpoints at `artifacts/api-server/src/routes/blood.ts` (`GET /api/sites/:nodeId/blood-readiness`, `GET /api/dashboard/blood-readiness`) plus theater rollups in `routes/dashboard.ts` and `routes/overview.ts`. Schema in `lib/db/src/schema/blood.ts` (`blood_lots`, `cold_chain_assets`, `donor_pools`, `temperature_events`).

**AI involvement.** None directly; the blood data feeds the Copilot and AI Brief context.

**Operating instructions.** From Network, click a fragile site in the Blood Readiness widget. Site Detail opens to the Blood Readiness tab. Read viability by component / ABO; check cold-chain status and fuel days; check the donor pool with the WBB chip strip; verify testing supplies aren't constraining the pipeline. Use the recommendations rail at right to promote a re-supply.

**Contested-environment uplift.** Blood is the long pole. Cold-chain failure under attack, reagent shortage that gates donor screening, and walking-blood-bank capacity gaps are exactly the failure modes a peer-conflict casualty surge will exploit. Surfacing per-unit viability (not just on-hand), generator fuel days, and reagent constraints lets the staff see the failure before it lands. Without it, the commander learns about a cold-chain break when the BAS reports they cannot transfuse — too late.

### 10. Network layers — `/network` + Layers panel + Theater Zones + TLAMM hubs

**Objective.** Give operators a real operations-grade map of the INDOPACOM AOR with meaningful, configurable layers and AOR-aware sourcing.

**What it does.** Renders the full official USINDOPACOM AOR with deck.gl + MapLibre dark-matter basemap, threat-tier-colored nodes (green / amber / red), animated trip particles for in-transit shipments, 3D arcs for routes, ad-hoc theater zones drawn by operators, and a TLAMM-distinct marker treatment. Layers panel: grouped expandable layer groups (Blood Products, Supplies, Custom) with sub-layers driven by the actual catalog (Blood Products → LTOWB / PRBC / FFP-Plasma / Platelets / Cryo / FDP; Supplies → PPE / Testing / Cold-Chain / Transfusion / Phlebotomy). PPE folded into Supplies. Custom Layer builder with name, color, and item picker; persists per browser via `localStorage`. Per-layer in-flight shipment count badge. Search box at the top of the Layers panel. The Layers panel defaults to Blood Products. The Blood Readiness sidebar widget shows tier counts and top fragile sites with click-through. Theater Zones panel for ad-hoc drawing. TLAMM hubs are a first-class concept: a site can be marked as a TLAMM for one or more AORs, each MTF has a designated primary TLAMM, and the recommendation engine sources from the MTF's TLAMM first before falling back to outside suppliers; the TLAMM Stockpile tab on a TLAMM site shows downstream exposure.

**How it works in the software.** Page `artifacts/command/src/pages/NetworkMap.tsx`, deck.gl scene in `components/Map.tsx`, layer panel state in component-local hooks + `localStorage`. Server snapshots at `artifacts/api-server/src/routes/network.ts` (`GET /network/snapshot`, `GET /network/zones`, `POST /network/zones`, `DELETE /network/zones/:zoneId`). Schema for zones in `lib/db/src/schema/theater_zones.ts`. TLAMM data on `lib/db/src/schema/network.ts` (`isTlamm`, `aorId`, `primaryTlammNodeId`).

**AI involvement.** None on the map directly. The AI Brief on the Overview reads the same snapshot and may name fragile hubs in narrative form.

**Operating instructions.** Open `/network`. The map opens centered on USINDOPACOM with the Blood Products layer on by default. Search for a layer in the Layers panel to filter. Expand a group to pick sub-layers. Click "+ Custom Layer" to build your own. Click a node for the popup (name, type, country, threat tier, current DOS, top critical items, last shipment, action buttons). Use Theater Zones to draw an ad-hoc zone. Click a TLAMM hub to open its Stockpile tab.

**Contested-environment uplift.** When supply lines are stretched and the AOR is contested, "where is the material flowing, what's degraded, and which TLAMM still has depth" is the question the staff cannot afford to lose. A configurable layer system that scales beyond four flat toggles, a Blood Products default lens, and TLAMM-first sourcing turn the map from a screensaver into a live decision surface. The alternative — a static topology diagram and tribal knowledge of which hub stocks what — does not survive contact.

### 11. Orders + recommendations — `/orders` + `/orders/:id` + recommendation rail + `/api/orders/*`

**Objective.** Move material end-to-end with full traceability from "engine recommended this" through "PO printed" to "shipment received," with role-gated authority.

**What it does.** Orders Board kanban with uniform cards (item, destination name, source/supplier name, quantity with units, priority badge, ETA, requested-delivery date, status, "Triggered by" line). Click any card to open `/orders/:id` with the full envelope, line items, supplier info, route/ETA, the recommendation that triggered it, full activity history with milestones and notes formatted as a separate readable line, and a Print PO button. Shipment progress and ETA are editable inline. Recommendations are filterable and gated to suppliers that actually carry the item; bulk-promote is supported with per-supplier subtotals in the confirmation dialog. POs refuse to write if the computed total is $0; cost is rendered with two decimals.

**How it works in the software.** Pages at `artifacts/command/src/pages/OrdersBoard.tsx`, `pages/OrderDetail.tsx`, `pages/PurchaseOrder.tsx`. Promote dialog at `components/PromoteDialog.tsx`; New Order dialog at `components/orders/NewOrderDialog.tsx` with region-grouped destination picker, low-stock filter, on-hand surfaced in the picker, units everywhere, supplier-carries gating. Server at `artifacts/api-server/src/routes/orders.ts` (`GET /orders`, `POST /orders`, `GET /orders/:orderId`, `PATCH /orders/:orderId`, `PATCH /shipments/:shipmentId`) with `requireRole("commander", "logistician")` on writes. Server-side total computation reads `items.unit_price_usd`. Activity history milestones and notes from `lib/db/src/schema/activity.ts`.

**AI involvement.** Recommendations carry an AI-derived rationale string (composed by the orchestrator on top of the deterministic engine output). "Triggered by" lines on AI-promoted orders carry the AI badge. The order math itself is mechanical.

**Operating instructions.** From a recommendation rail (Site Detail, Casualty Planner, Recommendations list), click "Promote." The supplier dropdown lists only suppliers that carry the item; toggle "Promote with companion supplies" to bundle the Primary tier; review the per-supplier subtotal; confirm. The order lands on the board. Click any card to open `/orders/:id`; edit the shipment ETA inline when the lift slips; drop a free-text note that lands as its own activity line. Print the PO via the printer icon.

**Contested-environment uplift.** When a supplier goes dark or a lift slips, the platform makes the rerouting decision two clicks: the recommendation engine has already named the next-best supplier with the new ETA delta; the bulk-promote dialog turns the multi-supplier PO into a single confirmed action; the editable ETA and note thread mean the staff stays synchronized without a parallel email chain. Role gating means an analyst cannot accidentally — or maliciously — issue a PO under pressure. The alternative is a dozen emails and a hand-built PO under a clock the casualty cannot afford.

### 12. Scenario brief deck — `artifacts/scenario-brief/`

**Objective.** Walk a judge or O-6+ leadership audience through the full DMO scenario in 14 slides without leaving the same visual identity as the live tool.

**What it does.** A 14-slide deck (Title, Problem, Mission, Architecture, Data Model, Live Ops, Engine, Scenarios, Walkthrough, Copilot, Decisions, Roles, Compare, Demo) in the USMC scarlet-and-gold palette on a deep tactical background, full-frame slides, no `.map()` or `<br/>` in the JSX, registered in the slides manifest with contiguous positions.

**How it works in the software.** Vite-served slides at `artifacts/scenario-brief/src/pages/slides/` driven by `App.tsx`, `slideLoader.ts`, and a manifest in `src/data/`. Validate-slides script under `scripts/`. Theme tokens in `src/index.css` synced to the main app.

**AI involvement.** None — the deck is authored copy.

**Operating instructions.** Open `/scenario-brief/` in the preview pane. Use the standard slide navigation; PPTX export available per the slides skill.

**Contested-environment uplift.** The deck makes the platform's value defensible to a senior audience under time pressure. A staff officer with five minutes can hand the deck to a leader, then drive the live tool through the same scenarios — what was rehearsed in slides is what the engine actually does. That alignment between the rehearsed brief and the live capability is the difference between a credible decision-support claim and slideware.

### 13. Marines leadership opener — `artifacts/marines-opener/`

**Objective.** In ≤ 90 seconds, set up the live demo for senior leadership: land the stakes and the promise, then hand off.

**What it does.** Three slides in the same USMC scarlet-and-gold visual system as the main app and the scenario brief: (1) Title / Hook with DHA Iron Vein branding, Marines + INDOPACOM AOR framing, single-sentence value proposition; (2) Stakes — scenario spectrum from HADR/typhoon through mass-cas surge, cold-chain break, SLOC closure / PRC contingency, forward BAS / EABO push, cyber / comms denial — paired with the shortfalls each induces; (3) What We Deliver — breadth of medical materiel coverage and network footprint plus the one-line capability claim ("Predict → Simulate → Recommend → Act") and a clean handoff line into the live demo.

**How it works in the software.** Vite-served slides at `artifacts/marines-opener/src/pages/slides/` (`Title.tsx`, `Stakes.tsx`, `Deliver.tsx`) driven by `App.tsx`, `slideLoader.ts`, and the manifest. Validate-slides script. Theme tokens synced to the main app and the scenario brief. Pulls live entity counts and categories from the current seed at author-time.

**AI involvement.** None — authored copy.

**Operating instructions.** Open `/marines-opener/` in the preview pane. Read straight through; total runtime is 90 seconds; close on the handoff line and immediately switch to the main app to run the live demo.

**Contested-environment uplift.** Senior leadership gets ~90 seconds before they decide whether to invest attention. The opener buys exactly that window with a deck that cannot pull the visual rug out from under the live tool — same palette, same typography, same chrome — so the audience experiences the brief and the product as one continuous capability. Without it, the live demo opens cold and the first 60 seconds get spent on context the slides can land in 15.

---

## Security posture

Replit OIDC sign-in plus mandatory Microsoft Authenticator (TOTP) MFA on every fresh session, lockout after 5 failures in 5 minutes, audit log of every MFA event. Per-user profile binding with remembered role. Role-based PO permissions (`POST /orders` / `PATCH /orders/:orderId` / promote-to-PO require `commander` or `logistician`; analyst and medical planner sessions return `403`). Sensitive columns (profile email, contact info, settings secrets, scenario narratives, order shipping/contact, MFA secret) encrypted at rest with AES-256 via `pgcrypto` and the `DATA_ENCRYPTION_KEY` Replit Secret. HSTS, strict CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Rate limits on auth and write endpoints. CORS locked to the deployed origin with `credentials: true`. Double-submit CSRF on cookie-authenticated mutations. Structured pino audit log of every write (who, what, when, from where). 12-hour absolute session lifetime with no idle timeout (so demos do not get bounced). Verified by `pnpm run security:verify`. Full threat model and key-rotation procedure in `SECURITY.md`.

---

## DoW IL5 deployment posture

A standalone analysis lives at **[`docs/il5-deployment-impact-analysis.md`](docs/il5-deployment-impact-analysis.md)** covering what it would take to move DHA Iron Vein off Replit and into a Department of War **Impact Level 5 (IL5)** environment — STIG enumeration per component, RMF / ATO walk, hosting comparison (Cloud One AWS GovCloud (DoD) vs. Azure Government IL5 vs. an inherited Advana / DHA platform-as-a-service tenancy), dependency swap (drop-in vs. requires-replacement vs. requires-build), personnel model with cleared-FTE counts, ROM costs (one-time + annual + 3- and 5-year TCO), milestone timeline through IATT and full ATO, risk register, assumptions / exclusions, and an IL6 delta.

The analysis is scoped as a **minimum viable product (MVP) profile**:

- **Cleared-team cap:** 2–3 FTEs for the duration (1 cleared full-stack lead, 1 cleared SecOps / RMF lead, 0.5–1 fractional Authorizing Official liaison) — not a full program-of-record build-out.
- **Sunk-cost assumptions:** the DISA login + PKI / CAC issuance ATO is treated as already in place (no PKI standup priced).
- **Inherited hosting:** baseline assumes platform-tenant inheritance from **Advana** or a **DHA**-owned IL5 enclave (Cloud One AWS GovCloud (DoD) is priced as the standalone alternative for comparison).
- **Scope cuts to MVP:** Bedrock-only GenAI surface, static map-tile pack instead of MapLibre tile services, Platform One CI/CD, narrower SCA scope, single-region.

**Bottom line for the MVP profile:**

| Metric | MVP value | Where it lives |
| ------ | --------- | -------------- |
| One-time stand-up | **~$1.5 M** | §7 Personnel + §8 ROM |
| Annual run rate | **~$1.0 M / yr** | §8 ROM, hosting + tooling + cleared team |
| 3-year TCO | **~$4.5 M** | §8.4 |
| 5-year TCO | **~$6.5 M** | §8.4 |
| Time to **IATT** | **Month 8** | §9 timeline |
| Time to full **ATO** | **Month 14** | §9 timeline |

Section **§10.4** in the analysis carries the explicit MVP-vs-program-of-record comparison so leadership can see the trade-off in one table. The doc also includes citations to the controlling DoD policy (DoDI 8510.01 RMF, DoD CC SRG IL5/IL6, DISA STIGs, NIST SP 800-53/171/172) and to the platforms inherited (Advana, DHA, Platform One, Cloud One).

---

## License & status

Hackathon submission for **Modern Marine 2026 — Task #1: Medical Logistics Decision Support**. Not for operational use.
