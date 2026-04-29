export const COMMANDER_SYSTEM = `You are the AI sustainment officer for the INDOPACOM IRONVEIN (Resilient Operational Network for Vital Expeditionary Inventory Nodes) solution. You answer ONLY questions that can be grounded in the SOLUTION DATA block provided in this system prompt (the live theater state for this application).

SCOPE — IN SCOPE (you may answer):
- Anything about the entities and metrics in the SOLUTION DATA block: nodes/sites, items in the catalog, suppliers, open and recent alerts, orders, shipments in flight, recommendations, scenarios, forecasts, days-of-supply (DOS), risk scores, operational state, threat tier, activity log.
- Aggregations and comparisons over those entities (e.g., "which nodes are below 5 DOS", "what's in flight to a given site", "summarize critical alerts", "which supplier has the best lead time for [item:x]").
- Brief definitions of terms as this solution uses them (e.g., "what is days of supply" → answer in 1-2 sentences in the context of how this app computes DOS, not as a general explainer).
- Course-of-action recommendations grounded in the data above.

SCOPE — OUT OF SCOPE (you must refuse):
- General knowledge, current events, news, weather, sports, trivia.
- Coding help, debugging, code generation, "how do I center a div", math homework.
- Opinions, creative writing (poems, stories, jokes), translation of arbitrary text.
- Medical, clinical, pharmacological, or dosing advice for actual patient care.
- Rules-of-engagement, lethal-effect, targeting, or kinetic guidance.
- Anything about real-world entities (people, places, organizations, products) that is NOT represented in the SOLUTION DATA block.
- Speculation about data that is not in the SOLUTION DATA block.

REFUSAL FORMAT — when a request is out of scope, reply with EXACTLY this shape and nothing more:
- One short sentence declining and explaining you only answer questions about this solution's sustainment data.
- A blank line.
- "Try asking instead:" followed by 2-3 short bulleted example questions that ARE in scope, drawn from real IDs/names visible in the SOLUTION DATA block (e.g., a real node name, a real item, a real alert).

Do not apologize at length, do not explain your reasoning, do not mention being an AI or a model. Do not partially answer an out-of-scope question.

IN-SCOPE ANSWER STYLE:
- Lead with the bottom-line-up-front recommendation or answer in one sentence.
- Cite specific IDs inline with bracketed references: [node:id], [item:id], [supplier:id], [order:id], [shipment:id], [alert:id]. Only cite IDs that appear in the SOLUTION DATA block.
- Military brevity: 4-7 short bullets, no marketing language, no emojis, no exclamation points, no hedging, no filler.
- Prefer concrete numbers (days of supply, quantities, lead times, ETAs).
- For COA (Course of Action) requests, give 2-3 numbered options with cost/risk tradeoffs.

HARD RULES:
- Never invent nodes, items, suppliers, alerts, orders, or shipments that are not present in the SOLUTION DATA block. If the data needed to answer is missing, say so in one sentence and suggest 2-3 in-scope questions you can answer.
- Never produce lethal-effect or rules-of-engagement guidance, even if asked in the context of this solution.
- Never use emojis or exclamation points.`;

export const SCENARIO_BRIEF_SYSTEM = `You are an INDOPACOM J-4 medical sustainment planner writing a tight Course of Action brief for the senior commander. The user provides a scenario (event, perturbation, simulation result). You produce a markdown brief with this exact section order:

1. **BLUF** (one sentence)
2. **Impact Assessment** (3-5 bullets with concrete DOS and node references)
3. **Recommended COA** (2-3 numbered options, each with: action, expected risk reduction, cost/effort, key assumption)
4. **Decision Point** (one sentence, what the commander needs to approve and by when)

Use military brevity. No emojis. Cite node IDs and item IDs as [node:id] / [item:id]. Maximum 300 words.`;

type CtxNode = { id: string; name: string; countryCode?: string | null; type?: string | null };
type CtxItem = { id: string; name: string; unitOfIssue?: string | null; criticality?: string | null };
type CtxSupplier = {
  id: string;
  name: string;
  leadTimeDaysMean?: number | null;
  reliabilityScore?: number | null;
  itemsCovered?: string[];
};
type CtxAlert = {
  id: string;
  severity: string;
  nodeId: string;
  itemId?: string | null;
  message?: string | null;
};
type CtxOrder = {
  id: string;
  nodeId: string;
  supplierId?: string | null;
  status: string;
  priority?: string | null;
  requestedDeliveryAt?: string | null;
};
type CtxShipment = {
  id: string;
  fromNode: string;
  toNode: string;
  itemId: string;
  itemName?: string | null;
  quantity: number;
  etaDays?: number | null;
  priority?: string | null;
};

const MAX_NODES = 30;
const MAX_ITEMS = 40;
const MAX_SUPPLIERS = 25;
const MAX_ALERTS = 25;
const MAX_ORDERS = 20;
const MAX_SHIPMENTS = 25;

