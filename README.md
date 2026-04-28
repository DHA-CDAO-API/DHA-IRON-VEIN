# INDOPACOM Predictive Sustainment Platform

End-to-end medical logistics decision-support system for the **Modern Marine 2026 hackathon**, demonstrating how a hub-and-spoke INDOPACOM medical supply network can be made *visible, predictable, and actionable* for commanders, logisticians, medical planners, and analysts.

The system fuses a real medical-supply catalog (DLA / DMLSS-compatible) with a tactical theater simulation, a 30-day predictive sustainment engine, and a dual-provider AI copilot (OpenAI **gpt-5.4** ↔ Anthropic **claude-sonnet-4-6**, switchable at runtime) — all surfaced through a live operational dashboard, a scenario console, and a presentation-grade slide deck.

> **Operational date in the demo:** April 27, 2026
> **AOR:** USINDOPACOM theater — supplier → DLA → 3 regional hubs → 5 MTFs → 5 BAS / clinic spokes
> **Posture:** FPCON BRAVO

---

## What's in the box

A pnpm monorepo with four artifacts and a shared library layer.

```
workspace/
├── artifacts/
│   ├── api-server/         Express + Drizzle backend (REST API, sim, AI orchestration)
│   ├── command/            React + Vite operations app  (path "/")
│   ├── scenario-brief/     React + Vite slide deck     (path "/scenario-brief")
│   └── mockup-sandbox/     UI variant preview server (design-only, not user-facing)
├── lib/
│   ├── api-spec/           OpenAPI 3.1 contract + orval-generated TS client
│   ├── db/                 Drizzle ORM schema + seed/ingest scripts
│   ├── sim/                Pure-TS theater simulation + 30-day projection
│   └── ai-orchestrator/    Provider-agnostic LLM router (OpenAI + Anthropic)
└── README.md               (this file)
```

Each artifact runs as its own service behind the workspace's path-routed proxy, so the user can switch among them from the preview-pane dropdown.

---

## The five modules

### 1. MVP web application — `artifacts/command/`
A live theater operations console with:
- **Live INDOPACOM hub-and-spoke map** (deck.gl + MapLibre, dark-matter basemap, animated arcs for active shipments, risk-coloured nodes). Falls back to a tactical list view when WebGL is unavailable.
- **Days-of-Supply (DOS) dashboard** — per-site rollups, theater-wide DOS, top-risk nodes.
- **Alerts feed** — live-tickered, severity-bucketed, drillable to the originating site/item.
- **Orders Board** — kanban (Submitted / Acknowledged / In Transit / Received), one-click promote-from-recommendation, print-ready DMLSS-style PO.
- **Role switcher** — Commander / Logistician / Medical Planner / Analyst, with role-tuned KPI emphasis.
- **Site / Item drill-downs**, **Data Administration** (re-seed, catalog preview), **Settings**, **Profile**.
- **Cmd-K palette**, **CSV / XLSX exports**, **Print** for orders.

### 2. Predictive sustainment engine
- `lib/sim/` — pure-TypeScript deterministic theater sim: daily burn × confidence interval, shipment ETAs, threat-band attrition, 30-day DOS projection per (site, item).
- `lib/ai-orchestrator/` — strategy-pattern LLM router. **OpenAI** and **Anthropic** providers are interchangeable per-request via a `provider` field; both are accessed through Replit's AI Integrations proxy (no third-party keys required).
- The Copilot endpoint hands the engine's structured output to the chosen LLM and returns natural-language explanations + ranked recommendations.

### 3. Data layer
- PostgreSQL + Drizzle ORM. Schemas in `lib/db/src/schema/`: nodes, items, balances, routes, shipments, orders + lines, recommendations, alerts, scenarios, activity, profiles.
- **DMLSS-compatible** ingest: `lib/db/seed-data/dataset.xlsx` (network) + `medical_supply_inventory.csv` (1,664-item catalog) → `pnpm tsx artifacts/api-server/src/seed/run.ts`.

### 4. Operational scenario brief — `artifacts/scenario-brief/`
A standalone 14-slide deck (Title, Problem, Mission, Architecture, Data Model, Live Ops, Engine, Scenarios, Walkthrough, Copilot, Decisions, Roles, Compare, Demo) — Space Grotesk + IBM Plex, dark tactical palette (amber `#F59E0B`, cyan `#22D3EE`, bg `#0B1220`).
Mirrors and extends the in-app **Scenario Console** (`/scenarios`), where the same presets (Typhoon, Sealift Disruption, Mass-Casualty, Routine) can be replayed against the live data.

