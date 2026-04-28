import React from "react";

export type FpconLevel = "ALPHA" | "BRAVO" | "CHARLIE" | "DELTA";

const STYLES: Record<FpconLevel, string> = {
  ALPHA:
    "bg-teal-500/15 border-teal-500/40 text-teal-300",
  BRAVO:
    "bg-amber-500/20 border-amber-500/50 text-amber-300 animate-pulse",
  CHARLIE:
    "bg-orange-500/20 border-orange-500/50 text-orange-300 animate-pulse",
  DELTA:
    "bg-destructive/20 border-destructive/50 text-destructive animate-pulse [animation-duration:1s]",
};

export default function FpconPill({ level = "BRAVO" as FpconLevel }: { level?: FpconLevel }) {
  return (
    <div
      className={`px-2 py-1 text-xs font-mono rounded font-bold tracking-wider border ${STYLES[level]}`}
      data-testid="fpcon-pill"
    >
      FPCON: {level}
    </div>
  );
}
