import { completeChat, resolveModel } from "./provider";
import type { AIProvider } from "./types";

export const TAG_SUGGESTER_SYSTEM = `You are a librarian for an INDOPACOM medical sustainment platform. You suggest short, useful tags for a single record. Tags should help operators discover records that share a context — a region, a mission, an in-progress disruption, a custodian, a priority class, a category of risk, etc.

You will be shown:
- A "RECORD" block describing one entity (a site, item, supplier, order, shipment, scenario, alert, or blood lot).
- A "EXISTING TAG LIBRARY" listing tags already used in this workspace, with short descriptions.

Return STRICT JSON ONLY (no markdown, no commentary) of the form:
{
  "suggestions": [
    {
      "name": "Pacific Theater",
      "isNew": false,
      "rationale": "Site is in Japan, falls in the Pacific theater bucket the team already uses.",
      "confidence": 0.9
    }
  ]
}

RULES:
- Suggest 3-7 tags total.
- PREFER reusing existing tags from the library when they fit. Set isNew=false and use the EXACT existing name.
- Only propose new tags (isNew=true) when nothing in the library matches.
- Tag names: 1-3 words, Title Case, no hashes, no punctuation, no emojis.
- Never invent facts not present in the RECORD.
- Confidence is 0.0-1.0; only mark >= 0.85 if you are very sure.
- Output JSON only.`;

export type TagSuggestion = {
  name: string;
  isNew: boolean;
  rationale: string;
  confidence: number;
};

export type ExistingTag = {
  name: string;
  slug: string;
  description?: string | null;
};

export async function suggestTagsForEntity(args: {
  provider: AIProvider;
  model?: string;
  recordSummary: string;
  existingTags: ExistingTag[];
  maxOutputTokens?: number;
}): Promise<{ suggestions: TagSuggestion[]; provider: AIProvider; model: string }> {
  const provider = args.provider;
  const model = resolveModel(provider, args.model);
  const libraryBlock =
    args.existingTags.length === 0
      ? "EXISTING TAG LIBRARY: (empty)"
      : `EXISTING TAG LIBRARY (${args.existingTags.length}):\n${args.existingTags
          .slice(0, 80)
          .map((t) => `- ${t.name}${t.description ? ` — ${t.description}` : ""}`)
          .join("\n")}`;

  const userMessage = `RECORD\n${args.recordSummary}\n\n${libraryBlock}`;

  const raw = await completeChat({
    provider,
    model,
    system: TAG_SUGGESTER_SYSTEM,
    messages: [{ role: "user", content: userMessage }],
    maxOutputTokens: args.maxOutputTokens ?? 600,
  });

  const parsed = parseSuggestionJson(raw);
  return { suggestions: parsed, provider, model };
}

function parseSuggestionJson(raw: string): TagSuggestion[] {
  if (!raw || raw.trim().length === 0) return [];
  // The model occasionally wraps the JSON in code fences. Strip them.
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  // Find the first JSON object boundary if there is leading prose.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return [];
  const sliced = cleaned.slice(start, end + 1);
  let payload: unknown;
  try {
    payload = JSON.parse(sliced);
  } catch {
    return [];
  }
  const suggestions = (payload as { suggestions?: unknown[] })?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions
    .map((raw): TagSuggestion | null => {
      if (typeof raw !== "object" || raw === null) return null;
      const r = raw as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (!name) return null;
      const isNew = typeof r.isNew === "boolean" ? r.isNew : Boolean(r.isNew);
      const rationale =
        typeof r.rationale === "string" ? r.rationale.trim() : "";
      const confidence =
        typeof r.confidence === "number"
          ? Math.max(0, Math.min(1, r.confidence))
          : 0.5;
      return { name, isNew, rationale, confidence };
    })
    .filter((s): s is TagSuggestion => s !== null)
    .slice(0, 8);
}
