export type Persona =
  | "all"
  | "commander"
  | "logistician"
  | "medical_planner"
  | "analyst";

export const PERSONA_OPTIONS: Array<{ id: Persona; label: string }> = [
  { id: "all", label: "All" },
  { id: "commander", label: "Commander" },
  { id: "logistician", label: "Logistician" },
  { id: "medical_planner", label: "Medical Planner" },
  { id: "analyst", label: "Analyst" },
];

export type WidgetId =
  | "ai_brief"
  | "mission_matrix"
  | "leaderboard"
  | "cascade"
  | "cold_chain_pulse"
  | "wbb_abo"
  | "activity_stream"
  | "map";

export const ALL_WIDGETS: WidgetId[] = [
  "ai_brief",
  "mission_matrix",
  "leaderboard",
  "cascade",
  "cold_chain_pulse",
  "wbb_abo",
  "activity_stream",
  "map",
];

/**
 * Per-persona ordered list of widgets that flow inside the main grid.
 * The "ai_brief" card is always rendered full-width on top, but we still
 * include it in each persona list so the per-persona file is self-describing.
 */
export const PERSONA_WIDGET_ORDER: Record<Persona, WidgetId[]> = {
  all: [
    "ai_brief",
    "mission_matrix",
    "leaderboard",
    "cascade",
    "cold_chain_pulse",
    "wbb_abo",
    "activity_stream",
    "map",
  ],
  commander: [
    "ai_brief",
    "mission_matrix",
    "cascade",
    "leaderboard",
    "wbb_abo",
    "cold_chain_pulse",
    "map",
    "activity_stream",
  ],
  logistician: [
    "ai_brief",
    "leaderboard",
    "cold_chain_pulse",
    "map",
    "cascade",
    "mission_matrix",
    "wbb_abo",
    "activity_stream",
  ],
  medical_planner: [
    "ai_brief",
    "wbb_abo",
    "cold_chain_pulse",
    "leaderboard",
    "mission_matrix",
    "cascade",
    "activity_stream",
    "map",
  ],
  analyst: [
    "ai_brief",
    "leaderboard",
    "cascade",
    "mission_matrix",
    "activity_stream",
    "cold_chain_pulse",
    "wbb_abo",
    "map",
  ],
};

const STORAGE_KEY = "command:overview:persona";

export function readPersistedPersona(): Persona {
  if (typeof window === "undefined") return "all";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return "all";
    const allowed = PERSONA_OPTIONS.some((o) => o.id === raw);
    return allowed ? (raw as Persona) : "all";
  } catch {
    return "all";
  }
}

export function writePersistedPersona(p: Persona): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, p);
  } catch {
    /* ignore */
  }
}
