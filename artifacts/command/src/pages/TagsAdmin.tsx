import React from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTags,
  getListTagsQueryKey,
  useCreateTag,
  useDeleteTag,
  useUpdateTag,
  useAutoTagBatch,
} from "@workspace/api-client-react";
import type { TagSummary, TagEntityType } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Plus, Trash2, Loader2, Tag as TagIcon } from "lucide-react";
import { TagChip } from "@/components/tags/TagChip";
import { tagColorClasses, TAG_COLOR_OPTIONS } from "@/components/tags/tag-colors";
import { cn } from "@/lib/utils";

const ENTITY_TYPES: TagEntityType[] = [
  "node",
  "item",
  "supplier",
  "order",
  "shipment",
  "scenario",
  "alert",
  "blood_lot",
];

export default function TagsAdmin() {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState("");
  const { data: tags = [], isLoading } = useListTags(undefined, {
    query: { queryKey: getListTagsQueryKey() },
  });

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tags as TagSummary[];
    return (tags as TagSummary[]).filter(
      (t) => t.name.toLowerCase().includes(q) || t.slug.includes(q),
    );
  }, [tags, search]);

  const sorted = React.useMemo(
    () => [...filtered].sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name)),
    [filtered],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListTagsQueryKey() });
  };

  const createMut = useCreateTag({ mutation: { onSuccess: invalidate } });
  const deleteMut = useDeleteTag({ mutation: { onSuccess: invalidate } });
  const autoTagMut = useAutoTagBatch({ mutation: { onSuccess: invalidate } });

  // Create-tag dialog state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newColor, setNewColor] = React.useState<string>("sky");
  const [newDescription, setNewDescription] = React.useState("");

  const submitCreate = () => {
    if (!newName.trim()) return;
    createMut.mutate(
      {
        data: {
          name: newName.trim(),
          color: newColor,
          description: newDescription.trim(),
          source: "manual",
        },
      },
      {
        onSuccess: () => {
          setNewName("");
          setNewDescription("");
          setNewColor("sky");
          setCreateOpen(false);
        },
      },
    );
  };

  // Auto-tag batch state
  const [autoEntity, setAutoEntity] = React.useState<TagEntityType>("node");
  const [autoScope, setAutoScope] = React.useState<"recent" | "untagged">("untagged");
  const [autoLimit, setAutoLimit] = React.useState<number>(8);
  const [lastResult, setLastResult] = React.useState<{
    processed: number;
    applied: number;
  } | null>(null);

  const runAutoTag = () => {
    autoTagMut.mutate(
      {
        data: { entityType: autoEntity, scope: autoScope, limit: autoLimit },
      },
      {
        onSuccess: (res) => {
          setLastResult({ processed: res.processed, applied: res.applied });
        },
      },
    );
  };

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TagIcon className="h-5 w-5 text-primary" />
            Tags
          </h1>
          <p className="text-xs text-muted-foreground">
            Cross-cutting labels for sites, items, suppliers, orders, shipments, scenarios, alerts, and blood lots.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-new-tag">
              <Plus className="h-4 w-4 mr-1" /> New tag
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create tag</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. First Island Chain"
                  data-testid="input-new-tag-name"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Color</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {TAG_COLOR_OPTIONS.map((color) => {
                    const c = tagColorClasses(color);
                    const active = newColor === color;
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewColor(color)}
                        className={cn(
                          "h-6 w-6 rounded-full border-2",
                          c.dot,
                          active ? "border-primary" : "border-transparent",
                        )}
                        aria-label={`Color ${color}`}
                        data-testid={`new-tag-color-${color}`}
                      />
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Description</label>
                <Input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Short description"
                  data-testid="input-new-tag-description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submitCreate} disabled={!newName.trim() || createMut.isPending} data-testid="button-create-tag-submit">
                {createMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI batch auto-tag
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Entity type</label>
              <Select value={autoEntity} onValueChange={(v) => setAutoEntity(v as TagEntityType)}>
                <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-auto-entity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Scope</label>
              <Select value={autoScope} onValueChange={(v) => setAutoScope(v as "recent" | "untagged")}>
                <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-auto-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="untagged" className="text-xs">Untagged only</SelectItem>
                  <SelectItem value="recent" className="text-xs">Recent records</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Limit</label>
              <Input
                type="number"
                min={1}
                max={25}
                value={autoLimit}
                onChange={(e) => setAutoLimit(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
                className="w-20 h-8 text-xs"
                data-testid="input-auto-limit"
              />
            </div>
            <Button onClick={runAutoTag} disabled={autoTagMut.isPending} size="sm" data-testid="button-run-auto-tag">
              {autoTagMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Run AI auto-tag
            </Button>
            {lastResult && (
              <span className="text-xs text-muted-foreground">
                Processed <span className="text-foreground font-mono">{lastResult.processed}</span>, applied{" "}
                <span className="text-primary font-mono">{lastResult.applied}</span> tag assignments.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Tag library</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags…"
              className="max-w-sm h-8 text-xs"
              data-testid="input-search-tags"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-medium py-2 px-3">Tag</th>
                  <th className="text-left font-medium py-2 px-3">Slug</th>
                  <th className="text-left font-medium py-2 px-3">Source</th>
                  <th className="text-left font-medium py-2 px-3">Description</th>
                  <th className="text-right font-medium py-2 px-3">Usage</th>
                  <th className="text-right font-medium py-2 px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">Loading…</td></tr>
                )}
                {!isLoading && sorted.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">No tags.</td></tr>
                )}
                {sorted.map((t) => (
                  <tr key={t.id} className="border-b border-border/40 hover:bg-secondary/30" data-testid={`tag-row-${t.slug}`}>
                    <td className="py-2 px-3">
                      <TagChip tag={t} />
                    </td>
                    <td className="py-2 px-3 text-xs font-mono text-muted-foreground">{t.slug}</td>
                    <td className="py-2 px-3 text-xs">
                      <span className={cn(
                        "inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                        t.source === "ai" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
                      )}>
                        {t.source}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-md truncate">{t.description}</td>
                    <td className="py-2 px-3 text-xs text-right tabular-nums">{t.usageCount}</td>
                    <td className="py-2 px-3 text-right">
                      <div className="inline-flex gap-1 justify-end">
                        <Link href={`/tags/${t.slug}`}>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid={`tag-row-view-${t.slug}`}>
                            View
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Delete tag "${t.name}"? This will remove it from ${t.usageCount} records.`)) {
                              deleteMut.mutate({ slug: t.slug });
                            }
                          }}
                          data-testid={`tag-row-delete-${t.slug}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
// satisfy unused import warnings for typegen drift
void useUpdateTag;
