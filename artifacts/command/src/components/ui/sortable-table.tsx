import * as React from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type SortDirection = "asc" | "desc" | null;

export interface SortableColumn<T> {
  key: string;
  label: React.ReactNode;
  sortAccessor?: (row: T) => string | number | Date | null | undefined;
  render?: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
}

export interface SortableTableProps<T> {
  columns: SortableColumn<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  emptyMessage?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  initialSort?: { key: string; direction: SortDirection };
  stickyHeader?: boolean;
}

function compareValues(
  a: string | number | Date | null | undefined,
  b: string | number | Date | null | undefined
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function SortableTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  rowClassName,
  emptyMessage = "No data available",
  className,
  headerClassName,
  initialSort,
  stickyHeader,
}: SortableTableProps<T>) {
  const [sortKey, setSortKey] = React.useState<string | null>(
    initialSort?.key ?? null
  );
  const [sortDir, setSortDir] = React.useState<SortDirection>(
    initialSort?.direction ?? null
  );

  const handleSort = (col: SortableColumn<T>) => {
    if (col.sortable === false) return;
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    if (sortDir === "desc") {
      setSortKey(null);
      setSortDir(null);
      return;
    }
    setSortDir("asc");
  };

  const sortedData = React.useMemo(() => {
    if (!sortKey || !sortDir) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortAccessor) return data;
    const arr = [...data];
    arr.sort((a, b) => {
      const av = col.sortAccessor!(a);
      const bv = col.sortAccessor!(b);
      const cmp = compareValues(av, bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [data, columns, sortKey, sortDir]);

  const alignClass = (a?: SortableColumn<T>["align"]) =>
    a === "right"
      ? "text-right justify-end"
      : a === "center"
      ? "text-center justify-center"
      : "text-left justify-start";

  return (
    <Table className={className}>
      <TableHeader
        className={cn(
          stickyHeader && "sticky top-0 z-10 bg-muted/80 backdrop-blur",
          headerClassName
        )}
      >
        <TableRow>
          {columns.map((col) => {
            const sortable = col.sortable !== false && !!col.sortAccessor;
            const active = sortKey === col.key && sortDir != null;
            return (
              <TableHead
                key={col.key}
                className={cn(
                  "select-none",
                  sortable && "cursor-pointer hover:text-foreground",
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  col.headerClassName
                )}
                onClick={sortable ? () => handleSort(col) : undefined}
                aria-sort={
                  active
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    alignClass(col.align)
                  )}
                >
                  <span>{col.label}</span>
                  {sortable && (
                    <span
                      className={cn(
                        "inline-flex shrink-0",
                        active ? "text-primary" : "text-muted-foreground/50"
                      )}
                      aria-hidden
                    >
                      {active && sortDir === "asc" ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : active && sortDir === "desc" ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5" />
                      )}
                    </span>
                  )}
                </span>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedData.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="text-center py-8 text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          sortedData.map((row, idx) => (
            <TableRow
              key={rowKey(row, idx)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                onRowClick && "cursor-pointer",
                rowClassName?.(row)
              )}
            >
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  className={cn(
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    col.className
                  )}
                >
                  {col.render
                    ? col.render(row)
                    : col.sortAccessor
                    ? String(col.sortAccessor(row) ?? "")
                    : null}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
