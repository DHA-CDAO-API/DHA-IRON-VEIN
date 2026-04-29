# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Tagging system

Cross-cutting tags are available for sites, items, suppliers, orders, shipments, scenarios, alerts, and blood lots:

- DB: `lib/db/src/schema/tags.ts` — `tags` and `tag_assignments` tables (polymorphic; AI provenance metadata).
- AI helper: `lib/ai-orchestrator/src/tag-suggester.ts` — returns strict-JSON tag suggestions; used both by the per-record "Suggest" popover and the admin batch auto-tag.
- API routes: `artifacts/api-server/src/routes/tags.ts` — list/create/get/update/delete/merge tags, list/add/remove assignments, suggest, auto-tag.
- Frontend: `artifacts/command/src/components/tags/TagEditor.tsx` (reusable picker + AI suggest), `TagChip.tsx`, `pages/TagsAdmin.tsx` (`/tags`), `pages/TagDetail.tsx` (`/tags/:slug`).
- Seeded starter tags: Pacific Theater, First Island Chain, Forward Operating, High Priority, Critical Mission, Cold Chain, Walking Blood Bank, Long Lead, Trusted Supplier, Disruption Watch.
- Sidebar nav: "Tags" entry. Search palette (Cmd+K): "Tags" section.
- Activity log kinds: TAG_ADDED, TAG_REMOVED, TAG_AI_APPLIED, TAG_DELETED, TAG_MERGED.

## Medical procedures & echelons of care

Clinician-curated procedure library tying supply items to the procedures that consume them, plus a Role 1/2/3 echelon-of-care tag on each demand node.

- DB: `lib/db/src/schema/procedures.ts` — `procedures`, `procedure_supplies` (tier = primary|secondary|tertiary, `quantityPerEvent`), `procedure_roles`. `nodes.role` text column (`role_1|role_2|role_3` or NULL for non-demand sites).
- Seed: `seedMedicalProcedures()` in `artifacts/api-server/src/seed/run.ts` populates ~12 procedures (airway management, wound care, walking blood bank, MEDEVAC, etc.). `roleForNodeType()` backfills `nodes.role` from the existing node type.
- API routes: `artifacts/api-server/src/routes/procedures.ts`
  - `GET /api/procedures` — list summaries (with primary/secondary/tertiary counts).
  - `GET /api/procedures/:id` — full detail (description, roles, tier-grouped supply list).
  - `GET /api/items/:itemId/procedures` — reverse lookup; powers the "used in N procedures" panel in the New Order dialog.
- Companion supplies: `artifacts/api-server/src/routes/predictive.ts` builds `companionItemsByItemId` and `mappers.ts` emits `companionItems` on every recommendation. The promote endpoint accepts `includeCompanionSupplies: true` to bundle one purchase order with one line per companion.
- OpenAPI: `Procedure*`, `ProcedureUsage`, and `companionItems`/`includeCompanionSupplies` fields under recommendation + promote schemas.
- Frontend (command app):
  - `/procedures` (Stethoscope icon, pink) — `pages/Procedures.tsx` library + `pages/ProcedureDetail.tsx` tier-grouped supply view, with role chips.
  - `components/EchelonRoleBadge.tsx` — single + multi-role badges (named distinctly from the user `RoleBadge.tsx`).
  - SiteDetail header + Locations table now show the site's echelon role.
  - `components/orders/NewOrderDialog.tsx` — "Used in N procedures" companion panel under Quantity/Priority once an item is selected.
  - `components/PromoteDialog.tsx` — checkbox to bundle companion supplies into the same PO when the recommendation has any.
