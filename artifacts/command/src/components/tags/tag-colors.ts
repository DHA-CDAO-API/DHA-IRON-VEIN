export const TAG_COLOR_OPTIONS = [
  "slate",
  "sky",
  "cyan",
  "emerald",
  "amber",
  "orange",
  "rose",
  "fuchsia",
  "violet",
  "indigo",
] as const;

export type TagColor = (typeof TAG_COLOR_OPTIONS)[number];

const COLOR_CLASSES: Record<string, { chip: string; dot: string; ring: string }> = {
  slate:    { chip: "bg-slate-500/15 text-slate-200 border-slate-500/30",     dot: "bg-slate-400",    ring: "ring-slate-400/40" },
  sky:      { chip: "bg-sky-500/15 text-sky-200 border-sky-500/30",           dot: "bg-sky-400",      ring: "ring-sky-400/40" },
  cyan:     { chip: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30",        dot: "bg-cyan-400",     ring: "ring-cyan-400/40" },
  emerald:  { chip: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30", dot: "bg-emerald-400",  ring: "ring-emerald-400/40" },
  amber:    { chip: "bg-amber-500/15 text-amber-200 border-amber-500/30",     dot: "bg-amber-400",    ring: "ring-amber-400/40" },
  orange:   { chip: "bg-orange-500/15 text-orange-200 border-orange-500/30",  dot: "bg-orange-400",   ring: "ring-orange-400/40" },
  rose:     { chip: "bg-rose-500/15 text-rose-200 border-rose-500/30",        dot: "bg-rose-400",     ring: "ring-rose-400/40" },
  fuchsia:  { chip: "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/30", dot: "bg-fuchsia-400",  ring: "ring-fuchsia-400/40" },
  violet:   { chip: "bg-violet-500/15 text-violet-200 border-violet-500/30",  dot: "bg-violet-400",   ring: "ring-violet-400/40" },
  indigo:   { chip: "bg-indigo-500/15 text-indigo-200 border-indigo-500/30",  dot: "bg-indigo-400",   ring: "ring-indigo-400/40" },
};

export function tagColorClasses(color: string | undefined | null) {
  return COLOR_CLASSES[(color ?? "slate").toLowerCase()] ?? COLOR_CLASSES.slate;
}
