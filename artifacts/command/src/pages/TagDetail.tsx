import React from "react";
import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTagBySlug,
  getGetTagBySlugQueryKey,
  useUpdateTag,
  useDeleteTag,
  useMergeTag,
  useListTags,
  getListTagsQueryKey,
} from "@workspace/api-client-react";
import type { TagDetail, TagSummary, TagDetailEntityRef, TagEntityType } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Save, Trash2, GitMerge, ArrowLeft, ChevronRight } from "lucide-react";
import { TagChip } from "@/components/tags/TagChip";
import { tagColorClasses, TAG_COLOR_OPTIONS } from "@/components/tags/tag-colors";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ENTITY_LABEL: Record<TagEntityType, string> = {
  node: "Sites",
  item: "Items",
  supplier: "Suppliers",
  order: "Orders",
  shipment: "Shipments",
  scenario: "Scenarios",
  alert: "Alerts",
  blood_lot: "Blood Lots",
};

export default function TagDetailPage() {
  const [, params] = useRoute("/tags/:slug");
  const slug = params?.slug ?? "";
  const qc = useQueryClient();

  const { data, isLoading } = useGetTagBySlug(slug, {
    query: { queryKey: getGetTagBySlugQueryKey(slug), enabled: Boolean(slug) },
  });
  const { data: allTags = [] } = useListTags(undefined, {
    query: { queryKey: getListTagsQueryKey() },
  });

  const detail = data as TagDetail | undefined;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetTagBySlugQueryKey(slug) });
    qc.invalidateQueries({ queryKey: getListTagsQueryKey() });
  };

  const updateMut = useUpdateTag({ mutation: { onSuccess: invalidate } });
  const deleteMut = useDeleteTag({ mutation: { onSuccess: invalidate } });
  const mergeMut = useMergeTag({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTagsQueryKey() });
      },
    },
  });

  // Editable buffer
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState<string>("slate");
  const [description, setDescription] = React.useState("");
  const [mergeInto, setMergeInto] = React.useState<string>("");

  React.useEffect(() => {
    if (detail) {
      setName(detail.tag.name);
      setColor(detail.tag.color);
      setDescription(detail.tag.description);
    }
  }, [detail?.tag.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !detail) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading tag…
      </div>
    );
  }

  const dirty =
    name !== detail.tag.name || color !== detail.tag.color || description !== (detail.tag.description ?? "");

  const save = () => {
    updateMut.mutate({
      slug: detail.tag.slug,
      data: { name, color, description },
    });
  };

  const remove = () => {
    if (confirm(`Delete "${detail.tag.name}"? This will remove it from ${detail.usageCount} records.`)) {
      deleteMut.mutate({ slug: detail.tag.slug });
      window.history.back();
    }
  };

  const doMerge = () => {
    if (!mergeInto) return;
    if (
      confirm(
        `Merge "${detail.tag.name}" into "${mergeInto}"? All assignments move to the target tag and this one is deleted.`,
      )
    ) {
      mergeMut.mutate({ slug: detail.tag.slug, data: { intoSlug: mergeInto } }, {
        onSuccess: () => {
          window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/tags/${mergeInto}`;
        },
      });
    }
  };

  const c = tagColorClasses(color);

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/tags" className="hover:text-primary inline-flex items-center gap-1" data-testid="tag-detail-back">
          <ArrowLeft className="h-3 w-3" /> Tags
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-mono">{detail.tag.slug}</span>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <TagChip tag={{ ...detail.tag, color }} asLink={false} size="sm" />
          <div>
            <h1 className="text-xl font-bold">{detail.tag.name}</h1>
            <p className="text-xs text-muted-foreground">
              {detail.usageCount} assignment{detail.usageCount === 1 ? "" : "s"} ·{" "}
              <span className={cn("uppercase", detail.tag.source === "ai" ? "text-primary" : "")}>{detail.tag.source}</span>
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Edit tag</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-tag-name" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Color</label>
              <div className="flex flex-wrap gap-2">
                {TAG_COLOR_OPTIONS.map((co) => {
                  const cc = tagColorClasses(co);
                  const active = co === color;
                  return (
                    <button
                      key={co}
                      type="button"
                      onClick={() => setColor(co)}
                      className={cn("h-6 w-6 rounded-full border-2", cc.dot, active ? "border-primary" : "border-transparent")}
                      aria-label={`Color ${co}`}
                      data-testid={`tag-color-${co}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-tag-description"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" onClick={save} disabled={!dirty || updateMut.isPending} data-testid="button-save-tag">
              {updateMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save changes
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={remove}
              className="text-destructive hover:text-destructive"
              data-testid="button-delete-tag"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Merge into</span>
              <Select value={mergeInto} onValueChange={setMergeInto}>
                <SelectTrigger className="w-[200px] h-8 text-xs" data-testid="select-merge-into">
                  <SelectValue placeholder="Select tag…" />
                </SelectTrigger>
                <SelectContent>
                  {(allTags as TagSummary[])
                    .filter((t) => t.slug !== detail.tag.slug)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.slug} className="text-xs">
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!mergeInto || mergeMut.isPending}
                onClick={doMerge}
                data-testid="button-merge-tag"
              >
                {mergeMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <GitMerge className="h-4 w-4 mr-1" />}
                Merge
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Tagged records</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.byEntityType.length === 0 && (
            <div className="text-xs text-muted-foreground py-6 text-center">No assignments yet.</div>
          )}
          <div className="space-y-5">
            {detail.byEntityType.map((group) => (
              <section key={group.entityType}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  {ENTITY_LABEL[group.entityType] ?? group.entityType} · {group.entries.length}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {group.entries.map((e: TagDetailEntityRef) => (
                    <RecordCard key={`${group.entityType}-${e.entityId}`} entry={e} entityType={group.entityType} color={c} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RecordCard({
  entry,
  entityType,
  color,
}: {
  entry: TagDetailEntityRef;
  entityType: TagEntityType;
  color: { dot: string };
}) {
  const Wrapper: React.ElementType = entry.deeplink ? Link : "div";
  const wrapperProps = entry.deeplink ? { href: entry.deeplink } : {};
  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        "block rounded border border-border/60 bg-secondary/30 p-2.5 hover:bg-secondary/60 transition-colors",
        entry.deeplink && "cursor-pointer",
      )}
      data-testid={`tag-record-${entityType}-${entry.entityId}`}
    >
      <div className="flex items-start gap-2">
        <span className={cn("h-2 w-2 rounded-full mt-1.5 shrink-0", color.dot)} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{entry.label}</div>
          {entry.sublabel && (
            <div className="text-[11px] text-muted-foreground truncate">{entry.sublabel}</div>
          )}
          {entry.appliedBy === "ai" && (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary">
              <Sparkles className="h-3 w-3" />
              <span className="truncate" title={entry.rationale ?? ""}>
                {entry.rationale ?? "AI applied"}
              </span>
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
