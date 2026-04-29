-- Migration for task #222: Add catalog prices and reject $0 purchase orders.
-- Adds `unit_price_usd` to `items` so the order-create handler can compute a
-- real total_usd server-side and refuse to write any PO whose total would be
-- $0. Default 0 keeps existing rows safe; the seed populates a realistic
-- DoD-reimbursement-style price for every catalog row on next reseed.
--
-- Applied via `pnpm --filter @workspace/db push` (drizzle-kit push). This
-- file is the equivalent SQL extracted for review/audit purposes.

ALTER TABLE "items"
  ADD COLUMN IF NOT EXISTS "unit_price_usd" double precision NOT NULL DEFAULT 0;
