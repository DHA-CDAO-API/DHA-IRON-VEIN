import React, { useCallback, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useGetProfile } from "@workspace/api-client-react";

export type FpconLevel = "ALPHA" | "BRAVO" | "CHARLIE" | "DELTA";

const STORAGE_KEY = "iron-vein:fpcon-level";
const FPCON_CHANGE_EVENT = "iron-vein:fpcon-change";
const DEFAULT_LEVEL: FpconLevel = "BRAVO";
const LEVELS: FpconLevel[] = ["ALPHA", "BRAVO", "CHARLIE", "DELTA"];

const STYLES: Record<FpconLevel, string> = {
  ALPHA: "bg-emerald-600/15 border-emerald-500/40 text-emerald-300",
  BRAVO: "bg-amber-400/20 border-amber-400/50 text-amber-300 animate-pulse",
  CHARLIE:
    "bg-orange-500/20 border-orange-500/50 text-orange-300 animate-pulse",
  DELTA:
    "bg-destructive/20 border-destructive/50 text-destructive animate-pulse [animation-duration:1s]",
};

const PICKER_STYLES: Record<FpconLevel, string> = {
  ALPHA: "bg-emerald-600/15 border-emerald-500/40 text-emerald-300",
  BRAVO: "bg-amber-400/20 border-amber-400/50 text-amber-300",
  CHARLIE: "bg-orange-500/20 border-orange-500/50 text-orange-300",
  DELTA: "bg-destructive/20 border-destructive/50 text-destructive",
};

const DESCRIPTIONS: Record<FpconLevel, string> = {
  ALPHA: "General threat possible. Routine posture.",
  BRAVO: "Increased, predictable threat. Heightened vigilance sustained.",
  CHARLIE: "Incident occurred or imminent. Selective protective measures.",
  DELTA: "Specific attack expected or underway. Maximum protection.",
};

const ROLES_ALLOWED_TO_EDIT = new Set(["commander", "analyst"]);

function isFpconLevel(value: unknown): value is FpconLevel {
  return typeof value === "string" && (LEVELS as string[]).includes(value);
}

function readStoredLevel(): FpconLevel {
  if (typeof window === "undefined") return DEFAULT_LEVEL;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (isFpconLevel(value)) return value;
  } catch {
    // ignore — storage may be unavailable
  }
  return DEFAULT_LEVEL;
}

function subscribe(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(FPCON_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(FPCON_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function useFpconLevel(): [FpconLevel, (level: FpconLevel) => void] {
  const level = useSyncExternalStore(
    subscribe,
    readStoredLevel,
    () => DEFAULT_LEVEL,
  );
  const setLevel = useCallback((next: FpconLevel) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — storage may be unavailable
    }
    window.dispatchEvent(new CustomEvent(FPCON_CHANGE_EVENT));
  }, []);
  return [level, setLevel];
}

export default function FpconPill({ level: levelProp }: { level?: FpconLevel } = {}) {
  const [storedLevel, setLevel] = useFpconLevel();
  const [open, setOpen] = useState(false);
  const { data: profile } = useGetProfile();

  // When a caller pins a level via the prop, render a static pill
  // (used by tests / standalone previews).
  const level = levelProp ?? storedLevel;
  // Default to deny-until-known: do not expose the edit affordance
  // until the profile has loaded and is in the allow-list.
  const canEdit =
    levelProp === undefined &&
    !!profile &&
    ROLES_ALLOWED_TO_EDIT.has(profile.role);

  const pillClass = `px-2 py-1 text-xs font-mono rounded font-bold tracking-wider border ${STYLES[level]}`;

  if (!canEdit) {
    return (
      <div
        className={pillClass}
        data-testid="fpcon-pill"
        title={DESCRIPTIONS[level]}
      >
        FPCON: {level}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${pillClass} cursor-pointer hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
          data-testid="fpcon-pill"
          aria-label={`Change FPCON level (current: ${level})`}
        >
          FPCON: {level}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="px-2 pt-1 pb-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
          Set Theater FPCON
        </div>
        <div className="flex flex-col gap-0.5">
          {LEVELS.map((opt) => {
            const active = opt === level;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  setLevel(opt);
                  setOpen(false);
                }}
                className={`flex items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary focus:outline-none focus-visible:bg-secondary ${
                  active ? "bg-secondary/60" : ""
                }`}
                data-testid={`fpcon-option-${opt.toLowerCase()}`}
                aria-pressed={active}
              >
                <span
                  className={`mt-0.5 inline-flex w-16 shrink-0 justify-center rounded border px-1.5 py-0.5 text-[10px] font-mono font-bold tracking-wider ${PICKER_STYLES[opt]}`}
                >
                  {opt}
                </span>
                <span className="flex-1 text-xs text-muted-foreground leading-snug">
                  {DESCRIPTIONS[opt]}
                </span>
                {active && (
                  <Check className="h-3.5 w-3.5 mt-1 shrink-0 text-primary" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