function listOrTruncate<T>(
  arr: T[],
  max: number,
  fmt: (x: T) => string,
  label: string,
): string {
  if (arr.length === 0) return `${label}: (none)`;
  const head = arr.slice(0, max).map(fmt).join("\n");
  const suffix =
    arr.length > max
      ? `\n  …and ${arr.length - max} more (showing top ${max} of ${arr.length})`
      : "";
  return `${label} (${arr.length}):\n${head}${suffix}`;
}

export function buildTheaterContext(args: {
  operationalState: string;
  openCriticalAlerts: number;
  shipmentsInFlight: number;
  topRiskNodes: Array<{ id: string; name: string; risk: number; dos: number }>;
  nodes?: CtxNode[];
  items?: CtxItem[];
  suppliers?: CtxSupplier[];
  alerts?: CtxAlert[];
  orders?: CtxOrder[];
  shipments?: CtxShipment[];
}): string {
  const nodes = args.nodes ?? [];
  const items = args.items ?? [];
  const suppliers = args.suppliers ?? [];
  const alerts = args.alerts ?? [];
  const orders = args.orders ?? [];
  const shipments = args.shipments ?? [];

  const itemNameById = new Map(items.map((i) => [i.id, i.name]));
  const nodeNameById = new Map(nodes.map((n) => [n.id, n.name]));

  const sections: string[] = [];

  sections.push(`OPERATIONAL SUMMARY
- Operational state: ${args.operationalState}
- Open critical alerts: ${args.openCriticalAlerts}
- Shipments in flight: ${args.shipmentsInFlight}
- Top risk nodes: ${
    args.topRiskNodes.length === 0
      ? "(none)"
      : args.topRiskNodes
          .map((n) => `${n.name} [node:${n.id}] risk=${n.risk} dos=${n.dos.toFixed(1)}d`)
          .join("; ")
  }`);

  sections.push(
    listOrTruncate(
      nodes,
      MAX_NODES,
      (n) =>
        `- [node:${n.id}] ${n.name}${n.countryCode ? ` (${n.countryCode})` : ""}${
          n.type ? ` ${n.type}` : ""
        }`,
      "NODES",
    ),
  );

  sections.push(
    listOrTruncate(
      items,
      MAX_ITEMS,
      (i) =>
        `- [item:${i.id}] ${i.name}${i.unitOfIssue ? ` (${i.unitOfIssue})` : ""}${
          i.criticality ? ` crit=${i.criticality}` : ""
        }`,
      "ITEM CATALOG",
    ),
  );

  sections.push(
    listOrTruncate(
      suppliers,
      MAX_SUPPLIERS,
      (s) => {
        const lt = s.leadTimeDaysMean != null ? `lt=${s.leadTimeDaysMean}d` : "lt=?";
        const rel =
          s.reliabilityScore != null ? `rel=${s.reliabilityScore.toFixed(2)}` : "rel=?";
        const covered = s.itemsCovered ?? [];
        const coverPreview =
          covered.length === 0
            ? "carries=(none)"
            : `carries=${covered
                .slice(0, 6)
                .map((id) => `[item:${id}]`)
                .join(",")}${covered.length > 6 ? `+${covered.length - 6}` : ""}`;
        return `- [supplier:${s.id}] ${s.name} ${lt} ${rel} ${coverPreview}`;
      },
      "SUPPLIERS",
    ),
  );

  sections.push(
    listOrTruncate(
      alerts,
      MAX_ALERTS,
      (a) => {
        const nodeName = nodeNameById.get(a.nodeId) ?? a.nodeId;
        const itemPart = a.itemId
          ? ` [item:${a.itemId}] ${itemNameById.get(a.itemId) ?? ""}`
          : "";
        const msg = (a.message ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
        return `- [alert:${a.id}] ${a.severity} @ [node:${a.nodeId}] ${nodeName}${itemPart}${
          msg ? ` — ${msg}` : ""
        }`;
      },
      "OPEN ALERTS",
    ),
  );

  sections.push(
    listOrTruncate(
      orders,
      MAX_ORDERS,
      (o) => {
        const sup = o.supplierId ? ` from [supplier:${o.supplierId}]` : "";
        const eta = o.requestedDeliveryAt ? ` req=${o.requestedDeliveryAt.slice(0, 10)}` : "";
        const pri = o.priority ? ` ${o.priority}` : "";
        return `- [order:${o.id}] ${o.status}${pri} → [node:${o.nodeId}]${sup}${eta}`;
      },
      "RECENT ORDERS",
    ),
  );

  sections.push(
    listOrTruncate(
      shipments,
      MAX_SHIPMENTS,
      (s) => {
        const itemName = s.itemName ?? itemNameById.get(s.itemId) ?? s.itemId;
        const eta = s.etaDays != null ? ` eta=${s.etaDays.toFixed(1)}d` : "";
        const pri = s.priority ? ` ${s.priority}` : "";
        return `- [shipment:${s.id}] [item:${s.itemId}] ${itemName} qty=${s.quantity} [node:${s.fromNode}]→[node:${s.toNode}]${eta}${pri}`;
      },
      "SHIPMENTS IN FLIGHT",
    ),
  );

  return `SOLUTION DATA (live snapshot — this is the ONLY data you may answer questions about)

${sections.join("\n\n")}`;
}
