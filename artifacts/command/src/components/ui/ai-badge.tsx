import * as React from "react";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export interface AiBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  size?: "sm" | "md";
}

export function AiBadge({
  label = "Powered by AI",
  size = "sm",
  className,
  ...props
}: AiBadgeProps) {
  const dims =
    size === "md"
      ? "text-xs px-2.5 py-1 gap-1.5"
      : "text-[10px] px-2 py-0.5 gap-1";
  const iconDim = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border whitespace-nowrap",
        "border-primary/40 bg-primary/10 text-primary font-medium tracking-wide uppercase",
        dims,
        className
      )}
      title={label}
      {...props}
    >
      <Sparkles className={cn(iconDim, "shrink-0")} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export default AiBadge;