### 5. This README.

---

## Quick start

Prerequisites: pnpm (managed by Replit), a PostgreSQL `DATABASE_URL`, and the AI integration env vars (auto-provided in this Replit).

```bash
pnpm install
pnpm --filter @workspace/db run db:push          # create tables
pnpm --filter @workspace/api-server tsx src/seed/run.ts   # seed network + catalog

# Workflows configured in this Replit (auto-started):
#   artifacts/api-server: API Server          → /api/*
#   artifacts/command: web                    → /
#   artifacts/scenario-brief: web             → /scenario-brief
#   artifacts/mockup-sandbox: Preview         → (internal, design)
```

The preview pane will route automatically. The operations app loads at `/`, the slide deck at `/scenario-brief`.

---

## Architecture at a glance

```
        ┌──────────────────────────────────────────────────────┐
        │            command (React + Vite)  →  "/"            │
        │  Live Map · DOS Dashboard · Orders · Scenarios       │
        │  Copilot · Data Admin · Role Switcher                │
        └─────────────┬────────────────────────────────────────┘
                      │  REST  (typed via orval-generated client)
                      ▼
        ┌──────────────────────────────────────────────────────┐
        │  api-server (Express)  →  /api/*                     │
        │  routes: network · sites · items · orders · alerts   │
        │          scenarios · copilot · predictive · admin    │
        └────────┬───────────────────────────┬─────────────────┘
                 │                           │
                 ▼                           ▼
        ┌────────────────┐         ┌────────────────────────────┐
        │  lib/sim       │         │  lib/ai-orchestrator       │
        │  30-day        │         │  OpenAI gpt-5.4    │ swap  │
        │  projection    │         │  Anthropic c-s-4-6 │ at    │
        │                │         │                    │ run   │
        └────────┬───────┘         └────────┬───────────┘ time  │
                 │                          │
                 ▼                          ▼
        ┌──────────────────────────────────────────────────────┐
        │  lib/db (Drizzle + Postgres) · DMLSS-compatible      │
        │  31 nodes · 8 demo items · 248 balances · 43 routes  │
        └──────────────────────────────────────────────────────┘
```

---

## API surface (selected)

All under `/api/*`. Full contract in `lib/api-spec/openapi.yaml`.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`  | `/healthz` | Liveness |
| `GET`  | `/dashboard/overview` | KPIs, theater DOS, top alerts |
| `GET`  | `/network/snapshot` | Nodes, routes, active shipments, risk |
| `GET`  | `/sites` / `/sites/:nodeId` | Site list + drill-down |
| `GET`  | `/items` / `/items/:itemId` | Catalog list + drill-down |
| `GET`  | `/orders` · `POST /orders` · `GET /orders/:id` | Orders board + PO detail |
| `GET`  | `/predictive/recommendations` | Ranked re-supply recommendations |
| `POST` | `/scenarios/run` | Run a 30-day projection (typhoon, sealift, mass-casualty, routine) |
| `POST` | `/copilot/chat` | Provider-agnostic chat (`provider: "openai" | "anthropic"`) |
| `GET`  | `/alerts` · `/activity` | Live ops feed |
| `GET`  | `/exports/orders.csv` · `/exports/balances.xlsx` | Bulk exports |
| `POST` | `/admin/reseed` | Wipe + reseed (dev — currently unauthenticated) |

---

## Roles & DMLSS posture

The role switcher (top-right, persists in `localStorage`) re-weights the dashboard:

- **Commander** — theater DOS, FPCON, top-risk hubs, decision recommendations.
- **Logistician** — orders pipeline, ETAs, route stress, exports.
- **Medical Planner** — item-level burn, mass-casualty surge, scenario console.
- **Analyst** — full data admin, model switching, raw recommendations.

Documents (purchase orders, exports) are formatted to be drop-in compatible with DMLSS / MILSTRIP-style workflows.

---

## Engineering notes

- **TypeScript end-to-end**, single source of truth: OpenAPI → orval → typed React Query hooks.
- **Pure-function sim** (`lib/sim`) — fully unit-testable, no I/O, no LLM dependence.
- **LLM is additive**, never load-bearing: the recommendations exist with or without the model; the model adds rationale, prioritisation, and natural-language Q&A.
- **No emojis**, anywhere — military-professional visual register.
- **Deterministic seed** — the same `pnpm seed` produces the same demo state each run.

---

## License & status

Hackathon submission for **Modern Marine 2026 — Task #1: Medical Logistics Decision Support**. Not for operational use.
