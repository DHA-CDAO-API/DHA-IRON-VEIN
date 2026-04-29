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
