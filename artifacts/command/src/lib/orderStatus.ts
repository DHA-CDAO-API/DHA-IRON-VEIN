export type OrderStatusKey =
  | "SUBMITTED"
  | "ACKNOWLEDGED"
  | "IN_TRANSIT"
  | "RECEIVED";

type StatusPalette = {
  label: string;
  badge: string;
  pill: string;
};

const STATUS_PALETTE: Record<OrderStatusKey, StatusPalette> = {
  SUBMITTED: {
    label: "Submitted",
    badge: "bg-sky-500/20 text-sky-200 border-sky-500/40",
    pill: "border-sky-500/40 bg-sky-500/15 text-sky-200",
  },
  ACKNOWLEDGED: {
    label: "Acknowledged",
    badge: "bg-amber-500/20 text-amber-200 border-amber-500/40",
    pill: "border-amber-500/40 bg-amber-500/15 text-amber-200",
  },
  IN_TRANSIT: {
    label: "In Transit",
    badge: "bg-indigo-500/20 text-indigo-200 border-indigo-500/40",
    pill: "border-indigo-500/40 bg-indigo-500/15 text-indigo-200",
  },
  RECEIVED: {
    label: "Received",
    badge: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
    pill: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  },
};

const FALLBACK: StatusPalette = {
  label: "Unknown",
  badge: "bg-muted/30 text-muted-foreground border-muted-foreground/40",
  pill: "border-muted-foreground/40 bg-muted/30 text-muted-foreground",
};

function paletteFor(status: string): StatusPalette {
  const key = status?.toUpperCase() as OrderStatusKey;
  return STATUS_PALETTE[key] ?? FALLBACK;
}

export function orderStatusLabel(status: string): string {
  return paletteFor(status).label;
}

export function orderStatusBadgeClass(status: string): string {
  return paletteFor(status).badge;
}

export function orderStatusPillClass(status: string): string {
  return paletteFor(status).pill;
}
