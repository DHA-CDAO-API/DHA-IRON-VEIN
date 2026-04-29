export function formatPercent(value: number | null | undefined, opts: { fractionDigits?: number } = {}): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = opts.fractionDigits ?? 0;
  const pct = value <= 1 ? value * 100 : value;
  if (!Number.isFinite(pct)) return "—";
  return `${pct.toFixed(digits)}%`;
}

export function formatDOS(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 999) return "∞";
  return value.toFixed(1);
}

export function formatNumber(value: number | null | undefined, opts: { fractionDigits?: number } = {}): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = opts.fractionDigits ?? 0;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Format a USD amount with a leading `$` and exactly two fractional digits
 * (e.g. `$11,965.20`, `$0.00`). Use this anywhere a dollar value is
 * displayed so trailing zeros are never dropped — the JS default
 * `toLocaleString()` would render `11965.2` as `"11,965.2"` which looks
 * broken. Pass `opts.fractionDigits` only if a different precision is
 * required (defaults to 2, the standard for cents).
 */
export function formatCurrency(
  value: number | null | undefined,
  opts: { fractionDigits?: number } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = opts.fractionDigits ?? 2;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(value < 10 ? 1 : 0)}d`;
}

export type ItemCategoryKey = "blood_products" | "supplies" | "ppe" | "other";

const CATEGORY_LABELS: Record<string, string> = {
  blood_products: "Blood Products",
  supplies: "Supplies",
  ppe: "PPE",
  other: "Other",
};

export function categoryLabel(raw: string | null | undefined): string {
  if (!raw) return CATEGORY_LABELS.other;
  const normalized = raw.toLowerCase().trim().replace(/\s|-/g, "_");
  return CATEGORY_LABELS[normalized] ?? raw;
}

export function categoryKey(raw: string | null | undefined): ItemCategoryKey {
  if (!raw) return "other";
  const normalized = raw.toLowerCase().trim().replace(/\s|-/g, "_");
  if (normalized === "blood_products" || normalized === "blood") return "blood_products";
  if (normalized === "ppe") return "ppe";
  if (normalized === "supplies" || normalized === "supply") return "supplies";
  return "other";
}

export const CATEGORY_ORDER: ItemCategoryKey[] = ["blood_products", "supplies", "ppe", "other"];

/**
 * The Blood / Medical / Both filter that several inventory-style surfaces
 * share so operators can focus on whichever supply class matters in the
 * moment. "blood" matches the `blood_products` category only; "medical"
 * matches every non-blood category (supplies, PPE, other); "both" turns
 * the filter off. Use the `categoryMatches` helper rather than open-coding
 * the comparison so the semantics stay consistent.
 */
export type CategoryFilter = "blood" | "medical" | "both";

export function categoryMatches(
  filter: CategoryFilter,
  raw: string | null | undefined,
): boolean {
  if (filter === "both") return true;
  const k = categoryKey(raw);
  if (filter === "blood") return k === "blood_products";
  return k !== "blood_products";
}

export function dosClass(dos: number | null | undefined): string {
  if (dos == null || !Number.isFinite(dos)) return "text-muted-foreground";
  if (dos <= 3) return "text-destructive font-bold";
  if (dos <= 7) return "text-amber-500 font-bold";
  return "text-emerald-500 font-bold";
}

/**
 * Canonical inventory status values that the API can emit
 * (matches `InventoryBalanceStatus` / `DaysOfSupplyEntryStatus`).
 * Anything outside this set is treated as "unknown" so badges
 * never accidentally render `CRITICAL` in green just because a
 * comparison missed.
 */
export type InventoryStatus = "healthy" | "watch" | "warn" | "critical";

const INVENTORY_STATUSES: ReadonlySet<InventoryStatus> = new Set([
  "healthy",
  "watch",
  "warn",
  "critical",
]);

function normalizeInventoryStatus(
  status: string | null | undefined,
): InventoryStatus | null {
  if (!status) return null;
  const lower = String(status).toLowerCase().trim();
  return INVENTORY_STATUSES.has(lower as InventoryStatus)
    ? (lower as InventoryStatus)
    : null;
}

/**
 * Tailwind classes for an outline `<Badge>` rendering an inventory status.
 * Use this everywhere the four-tier status is shown so the colors stay
 * consistent — `critical` is always red, `warn` is always amber, `watch`
 * reads as "keep an eye on this", and only `healthy` is green.
 */
export function inventoryStatusBadgeClasses(
  status: string | null | undefined,
): string {
  const normalized = normalizeInventoryStatus(status);
  switch (normalized) {
    case "critical":
      return "border-destructive text-destructive";
    case "warn":
      return "border-amber-500 text-amber-500";
    case "watch":
      // Distinct from healthy but lower-urgency than `warn`: muted amber.
      return "border-amber-500/50 text-amber-500/90";
    case "healthy":
      return "border-emerald-500 text-emerald-500";
    default:
      return "border-muted-foreground/40 text-muted-foreground";
  }
}

/** Human-readable label for an inventory status (always uppercase). */
export function inventoryStatusLabel(
  status: string | null | undefined,
): string {
  const normalized = normalizeInventoryStatus(status);
  if (normalized) return normalized.toUpperCase();
  if (status == null || status === "") return "—";
  return String(status).toUpperCase();
}

/**
 * Render a recent timestamp as a compact "Xs ago" / "Xm ago" string.
 *
 * Designed for a freshness chip that ticks every second without re-fetching
 * any data — callers pass a `now` argument they update on a setInterval.
 */
export function formatRelativeTime(
  timestamp: number | null | undefined,
  now: number = Date.now(),
): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return "—";
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

/** Render an ISO timestamp as a short date like `27 Apr 2026`. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Render an ISO timestamp as a short date-time like `27 Apr 2026 14:30`. */
export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
