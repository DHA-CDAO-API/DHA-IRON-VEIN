import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTagsForEntity,
  getGetTagsForEntityQueryKey,
  useListTags,
  getListTagsQueryKey,
  useAddTagToEntity,
  useRemoveTagFromEntity,
  useSuggestTags,
} from "@workspace/api-client-react";
import type {
  TagAssignmentView,
  TagSummary,
  TagEntityType,
  TagSuggestion,
} from "@workspace/api-client-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Sparkles, Loader2, Tag as TagIcon } from "lucide-react";
import { TagChip } from "./TagChip";
import { tagColorClasses, TAG_COLOR_OPTIONS } from "./tag-colors";
import { cn } from "@/lib/utils";

export function TagEditor({
  entityType,
  entityId,
  className,
  size = "sm",
  showSuggest = true,
  align = "start",
}: {
  entityType: TagEntityType;
  entityId: string;
  className?: string;
  size?: "sm" | "xs";
  showSuggest?: boolean;
  align?: "start" | "center" | "end";
}) {
  const qc = useQueryClient();

  const { data: assignments = [] } = useGetTagsForEntity(entityType, entityId, {
    query: {
      queryKey: getGetTagsForEntityQueryKey(entityType, entityId),
      enabled: Boolean(entityId),
    },
  });

  const { data: allTags = [] } = useListTags(undefined, {
    query: { queryKey: getListTagsQueryKey() },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetTagsForEntityQueryKey(entityType, entityId) });
    qc.invalidateQueries({ queryKey: getListTagsQueryKey() });
  };

  const addMut = useAddTagToEntity({
    mutation: { onSuccess: invalidate },
  });
  const removeMut = useRemoveTagFromEntity({
    mutation: { onSuccess: invalidate },
  });
  const suggestMut = useSuggestTags();

  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<TagSuggestion[]>([]);
  const [suggestModel, setSuggestModel] = React.useState<{ provider: string; model: string } | null>(null);

  const assignedSlugs = React.useMemo(
    () => new Set((assignments as TagAssignmentView[]).map((a) => a.tag.slug)),
    [assignments],
  );

  const filteredTags = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (allTags as TagSummary[]).filter((t) => {
      if (assignedSlugs.has(t.slug)) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
    });
  }, [allTags, search, assignedSlugs]);

  const exactMatch = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return (allTags as TagSummary[]).find((t) => t.name.toLowerCase() === q || t.slug === q) ?? null;
  }, [allTags, search]);

  const addExisting = (tagId: string) => {
    addMut.mutate({
      entityType,
      entityId,
      data: { tagId, appliedBy: "manual" },
    });
  };

  const addNew = (name: string, color?: string) => {
    if (!name.trim()) return;
    addMut.mutate({
      entityType,
      entityId,
      data: { name: name.trim(), color, appliedBy: "manual" },
    });
    setSearch("");
  };

  const removeAssignment = (tagId: string) => {
    removeMut.mutate({ entityType, entityId, tagId });
  };

  const runSuggest = () => {
    setSuggestOpen(true);
    suggestMut.mutate(
      { data: { entityType, entityId } },
      {
        onSuccess: (res) => {
          setSuggestions(res.suggestions);
          setSuggestModel({ provider: res.provider, model: res.model });
        },
      },
    );
  };

  const applySuggestion = (s: TagSuggestion) => {
    addMut.mutate(
      {
        entityType,
        entityId,
        data: {
          name: s.name,
          color: s.color ?? undefined,
          appliedBy: "ai",
          aiModel: suggestModel?.model,
          aiProvider: suggestModel?.provider,
          rationale: s.rationale,
        },
      },
      {
        onSuccess: () => {
          setSuggestions((prev) => prev.filter((x) => x.name !== s.name));
        },
      },
    );
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} data-testid={`tag-editor-${entityType}-${entityId}`}>
      {(assignments as TagAssignmentView[]).map((a) => (
        <TagChip
          key={a.id}
          tag={a.tag}
          appliedBy={a.appliedBy}
          size={size}
          onRemove={() => removeAssignment(a.tagId)}
          title={
            a.appliedBy === "ai" && a.rationale
              ? `AI (${a.aiProvider ?? ""} ${a.aiModel ?? ""}): ${a.rationale}`
              : a.tag.name
          }
        />
      ))}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            data-testid={`tag-editor-add-${entityType}-${entityId}`}
            aria-label="Add tag"
          >
            <Plus className="h-3 w-3" />
            <span>Tag</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align={align} className="w-72 p-2" sideOffset={4}>
          <div className="flex items-center gap-2 mb-2">
            <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Find or create tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (exactMatch) addExisting(exactMatch.id);
                  else addNew(search);
                }
              }}
              className="h-7 text-xs"
              data-testid="tag-editor-search"
            />
          </div>
          <div className="max-h-56 overflow-auto -mx-1">
            {filteredTags.slice(0, 30).map((t) => {
              const c = tagColorClasses(t.color);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => addExisting(t.id)}
                  className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-secondary text-left"
                  data-testid={`tag-editor-option-${t.slug}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", c.dot)} />
                    <span className="text-xs truncate">{t.name}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{t.usageCount}</span>
                </button>
              );
            })}
            {filteredTags.length === 0 && search.trim() && !exactMatch && (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                No matches.
              </div>
            )}
          </div>
          {search.trim() && !exactMatch && (
            <div className="border-t border-border mt-2 pt-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Create new tag
              </div>
              <div className="flex flex-wrap items-center gap-1 mb-2">
                {TAG_COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => addNew(search, color)}
                    className={cn(
                      "h-5 w-5 rounded-full border border-border/60 hover:ring-2",
                      tagColorClasses(color).dot,
                      tagColorClasses(color).ring,
                    )}
                    aria-label={`Create tag with color ${color}`}
                    data-testid={`tag-editor-create-color-${color}`}
                  />
                ))}
              </div>
              <Button
                size="sm"
                className="w-full h-7 text-xs"
                onClick={() => addNew(search)}
                data-testid="tag-editor-create-default"
              >
                <Plus className="h-3 w-3 mr-1" />
                Create "{search.trim()}"
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {showSuggest && (
        <Popover open={suggestOpen} onOpenChange={setSuggestOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                runSuggest();
              }}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10 transition-colors"
              data-testid={`tag-editor-suggest-${entityType}-${entityId}`}
              aria-label="Suggest tags with AI"
            >
              {suggestMut.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              <span>Suggest</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align={align} className="w-80 p-3" sideOffset={4}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                AI Tag Suggestions
              </div>
              {suggestModel && (
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  {suggestModel.provider}/{suggestModel.model}
                </span>
              )}
            </div>
            {suggestMut.isPending && (
              <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Analyzing…
              </div>
            )}
            {!suggestMut.isPending && suggestions.length === 0 && (
              <div className="text-xs text-muted-foreground py-2">No suggestions.</div>
            )}
            <div className="space-y-2 max-h-72 overflow-auto">
              {suggestions.map((s) => {
                const color = s.color ?? "slate";
                const c = tagColorClasses(color);
                return (
                  <div
                    key={`${s.name}-${s.slug ?? "new"}`}
                    className="rounded border border-border/60 bg-secondary/30 p-2 space-y-1.5"
                    data-testid={`tag-suggestion-${s.slug ?? s.name}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          c.chip,
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
                        {s.name}
                        {s.isNew && <span className="text-[9px] uppercase opacity-70">new</span>}
                      </span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {(s.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">{s.rationale}</p>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-6 text-[10px] px-2"
                        onClick={() => applySuggestion(s)}
                        data-testid={`tag-suggestion-apply-${s.slug ?? s.name}`}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Apply
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
