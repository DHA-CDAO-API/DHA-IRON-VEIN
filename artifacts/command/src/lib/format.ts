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

export function dosClass(dos: number | null | undefined): string {
  if (dos == null || !Number.isFinite(dos)) return "text-muted-foreground";
  if (dos <= 3) return "text-destructive font-bold";
  if (dos <= 7) return "text-amber-500 font-bold";
  return "text-emerald-500 font-bold";
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
