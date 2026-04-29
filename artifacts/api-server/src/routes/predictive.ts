import { Router, type IRouter } from "express";
import {
  db,
  recommendations as recsTable,
  orders,
  orderLines,
  activityEntries,
  items as itemsTable,
  nodes as nodesTable,
  suppliers as suppliersTable,
  procedureSupplies,
} from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { loadSimContext } from "../lib/ctx";
import {
  computeDailyDemand,
  generateRecommendations,
  generateTlammSelfReplenishment,
  projectDaysOfSupply,
} from "@workspace/sim";
import { invalidateSimCache } from "../lib/ctx";
import { mapRecommendationToApi } from "../lib/mappers";
import { buildCompanionItemsByItemId } from "../lib/companion-items";
import { requireRole } from "../middlewares/authMiddleware";
import { encryptText } from "../lib/crypto";
import { audit } from "../lib/audit";

const router: IRouter = Router();

router.post("/predictive/forecast", async (req, res, next) => {
  try {
    const body = req.body as {
      nodeIds?: string[];
      itemIds?: string[];
      horizonDays?: number;
      operationalState?: string | null;
    };
    const horizon = Math.max(1, Math.min(45, body.horizonDays ?? 14));
    const ctx = await loadSimContext();

    const requestedNodeIds = Array.isArray(body.nodeIds) ? body.nodeIds : [];
    const nodeIds = requestedNodeIds.filter((id) => ctx.ctx.profiles.has(id));
    if (nodeIds.length === 0) {
      return res.status(404).json({ error: "no matching nodes" });
    }

    const requestedItemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
    const items =
      requestedItemIds.length > 0
        ? ctx.ctx.items.filter((i) => requestedItemIds.includes(i.id))
        : ctx.ctx.items;

    const series: Array<{
      nodeId: string;
      itemId: string;
      itemName: string;
      points: Array<{ day: number; value: number; label?: string }>;
    }> = [];

    for (const nodeId of nodeIds) {
      const baseProfile = ctx.ctx.profiles.get(nodeId);
      if (!baseProfile) continue;
      const profile =
        typeof body.operationalState === "string" && body.operationalState
          ? { ...baseProfile, operationalState: body.operationalState }
          : baseProfile;
      const dailyDemand = computeDailyDemand({
        profile,
        items,
        operationalState: ctx.ctx.states.get(profile.operationalState),
        itemSkew: ctx.ctx.itemSkew,
        historicalBurnByItem: ctx.historicalBurn.get(nodeId),
      });
      const balanceMap = new Map<string, number>();
      for (const b of ctx.ctx.balances) {
        if (b.nodeId === nodeId) balanceMap.set(b.itemId, b.onHand);
      }

      for (const it of items) {
        const onHand0 = balanceMap.get(it.id) ?? 0;
        const burn = dailyDemand.find((d) => d.itemId === it.id)?.quantity ?? 0;
        const points: Array<{ day: number; value: number; label?: string }> = [];
        let onHand = onHand0;
        for (let d = 0; d <= horizon; d++) {
          const remaining = Math.max(0, onHand);
          points.push({
            day: d,
            value: Number(remaining.toFixed(1)),
            label: `${projectDaysOfSupply(remaining, burn).toFixed(1)} DOS`,
          });
          onHand -= burn;
        }
        series.push({ nodeId, itemId: it.id, itemName: it.name, points });
      }
    }

    res.json({ series });
  } catch (err) {
    next(err);
  }
});

