import { Router, type IRouter } from "express";
import { db, recommendations as recsTable, orders, orderLines, activityEntries } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { loadSimContext } from "../lib/ctx";
import {
  computeDailyDemand,
  generateRecommendations,
  projectDaysOfSupply,
} from "@workspace/sim";
import { invalidateSimCache } from "../lib/ctx";

const router: IRouter = Router();

router.post("/predictive/forecast", async (req, res, next) => {
  try {
    const body = req.body as {
      nodeId: string;
      itemId?: string;
      horizonDays?: number;
    };
    const horizon = Math.max(1, Math.min(45, body.horizonDays ?? 14));
    const ctx = await loadSimContext();
    const profile = ctx.ctx.profiles.get(body.nodeId);
    if (!profile) return res.status(404).json({ error: "node not found" });

    const items = body.itemId
      ? ctx.ctx.items.filter((i) => i.id === body.itemId)
      : ctx.ctx.items;
    const dailyDemand = computeDailyDemand({
      profile,
      items,
      operationalState: ctx.ctx.states.get(profile.operationalState),
      itemSkew: ctx.ctx.itemSkew,
    });
    const balanceMap = new Map<string, number>();
    for (const b of ctx.ctx.balances) {
      if (b.nodeId === body.nodeId) balanceMap.set(b.itemId, b.onHand);
    }

    const series = items.map((it) => {
      const onHand0 = balanceMap.get(it.id) ?? 0;
      const burn = dailyDemand.find((d) => d.itemId === it.id)?.quantity ?? 0;
      const points: Array<{ day: number; onHand: number; demand: number; daysOfSupply: number }> = [];
      let onHand = onHand0;
      for (let d = 0; d <= horizon; d++) {
        points.push({
          day: d,
          onHand: Math.max(0, Number(onHand.toFixed(1))),
          demand: Number(burn.toFixed(1)),
          daysOfSupply: Number(projectDaysOfSupply(Math.max(0, onHand), burn).toFixed(1)),
        });
        onHand -= burn;
      }
      return { itemId: it.id, itemName: it.name, points };
    });

    res.json({
      nodeId: body.nodeId,
      horizonDays: horizon,
      generatedAt: new Date().toISOString(),
      series,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/predictive/recommendations", async (req, res, next) => {
  try {
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : undefined;
    const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
    const ctx = await loadSimContext();
    const filteredNodes = nodeId
      ? ctx.ctx.nodes.filter((n) => n.id === nodeId)
      : ctx.ctx.nodes;
    const recs = generateRecommendations({
      nodes: filteredNodes,
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
    }).slice(0, limit);

    const promoted = await db.select().from(recsTable);
    const promotedByLogicalId = new Map(
      promoted.filter((p) => p.promotedOrderId).map((p) => [p.id, p]),
    );

    res.json(
      recs.map((r) => {
        const persisted = promotedByLogicalId.get(r.id);
        return {
          ...r,
          status: persisted ? "PROMOTED" : "OPEN",
          promotedOrderId: persisted?.promotedOrderId ?? null,
          createdAt: new Date().toISOString(),
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.post(
  "/predictive/recommendations/:recommendationId/promote",
  async (req, res, next) => {
    try {
      const recId = req.params.recommendationId;
      const ctx = await loadSimContext();

      const overrides = (req.body ?? {}) as {
        quantity?: number;
        supplierId?: string;
        etaDays?: number;
        priority?: string;
      };
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
          return res.status(200).json({
            id: persisted.promotedOrderId,
            orderNo: persisted.promotedOrderId,
            nodeId: persisted.nodeId,
            supplierId: persisted.sourceSupplierId ?? "supplier",
            status: "SUBMITTED",
            priority: persisted.kind === "ESCALATE" ? "FLASH" : "ROUTINE",
            createdAt: new Date().toISOString(),
            requestedDeliveryAt: new Date(
              Date.now() + Math.max(1, persisted.etaDays) * 86400_000,
            ).toISOString(),
            totalUsd: persisted.suggestedQty * 1.5,
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

      const orderId = `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const orderNo = `PO-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`;
      const requested = new Date(Date.now() + Math.max(1, finalEta) * 86400_000);
      const totalUsd = finalQty * 1.5;
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
        notes: rec.reason,
      });
      await db.insert(orderLines).values({
        orderId,
        itemId: rec.itemId,
        quantity: finalQty,
        unitPriceUsd: 1.5,
        lineTotalUsd: totalUsd,
      });

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
            lines: 1,
            promotedFromRecommendationId: rec.id,
          },
        },
        {
          kind: "RECOMMENDATION_PROMOTED",
          actor: "operator",
          message: overrideUsed
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
        lineCount: 1,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
