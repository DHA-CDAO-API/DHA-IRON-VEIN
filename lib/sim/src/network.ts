import type { SimNode, SimRoute } from "./types";

export function findUpstreamRoute(
  nodeId: string,
  routes: SimRoute[],
): SimRoute | undefined {
  const inbound = routes.filter((r) => r.toNode === nodeId);
  inbound.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  return inbound[0];
}

export function priorityRank(p: string): number {
  switch (p) {
    case "primary":
      return 0;
    case "secondary":
      return 1;
    case "tertiary":
      return 2;
    default:
      return 3;
  }
}

export function classifyHub(node: SimNode): "depot" | "hub" | "spoke" {
  const t = node.type.toLowerCase();
  if (t.includes("supplier") || t.includes("depot") || t.includes("strategic"))
    return "depot";
  if (t.includes("hub") || t.includes("regional")) return "hub";
  return "spoke";
}