router.get("/predictive/recommendations", async (req, res, next) => {
  try {
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : undefined;
    const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
    const ctx = await loadSimContext();
    // For TLAMM-first sourcing the engine needs the full node + balance
    // graph (so it can resolve a downstream MTF's primary TLAMM and check
    // its on-hand). Generate against the full context, then filter to the
    // caller's nodeId if one was supplied. Also fold in TLAMM
    // self-replenishment recs ("fix the hub") so commanders see them
    // alongside spoke recs.
    const liveRecs = generateRecommendations({
      nodes: ctx.ctx.nodes,
      routes: ctx.ctx.routes,
      items: ctx.ctx.items,
      balances: ctx.ctx.balances,
      profiles: ctx.ctx.profiles,
      states: ctx.ctx.states,
      suppliers: ctx.suppliers,
      itemSkew: ctx.ctx.itemSkew,
      watchDays: ctx.ctx.watchDays,
      criticalDays: ctx.ctx.criticalDays,
      paddingDays: ctx.paddingDays,
    });
    const selfReplenishRecs = generateTlammSelfReplenishment({
      nodes: ctx.ctx.nodes,
      routes: ctx.ctx.routes,
      items: ctx.ctx.items,
      balances: ctx.ctx.balances,
      profiles: ctx.ctx.profiles,
      states: ctx.ctx.states,
      suppliers: ctx.suppliers,
      itemSkew: ctx.ctx.itemSkew,
      watchDays: ctx.ctx.watchDays,
      criticalDays: ctx.ctx.criticalDays,
      paddingDays: ctx.paddingDays,
    });
    const merged = [...liveRecs, ...selfReplenishRecs].sort(
      (a, b) => b.expectedRiskReduction - a.expectedRiskReduction,
    );
    const filteredByNode = nodeId ? merged.filter((r) => r.nodeId === nodeId) : merged;
    const recs = filteredByNode.slice(0, limit);

    const [promoted, itemRows, nodeRows, supplierRows] = await Promise.all([
      db.select().from(recsTable),
      db.select().from(itemsTable),
      db.select().from(nodesTable),
      db.select().from(suppliersTable),
    ]);
    const promotedByLogicalId = new Map(
      promoted.filter((p) => p.promotedOrderId).map((p) => [p.id, p]),
    );
    const itemNamesById = new Map(itemRows.map((i) => [i.id, i.name]));
    const itemUnitPriceUsdById = new Map(
      itemRows.map((i) => [i.id, Number(i.unitPriceUsd) || 0]),
    );

    // Build companion-items index: for each itemId, list other items that
    // appear together in any procedure, tagged with the highest-priority
    // tier they're used at and a representative procedure name.
    const companionItemsByItemId = await buildCompanionItemsByItemId();

    const lookups = {
      itemNamesById,
      nodeNamesById: new Map(nodeRows.map((n) => [n.id, n.name])),
      supplierNamesById: new Map(supplierRows.map((s) => [s.id, s.name])),
      supplierFromNodeById: new Map<string, string>(),
      companionItemsByItemId,
      itemUnitPriceUsdById,
    };
    const generatedAt = new Date().toISOString();

    res.json(
      recs.map((r) => {
        const persisted = promotedByLogicalId.get(r.id);
        return mapRecommendationToApi(r, {
          status: persisted ? "PROMOTED" : "OPEN",
          promotedOrderId: persisted?.promotedOrderId ?? null,
          generatedAt,
          lookups,
        });
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.post(
  "/predictive/recommendations/:recommendationId/promote",
  requireRole("commander", "logistician"),
  async (req, res, next) => {
    try {
      const recId = String(req.params.recommendationId);
      const ctx = await loadSimContext();

      const overrides = (req.body ?? {}) as {
        quantity?: number;
        supplierId?: string;
        etaDays?: number;
        priority?: string;
        /**
         * When true, the promotion folds in the recommended item's companion
         * supplies (every item that shares a procedure with it) as additional
         * order lines, each scaled to one event-equivalent.
         */
        includeCompanionSupplies?: boolean;
      };
      const includeCompanions = overrides.includeCompanionSupplies === true;
      const allowedPriorities = new Set(["ROUTINE", "URGENT", "FLASH"]);
      const overridePriority =
        typeof overrides.priority === "string" &&
        allowedPriorities.has(overrides.priority.toUpperCase())
          ? overrides.priority.toUpperCase()
          : undefined;
      const overrideQty =
        typeof overrides.quantity === "number" &&
        Number.isFinite(overrides.quantity) &&
        overrides.quantity > 0
          ? Math.round(overrides.quantity)
          : undefined;
      const overrideEta =
        typeof overrides.etaDays === "number" &&
        Number.isFinite(overrides.etaDays) &&
        overrides.etaDays >= 0
          ? overrides.etaDays
          : undefined;
      let overrideSupplierId: string | undefined;
      if (typeof overrides.supplierId === "string" && overrides.supplierId) {
        const exists = ctx.suppliers.some((s) => s.id === overrides.supplierId);
        if (!exists) {
          return res
            .status(400)
            .json({ error: `unknown supplier ${overrides.supplierId}` });
        }
        overrideSupplierId = overrides.supplierId;
      }

      // First, try to find the recommendation in the DB (covers scenario-derived recs).
      const [persisted] = await db
        .select()
        .from(recsTable)
        .where(eq(recsTable.id, recId));

      let rec:
        | {
            id: string;
            nodeId: string;
            itemId: string;
            kind: string;
            suggestedQty: number;
            reason: string;
            sourceSupplierId?: string | null;
            etaDays: number;
            expectedRiskReduction: number;
          }
        | undefined;

      if (persisted) {
        if (persisted.promotedOrderId) {
          // Already promoted — return the existing order's promotion shape.
          // Already-promoted is final; overrides cannot be applied retroactively here.
          // Read the real order so the returned `totalUsd` is the dollar
          // value actually stored on the PO, not a stale estimate.
          const [existingOrder] = await db
            .select({ totalUsd: orders.totalUsd })
            .from(orders)
            .where(eq(orders.id, persisted.promotedOrderId));
          return res.status(200).json({
            id: persisted.promotedOrderId,
            orderNo: persisted.promotedOrderId,
            nodeId: persisted.nodeId,
            supplierId: persisted.sourceSupplierId ?? "supplier",
            status: "SUBMITTED",
            priority:
              persisted.kind === "ESCALATE"
                ? "FLASH"
                : persisted.kind === "REROUTE"
                  ? "URGENT"
                  : "ROUTINE",
            createdAt: new Date().toISOString(),
            requestedDeliveryAt: new Date(
              Date.now() + Math.max(1, persisted.etaDays) * 86400_000,
            ).toISOString(),
            totalUsd: Number(existingOrder?.totalUsd ?? 0),
            lineCount: 1,
          });
        }
        rec = {
          id: persisted.id,
          nodeId: persisted.nodeId,
          itemId: persisted.itemId,
          kind: persisted.kind,
          suggestedQty: persisted.suggestedQty,
          reason: persisted.reason,
          sourceSupplierId: persisted.sourceSupplierId ?? undefined,
          etaDays: persisted.etaDays,
          expectedRiskReduction: persisted.expectedRiskReduction,
        };
      } else {
        const allRecs = generateRecommendations({
          nodes: ctx.ctx.nodes,
          routes: ctx.ctx.routes,
          items: ctx.ctx.items,
          balances: ctx.ctx.balances,
          profiles: ctx.ctx.profiles,
          states: ctx.ctx.states,
          suppliers: ctx.suppliers,
          itemSkew: ctx.ctx.itemSkew,
          watchDays: ctx.ctx.watchDays,
          criticalDays: ctx.ctx.criticalDays,
          paddingDays: ctx.paddingDays,
        });
        rec = allRecs.find((r) => r.id === recId);
      }
      if (!rec) return res.status(404).json({ error: "recommendation not found" });

      const finalQty = overrideQty ?? rec.suggestedQty;
      const finalEta = overrideEta ?? rec.etaDays;
      const finalSupplierId =
        overrideSupplierId ?? rec.sourceSupplierId ?? "supplier";
      const defaultPriority =
        rec.kind === "ESCALATE"
          ? "FLASH"
          : rec.kind === "REROUTE"
            ? "URGENT"
            : "ROUTINE";
      const finalPriority = overridePriority ?? defaultPriority;
      const overrideUsed =
        overrideQty != null ||
        overrideEta != null ||
        overrideSupplierId != null ||
        overridePriority != null;

      // Optional companion supplies — when enabled, each item that shares a
      // procedure with the primary item is added as a single-event line. We
      // pick the deepest (lowest-tier) reference per item so we don't double
      // count and we keep the order at one event-equivalent of bundling.
      type CompanionLine = {
        itemId: string;
        quantity: number;
        tier: "primary" | "secondary" | "tertiary";
        procedureId: string;
      };
      let companionLines: CompanionLine[] = [];
      if (includeCompanions) {
        const supplyRows = await db.select().from(procedureSupplies);
        const procIds = Array.from(
          new Set(
            supplyRows.filter((s) => s.itemId === rec.itemId).map((s) => s.procedureId),
          ),
        );
        const tierWeight: Record<string, number> = {
          primary: 0,
          secondary: 1,
          tertiary: 2,
        };
        const best = new Map<string, CompanionLine>();
        for (const procId of procIds) {
          for (const sib of supplyRows) {
            if (sib.procedureId !== procId) continue;
            if (sib.itemId === rec.itemId) continue;
            const cand: CompanionLine = {
              itemId: sib.itemId,
              quantity: sib.quantityPerEvent,
              tier: sib.tier as "primary" | "secondary" | "tertiary",
              procedureId: procId,
            };
            const prev = best.get(sib.itemId);
            if (
              !prev ||
              (tierWeight[cand.tier] ?? 9) < (tierWeight[prev.tier] ?? 9)
            ) {
              best.set(sib.itemId, cand);
            }
          }
        }
        companionLines = Array.from(best.values());
      }

      const orderId = `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const orderNo = `PO-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`;
      const requested = new Date(Date.now() + Math.max(1, finalEta) * 86400_000);
      // Price every line off the catalog (`items.unit_price_usd`) so the
      // PO total exactly matches the dollar number the operator just saw on
      // the recommendation card / promote dialog. The dashboard reads the
      // same column for its rec-card cost via the `itemUnitPriceUsdById`
      // lookup wired into `mapRecommendationToApi`.
      const lineItemIds = Array.from(
        new Set([rec.itemId, ...companionLines.map((l) => l.itemId)]),
      );
      const priceRows = lineItemIds.length
        ? await db
            .select({ id: itemsTable.id, unitPriceUsd: itemsTable.unitPriceUsd })
            .from(itemsTable)
            .where(inArray(itemsTable.id, lineItemIds))
        : [];
      const priceById = new Map<string, number>();
      for (const row of priceRows) {
        priceById.set(row.id, Number(row.unitPriceUsd) || 0);
      }
      const primaryUnitPrice = priceById.get(rec.itemId) ?? 0;
      const primaryTotal = Number((finalQty * primaryUnitPrice).toFixed(2));
      const companionPriced = companionLines.map((l) => {
        const unitPriceUsd = priceById.get(l.itemId) ?? 0;
        return {
          ...l,
          unitPriceUsd,
          lineTotalUsd: Number((l.quantity * unitPriceUsd).toFixed(2)),
        };
      });
      const companionTotal = companionPriced.reduce(
        (acc, l) => acc + l.lineTotalUsd,
        0,
      );
      const totalUsd = Number((primaryTotal + companionTotal).toFixed(2));
      await db.insert(orders).values({
        id: orderId,
        orderNo,
        nodeId: rec.nodeId,
        supplierId: finalSupplierId,
        status: "SUBMITTED",
        priority: finalPriority,
        requestedDeliveryAt: requested,
        totalUsd,
        promotedFromRecommendationId: rec.id,
        notes: includeCompanions
          ? `${rec.reason} (bundled with ${companionLines.length} companion supply line${companionLines.length === 1 ? "" : "s"})`
          : rec.reason,
        notesEnc: encryptText(rec.reason) as unknown as Buffer | undefined,
        createdByUserId: req.user!.id,
        createdByRole: req.user!.role,
      });
      audit({
        event: "recommendation.promote",
        outcome: "success",
        actorId: req.user!.id,
        actorRole: req.user!.role,
        subject: orderId,
        detail: { recommendationId: rec.id, orderNo, supplierId: finalSupplierId, totalUsd },
      });
      const primaryLine = {
        orderId,
        itemId: rec.itemId,
        quantity: finalQty,
        unitPriceUsd: primaryUnitPrice,
        lineTotalUsd: primaryTotal,
      };
      const companionLineRows = companionPriced.map((cl) => ({
        orderId,
        itemId: cl.itemId,
        quantity: cl.quantity,
        unitPriceUsd: cl.unitPriceUsd,
        lineTotalUsd: cl.lineTotalUsd,
      }));
      await db.insert(orderLines).values([primaryLine, ...companionLineRows]);

      await db
        .insert(recsTable)
        .values({
          id: rec.id,
          nodeId: rec.nodeId,
          itemId: rec.itemId,
          kind: rec.kind,
          suggestedQty: finalQty,
          reason: rec.reason,
          expectedRiskReduction: rec.expectedRiskReduction,
          sourceSupplierId: finalSupplierId,
          etaDays: finalEta,
          status: "PROMOTED",
          promotedOrderId: orderId,
        })
        .onConflictDoUpdate({
          target: recsTable.id,
          set: {
            status: "PROMOTED",
            promotedOrderId: orderId,
            suggestedQty: finalQty,
            sourceSupplierId: finalSupplierId,
            etaDays: finalEta,
          },
        });

      await db.insert(activityEntries).values([
        {
          kind: "ORDER_CREATED",
          actor: "operator",
          message: `Order ${orderNo} created for ${rec.nodeId}`,
          refType: "order",
          refId: orderId,
          meta: {
            totalUsd,
            lines: 1 + companionLines.length,
            companionLines: companionLines.length,
            bundled: includeCompanions,
            promotedFromRecommendationId: rec.id,
          },
        },
        {
          kind: "RECOMMENDATION_PROMOTED",
          actor: "operator",
          message: includeCompanions
            ? `AI recommendation promoted to order ${orderNo} with ${companionLines.length} companion supply line${companionLines.length === 1 ? "" : "s"}`
            : overrideUsed
              ? `AI recommendation promoted to order ${orderNo} with operator overrides`
              : `AI recommendation promoted to order ${orderNo}`,
          refType: "order",
          refId: orderId,
          meta: {
            recommendationId: rec.id,
            recommendationKind: rec.kind,
            suggestedQty: rec.suggestedQty,
            promotedQty: finalQty,
            promotedSupplierId: finalSupplierId,
            promotedEtaDays: finalEta,
            promotedPriority: finalPriority,
            overridden: overrideUsed,
            bundled: includeCompanions,
            companionLines: companionLines.length,
          },
        },
      ]);

      invalidateSimCache();
      res.status(201).json({
        id: orderId,
        orderNo,
        nodeId: rec.nodeId,
        supplierId: finalSupplierId,
        status: "SUBMITTED",
        priority: finalPriority,
        createdAt: new Date().toISOString(),
        requestedDeliveryAt: requested.toISOString(),
        totalUsd,
        lineCount: 1 + companionLines.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
