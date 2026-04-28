import React from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";

export interface LiveClockProps {
  className?: string;
  showLocal?: boolean;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatZulu(d: Date) {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

function formatLocal(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDate(d: Date) {
  // e.g. 28 APR 2026
  const month = d
    .toLocaleString(undefined, { month: "short" })
    .toUpperCase();
  return `${pad(d.getDate())} ${month} ${d.getFullYear()}`;
}

export default function LiveClock({ className, showLocal = true }: LiveClockProps) {
  const [now, setNow] = React.useState<Date>(() => new Date());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className={cn(
        "items-center gap-2 text-muted-foreground font-mono text-xs hidden sm:flex",
        className
      )}
      aria-label="Current time"
    >
      <Clock className="h-4 w-4" />
      <div className="flex items-center gap-2">
        <span className="text-foreground/90">{formatZulu(now)}</span>
        <span className="text-muted-foreground/70">ZULU</span>
        {showLocal && (
          <>
            <span className="text-border">|</span>
            <span>{formatLocal(now)}</span>
            <span className="text-muted-foreground/70">LOCAL</span>
          </>
        )}
        <span className="text-border">|</span>
        <span className="text-muted-foreground/80">{formatDate(now)}</span>
      </div>
    </div>
  );
}
