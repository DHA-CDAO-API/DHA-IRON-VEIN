import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * EchelonRoleBadge — renders the role of care (Role 1/2/3) for a node or
 * procedure. Distinct from the user-role pill in the top bar; here the role
 * means the Joint Health Service Support echelon a site (or procedure) is
 * scoped to. Roles drive scenario realism — Role 1 sites can do TCCC and
 * sick call but cannot perform damage-control surgery.
 */

export type EchelonRole = "role_1" | "role_2" | "role_3";

const ROLE_META: Record<
  EchelonRole,
  { label: string; tone: string; description: string }
> = {
  role_1: {
    label: "Role 1",
    description: "BAS / aid station: TCCC + sick call",
    tone: "border-emerald-400/50 bg-emerald-400/10 text-emerald-100",
  },
  role_2: {
    label: "Role 2",
    description: "Forward surgical / standard MTF",
    tone: "border-amber-400/50 bg-amber-400/10 text-amber-100",
  },
  role_3: {
    label: "Role 3",
    description: "CSH / large MTF / theater hospital",
    tone: "border-rose-400/55 bg-rose-400/10 text-rose-100",
  },
};

export function EchelonRoleBadge({
  role,
  className,
  testId,
}: {
  role: EchelonRole | string | null | undefined;
  className?: string;
  testId?: string;
}) {
  if (!role) return null;
  const meta = ROLE_META[role as EchelonRole];
  if (!meta) return null;
  return (
    <Badge
      variant="outline"
      title={meta.description}
      data-testid={testId ?? `badge-echelon-${role}`}
      className={cn(
        "uppercase text-[10px] tracking-wider px-2 py-0.5",
        meta.tone,
        className,
      )}
    >
      {meta.label}
    </Badge>
  );
}

/**
 * Renders multiple role badges in a compact row, used by the procedures rail
 * to show every echelon a procedure is approved at.
 */
export function EchelonRoleBadges({
  roles,
  className,
}: {
  roles: ReadonlyArray<string> | null | undefined;
  className?: string;
}) {
  if (!roles || roles.length === 0) return null;
  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {roles.map((r) => (
        <EchelonRoleBadge key={r} role={r} />
      ))}
    </div>
  );
}

export default EchelonRoleBadge;
