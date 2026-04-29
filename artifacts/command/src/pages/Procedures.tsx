import React from "react";
import { Link } from "wouter";
import { useListProcedures } from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Stethoscope, Search, ChevronRight } from "lucide-react";
import {
  EchelonRoleBadges,
  type EchelonRole,
} from "@/components/EchelonRoleBadge";

/**
 * Procedures library page — clinician-facing reference catalog. Lists every
 * procedure with its echelon-of-care tags and the count of supplies in each
 * tier (Primary / Secondary / Tertiary). The role filter on the right lets
 * users narrow by Role 1/2/3, which is the most common scoping question
 * during planning ("what can my BAS actually do?").
 */
export default function Procedures() {
  const { data: procedures, isLoading } = useListProcedures();
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<EchelonRole | "all">(
    "all",
  );

  const filtered = React.useMemo(() => {
    const list = procedures ?? [];
    return list.filter((p) => {
      if (
        roleFilter !== "all" &&
        !(p.roles ?? []).includes(roleFilter as never)
      )
        return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        p.clinicalCategory.toLowerCase().includes(q)
      );
    });
  }, [procedures, search, roleFilter]);

  const totalByRole = React.useMemo(() => {
    const t = { role_1: 0, role_2: 0, role_3: 0 };
    for (const p of procedures ?? []) {
      for (const r of p.roles ?? []) {
        if (r in t) t[r as keyof typeof t] += 1;
      }
    }
    return t;
  }, [procedures]);

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Stethoscope className="h-6 w-6 text-pink-300" />
            Medical Procedures Library
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Clinician-curated reference catalog of medical procedures and the
            supplies each one consumes. Each procedure is broken into a{" "}
            <span className="text-foreground">Primary</span> kit (must-have),
            a <span className="text-foreground">Secondary</span> kit (strongly
            preferred), and a{" "}
            <span className="text-foreground">Tertiary</span> kit (optional /
            nice-to-have). Use the role filter to scope by echelon of care.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="text-emerald-300 font-mono">
              {totalByRole.role_1}
            </span>{" "}
            Role 1
          </span>
          <span className="flex items-center gap-1">
            <span className="text-amber-300 font-mono">
              {totalByRole.role_2}
            </span>{" "}
            Role 2
          </span>
          <span className="flex items-center gap-1">
            <span className="text-rose-300 font-mono">
              {totalByRole.role_3}
            </span>{" "}
            Role 3
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search procedures, categories, or supplies..."
            className="pl-9"
            data-testid="input-procedures-search"
          />
        </div>
        <ToggleGroup
          type="single"
          value={roleFilter}
          onValueChange={(v) => {
            if (v) setRoleFilter(v as EchelonRole | "all");
          }}
          className="bg-card border border-border rounded-md"
        >
          <ToggleGroupItem
            value="all"
            data-testid="toggle-procedures-role-all"
            className="text-xs uppercase tracking-wider px-3"
          >
            All
          </ToggleGroupItem>
          <ToggleGroupItem
            value="role_1"
            data-testid="toggle-procedures-role-1"
            className="text-xs uppercase tracking-wider px-3"
          >
            Role 1
          </ToggleGroupItem>
          <ToggleGroupItem
            value="role_2"
            data-testid="toggle-procedures-role-2"
            className="text-xs uppercase tracking-wider px-3"
          >
            Role 2
          </ToggleGroupItem>
          <ToggleGroupItem
            value="role_3"
            data-testid="toggle-procedures-role-3"
            className="text-xs uppercase tracking-wider px-3"
          >
            Role 3
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Loading procedures…</div>
      )}

      <div
        className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
        data-testid="grid-procedures"
      >
        {filtered.map((p) => (
          <Link key={p.id} href={`/procedures/${p.id}`}>
            <Card
              data-testid={`card-procedure-${p.id}`}
              className="hover:border-pink-400/50 transition-colors cursor-pointer h-full"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">
                    {p.name}
                  </CardTitle>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </div>
                <CardDescription className="line-clamp-2 text-xs">
                  {p.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <EchelonRoleBadges roles={p.roles} />
                <div className="flex items-center gap-2 text-[11px] flex-wrap">
                  <Badge
                    variant="outline"
                    className="border-rose-400/40 text-rose-100 bg-rose-400/5"
                    title="Must-have supplies"
                  >
                    {p.primaryCount} primary
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-amber-400/40 text-amber-100 bg-amber-400/5"
                    title="Strongly preferred supplies"
                  >
                    {p.secondaryCount} secondary
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-slate-400/40 text-slate-200 bg-slate-400/5"
                    title="Optional / nice-to-have supplies"
                  >
                    {p.tertiaryCount} tertiary
                  </Badge>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {p.clinicalCategory.replace(/_/g, " ")}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {filtered.length === 0 && !isLoading && (
          <div className="col-span-full text-sm text-muted-foreground text-center py-8">
            No procedures match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
