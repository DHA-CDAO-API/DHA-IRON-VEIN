import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListItems,
  getListItemsQueryKey,
  useUpdateItem,
  useGetProfile,
  type Item,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Loader2,
  Lock,
  Search,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 200;

// Roles allowed to use the Catalog Prices admin page. Must stay in sync
// with ADMIN_ROLES in artifacts/api-server/src/lib/require-admin.ts —
// the server enforces this for real; this constant just hides the UI
// for non-admin perspectives so they don't get a confusing 403.
const ADMIN_ROLES = new Set(["logistician", "commander"]);

function isUnpriced(price: number | null | undefined): boolean {
  if (price == null || !Number.isFinite(price)) return true;
  return price <= 0;
}

interface PriceRowProps {
  item: Item;
  canEdit: boolean;
  onSaved: () => void;
}

function PriceRow({ item, canEdit, onSaved }: PriceRowProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const currentPrice = (item as { unitPriceUsd?: number }).unitPriceUsd ?? 0;
  const unpriced = isUnpriced(currentPrice);

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<string>(currentPrice.toFixed(2));
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setDraft(currentPrice.toFixed(2));
  }, [currentPrice]);

  React.useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const updateMut = useUpdateItem({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Price updated",
          description: `${item.name} → ${formatCurrency(Number(draft))}`,
        });
        setEditing(false);
        qc.invalidateQueries({ queryKey: getListItemsQueryKey() });
        onSaved();
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Could not save price";
        toast({
          title: "Failed to update price",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  function handleSave() {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast({
        title: "Invalid price",
        description: "Enter a non-negative dollar amount.",
        variant: "destructive",
      });
      return;
    }
    if (parsed === currentPrice) {
      setEditing(false);
      return;
    }
    updateMut.mutate({ itemId: item.id, data: { unitPriceUsd: parsed } });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(currentPrice.toFixed(2));
      setEditing(false);
    }
  }

  const source = (item as { source?: string }).source ?? "seed";

  return (
    <TableRow
      data-testid={`row-item-${item.id}`}
      className={cn(unpriced && "bg-amber-500/5")}
    >
      <TableCell className="font-mono text-xs text-muted-foreground">
        {item.id}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {item.name}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {item.unit || (item as { unitOfIssue?: string }).unitOfIssue || "ea"}
            {item.criticality ? ` · ${item.criticality}` : ""}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn(
            "uppercase tracking-wider text-[10px]",
            source === "seed"
              ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
              : "border-violet-500/30 bg-violet-500/10 text-violet-200",
          )}
        >
          {source === "supply_demo_v2" ? "Supply Demo" : "Seed"}
        </Badge>
      </TableCell>
      <TableCell className="w-[200px]">
        {editing ? (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <DollarSign className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={draft}
                disabled={updateMut.isPending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 pl-7 text-right tabular-nums"
                data-testid={`input-price-${item.id}`}
              />
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-emerald-400 hover:text-emerald-300"
              disabled={updateMut.isPending}
              onClick={handleSave}
              aria-label="Save price"
              data-testid={`btn-save-price-${item.id}`}
            >
              {updateMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground"
              disabled={updateMut.isPending}
              onClick={() => {
                setDraft(currentPrice.toFixed(2));
                setEditing(false);
              }}
              aria-label="Cancel edit"
              data-testid={`btn-cancel-price-${item.id}`}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => canEdit && setEditing(true)}
            disabled={!canEdit}
            className={cn(
              "group inline-flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-right tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              canEdit && "hover:bg-secondary/60",
              unpriced ? "text-amber-300" : "text-foreground",
              !canEdit && "cursor-not-allowed opacity-80",
            )}
            data-testid={`btn-edit-price-${item.id}`}
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 group-hover:text-muted-foreground">
              {unpriced ? "Unpriced" : canEdit ? "Edit" : "View"}
            </span>
            <span className="font-mono text-sm">
              {unpriced ? "$0.00" : formatCurrency(currentPrice)}
            </span>
          </button>
        )}
      </TableCell>
      <TableCell className="w-[140px]">
        {unpriced ? (
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-300 uppercase tracking-wider text-[10px]"
            data-testid={`badge-unpriced-${item.id}`}
          >
            <AlertTriangle className="h-3 w-3 mr-1" />
            Will block PO
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 uppercase tracking-wider text-[10px]"
          >
            Priced
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

function AccessDenied({ role }: { role?: string | null }) {
  return (
    <div
      className="h-full flex items-center justify-center p-6"
      data-testid="catalog-access-denied"
    >
      <Card className="max-w-lg border-amber-500/40">
        <CardContent className="pt-6 flex gap-4 items-start">
          <div className="rounded-full bg-amber-500/15 p-2 shrink-0">
            <Lock className="h-5 w-5 text-amber-300" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-foreground">
              Admin access required
            </h2>
            <p className="text-sm text-muted-foreground">
              Editing catalog prices is restricted to the{" "}
              <span className="font-medium text-foreground">logistician</span>{" "}
              and{" "}
              <span className="font-medium text-foreground">commander</span>{" "}
              perspectives. Your active role is{" "}
              <span className="font-medium text-foreground">
                {role ?? "unknown"}
              </span>
              . Switch your active perspective on the Profile page to
              continue.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CatalogPrices() {
  const { data: profile, isLoading: profileLoading } = useGetProfile();
  const role = profile?.role;
  const isAdmin = !!role && ADMIN_ROLES.has(role);

  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [showUnpricedOnly, setShowUnpricedOnly] = React.useState(false);
  const [offset, setOffset] = React.useState(0);

  // Debounce the search box to avoid pounding /items on every keystroke
  // (the catalog is large — up to ~62k rows including supply_demo_v2).
  React.useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0); // reset paging when the query changes
    }, 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = React.useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset,
      ...(search ? { search } : {}),
    }),
    [search, offset],
  );

  const {
    data: items = [],
    isLoading,
    isFetching,
    refetch,
  } = useListItems(params, {
    query: {
      queryKey: getListItemsQueryKey(params),
      enabled: isAdmin,
    },
  });

  const unpricedCount = React.useMemo(
    () =>
      items.filter((it) =>
        isUnpriced((it as { unitPriceUsd?: number }).unitPriceUsd),
      ).length,
    [items],
  );

  const visible = React.useMemo(() => {
    if (!showUnpricedOnly) return items;
    return items.filter((it) =>
      isUnpriced((it as { unitPriceUsd?: number }).unitPriceUsd),
    );
  }, [items, showUnpricedOnly]);

  // Pagination heuristic: a full page implies there's likely a next page.
  // The /items endpoint doesn't return a total count, so we use the
  // page-size cap as our "more available" signal.
  const hasNextPage = items.length === PAGE_SIZE;
  const hasPrevPage = offset > 0;
  const startIndex = items.length === 0 ? 0 : offset + 1;
  const endIndex = offset + items.length;

  if (profileLoading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }
  if (!isAdmin) {
    return <AccessDenied role={role} />;
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <DollarSign className="h-6 w-6 text-emerald-400" />
              Catalog Prices
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Edit the catalog <code className="text-xs">unit_price_usd</code>{" "}
              used to compute purchase order totals. Changes persist immediately
              and apply to every new PO and the next backfill run. Unpriced
              items are flagged because they would otherwise block PO creation
              under the zero-total rule.
            </p>
          </div>
        </div>

        <Card className="border-border/60">
          <CardHeader className="pb-3 flex flex-row items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by name, manufacturer cat number, or NDC…"
                className="pl-8 h-9"
                data-testid="input-catalog-search"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={showUnpricedOnly ? "default" : "outline"}
                onClick={() => setShowUnpricedOnly((v) => !v)}
                data-testid="btn-toggle-unpriced"
                className="gap-2"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Unpriced on this page
                {unpricedCount > 0 ? (
                  <Badge
                    variant="outline"
                    className="ml-1 border-amber-500/40 bg-amber-500/10 text-amber-200 text-[10px]"
                    data-testid="badge-unpriced-count"
                  >
                    {unpricedCount}
                  </Badge>
                ) : null}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading catalog…
              </div>
            ) : visible.length === 0 ? (
              <div
                className="p-8 text-sm text-muted-foreground"
                data-testid="empty-state"
              >
                {showUnpricedOnly && unpricedCount === 0
                  ? "Every visible item has a price. Nothing to fix on this page."
                  : items.length === 0 && offset > 0
                    ? "No more items past this page."
                    : "No items matched your search."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">ID</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-[110px]">Source</TableHead>
                      <TableHead className="w-[200px] text-right">
                        Unit price
                      </TableHead>
                      <TableHead className="w-[140px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((it) => (
                      <PriceRow
                        key={it.id}
                        item={it}
                        canEdit={isAdmin}
                        onSaved={() => {
                          refetch();
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground flex-wrap">
          <div data-testid="pagination-summary">
            {items.length === 0
              ? offset === 0
                ? "No items."
                : `Empty page (offset ${offset}).`
              : `Showing ${startIndex.toLocaleString()}–${endIndex.toLocaleString()}${
                  hasNextPage ? "" : " (last page)"
                }. Search to narrow when the catalog is large.`}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={!hasPrevPage || isFetching}
              data-testid="btn-prev-page"
              className="gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={!hasNextPage || isFetching}
              data-testid="btn-next-page"
              className="gap-1"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
