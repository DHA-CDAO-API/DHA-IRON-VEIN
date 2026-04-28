import { Link } from "wouter";
import { FlaskConical } from "lucide-react";
import type { NodeBloodReadiness } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SortableTable } from "@/components/ui/sortable-table";
import { dosClass, formatDOS, formatNumber } from "@/lib/format";

type Row = NodeBloodReadiness["testingSupplies"]["items"][number];

export function TestingSuppliesPanel({
  data,
}: {
  data: NodeBloodReadiness["testingSupplies"];
}) {
  const constraintCount = data.items.filter((i) => i.isConstraint).length;

  return (
    <Card className="bg-card/50 backdrop-blur border-border">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
            <FlaskConical className="h-4 w-4" />
            Testing & Collection Supplies
          </CardTitle>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              min DOS{" "}
              <span className={`font-mono ${dosClass(data.minDaysOfSupply)}`}>{formatDOS(data.minDaysOfSupply)}</span>
            </span>
            {constraintCount > 0 && (
              <Badge variant="outline" className="border-amber-500/60 text-amber-500 bg-amber-500/10">
                {constraintCount} constraint{constraintCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {data.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No testing supplies tracked at this site
          </div>
        ) : (
          <SortableTable
            data={data.items}
            rowKey={(r) => r.itemId}
            initialSort={{ key: "dos", direction: "asc" }}
            columns={[
              {
                key: "name",
                label: "Reagent / Kit",
                sortAccessor: (r) => r.itemName,
                render: (r) => (
                  <Link
                    href={`/items/${r.itemId}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {r.itemName}
                  </Link>
                ),
              },
              {
                key: "onHand",
                label: "On Hand",
                align: "right",
                sortAccessor: (r) => r.onHand,
                render: (r) => <span className="font-mono">{formatNumber(r.onHand)}</span>,
              },
              {
                key: "burn",
                label: "Burn/day",
                align: "right",
                sortAccessor: (r) => r.dailyBurn,
                render: (r) => (
                  <span className="font-mono text-xs text-muted-foreground">
                    {Number.isFinite(r.dailyBurn) ? r.dailyBurn.toFixed(1) : "—"}
                  </span>
                ),
              },
              {
                key: "dos",
                label: "DOS",
                align: "right",
                sortAccessor: (r) => r.daysOfSupply,
                render: (r) => (
                  <span className={`font-mono ${dosClass(r.daysOfSupply)}`}>
                    {formatDOS(r.daysOfSupply)}
                  </span>
                ),
              },
              {
                key: "constrains",
                label: "Gates",
                sortAccessor: (r) => r.constrains,
                render: (r) => <ConstrainsBadge value={r.constrains} active={r.isConstraint} />,
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ConstrainsBadge({
  value,
  active,
}: {
  value: Row["constrains"];
  active: boolean;
}) {
  const label =
    value === "both"
      ? "Collection + Transfusion"
      : value === "collection"
      ? "Collection"
      : "Transfusion";
  if (!active) {
    return (
      <Badge variant="outline" className="border-border/40 text-muted-foreground text-[10px]">
        {label}
      </Badge>
    );
  }
  const isTransfusion = value === "transfusion" || value === "both";
  return (
    <Badge
      variant="outline"
      className={
        isTransfusion
          ? "border-destructive/60 text-destructive bg-destructive/10 text-[10px]"
          : "border-amber-500/60 text-amber-500 bg-amber-500/10 text-[10px]"
      }
    >
      Constrains {label.toLowerCase()}
    </Badge>
  );
}
