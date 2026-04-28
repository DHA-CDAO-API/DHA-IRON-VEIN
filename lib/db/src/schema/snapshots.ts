import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  serial,
  index,
} from "drizzle-orm/pg-core";

// Per-node, per-time snapshots of viable blood days-of-supply. Used by the
// Overview leaderboard to compute a real "delta vs ~24h ago" rather than a
// deterministic placeholder. Rows are written each time the leaderboard
// endpoint is rebuilt and pruned automatically (see overview routes).
export const dosSnapshots = pgTable(
  "dos_snapshots",
  {
    id: serial("id").primaryKey(),
    nodeId: text("node_id").notNull(),
    viableDaysOfSupply: doublePrecision("viable_days_of_supply").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nodeRecordedIdx: index("dos_snapshots_node_recorded_idx").on(
      t.nodeId,
      t.recordedAt,
    ),
  }),
);

export type DosSnapshot = typeof dosSnapshots.$inferSelect;
