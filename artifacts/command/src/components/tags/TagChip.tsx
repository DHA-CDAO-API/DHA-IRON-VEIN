import React from "react";
import { Link } from "wouter";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { tagColorClasses } from "./tag-colors";

type Tag = {
  id?: string;
  name: string;
  slug?: string;
  color?: string | null;
};

export function TagChip({
  tag,
  appliedBy,
  onRemove,
  asLink = true,
  size = "sm",
  className,
  title,
}: {
  tag: Tag;
  appliedBy?: "manual" | "ai" | string;
  onRemove?: () => void;
  asLink?: boolean;
  size?: "sm" | "xs";
  className?: string;
  title?: string;
}) {
  const c = tagColorClasses(tag.color);
  const sizeCls =
    size === "xs"
      ? "text-[10px] px-1.5 py-0.5 gap-1"
      : "text-[11px] px-2 py-0.5 gap-1.5";

  const inner = (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium tracking-wide",
        sizeCls,
        c.chip,
        className,
      )}
      title={title ?? tag.name}
      data-testid={`tag-chip-${tag.slug ?? tag.name}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} aria-hidden />
      <span className="truncate max-w-[140px]">{tag.name}</span>
      {appliedBy === "ai" && (
        <Sparkles className="h-3 w-3 text-current opacity-80" aria-label="Applied by AI" />
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-white/10"
          aria-label={`Remove ${tag.name} tag`}
          data-testid={`tag-chip-remove-${tag.slug ?? tag.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );

  if (asLink && tag.slug) {
    return (
      <Link
        href={`/tags/${tag.slug}`}
        className="inline-flex"
        data-testid={`tag-chip-link-${tag.slug}`}
      >
        {inner}
      </Link>
    );
  }
  return inner;
}
