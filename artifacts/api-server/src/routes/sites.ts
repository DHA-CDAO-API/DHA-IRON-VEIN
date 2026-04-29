import { Router, type IRouter } from "express";
import {
  db,
  nodes,
  inventoryBalances,
  alerts,
  orders,
  items as itemsTable,
  suppliers as suppliersTable,
  demandProfiles,
  activityEntries,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { computeRiskByNode } from "../lib/snapshot";
import { invalidateSimCache, loadSimContext } from "../lib/ctx";
import { computeNodeBloodReadiness } from "../lib/blood-readiness";
import { mapRecommendationToApi } from "../lib/mappers";
import { buildCompanionItemsByItemId } from "../lib/companion-items";
import { mapDbAlertToApi } from "./alerts";
import { buildTlammStockpile } from "./tlamm";
import {
  computeDailyDemand,
  projectDaysOfSupply,
  statusFromDOS,
  generateRecommendations,
  generateTlammSelfReplenishment,
} from "@workspace/sim";

const router: IRouter = Router();

router.get("/sites", async (_req, res, next) => {
  try {
    const [nodeRows, risk] = await Promise.all([db.select().from(nodes), computeRiskByNode()]);
    const riskMap = new Map(risk.riskByNode.map((r) => [r.nodeId, r]));
    res.json(
      nodeRows.map((n) => {
        const r = riskMap.get(n.id);
        return {
          nodeId: n.id,
          name: n.name,
          type: n.type,
          role: n.role ?? null,
          regionalHub: n.regionalHub,
          aor: n.aor,
          coordsApproximate: n.coordsApproximate,
          hiddenFromMap: n.hiddenFromMap,
          daysOfSupply: r?.daysOfSupply ?? 999,
          openAlerts: r?.openAlerts ?? 0,
          riskScore: r?.riskScore ?? 0,
          criticalShortItems: r?.criticalShortItems ?? 0,
          latitude: n.latitude,
          longitude: n.longitude,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/sites/:nodeId", async (req, res, next) => {
  try {
    const nodeId = req.params.nodeId;
    const [nodeRow] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
    if (!nodeRow) return res.status(404).json({ error: "node not found" });

    const [balanceRows, alertRows, orderRows, allItems, profileRow, ctx, bloodReadiness] =
      await Promise.all([
        db.select().from(inventoryBalances).where(eq(inventoryBalances.nodeId, nodeId)),
        db
          .select()
          .from(alerts)
          .where(and(eq(alerts.nodeId, nodeId), eq(alerts.status, "OPEN"))),
        db
          .select()
          .from(orders)
          .where(eq(orders.nodeId, nodeId))
          .orderBy(desc(orders.createdAt))
          .limit(20),
        db.select().from(itemsTable),
        db.select().from(demandProfiles).where(eq(demandProfiles.nodeId, nodeId)),
        loadSimContext(),
        computeNodeBloodReadiness(nodeId),
      ]);

    const profile = profileRow[0];
    const historicalBurnByItem = ctx.historicalBurn.get(nodeId);
    const dailyDemand = profile
      ? computeDailyDemand({
          profile,
          items: ctx.ctx.items,
          operationalState: ctx.ctx.states.get(profile.operationalState),
          itemSkew: ctx.ctx.itemSkew,
          historicalBurnByItem,
        })
      : [];
    const demandByItem = new Map(dailyDemand.map((d) => [d.itemId, d.quantity]));

    const itemNameById = new Map(allItems.map((i) => [i.id, i]));
    const balances = balanceRows.map((b) => {
      const it = itemNameById.get(b.itemId);
      const burn = demandByItem.get(b.itemId) ?? 0;
      const dos = projectDaysOfSupply(b.onHand, burn);
      return {
        id: b.id,
        nodeId: b.nodeId,
        itemId: b.itemId,
        itemName: it?.name ?? b.itemId,
        unitOfIssue: it?.unitOfIssue ?? "ea",
        onHand: b.onHand,
        dueIn: b.dueIn,
        dueOut: b.dueOut,
        allocated: b.allocated,
        lastCountedAt: b.lastCountedAt.toISOString(),
        daysOfSupply: Number(dos.toFixed(1)),
        status: statusFromDOS(dos, ctx.ctx.watchDays, ctx.ctx.criticalDays),
      };
    });

    const dosByItem = balances.map((b) => ({
      itemId: b.itemId,
      itemName: b.itemName,
      unit: b.unitOfIssue,
      onHand: b.onHand,
      dailyBurn: Number((demandByItem.get(b.itemId) ?? 0).toFixed(2)),
      daysOfSupply: b.daysOfSupply,
      status: b.status,
    }));

    // Use the full simulation context so TLAMM-first sourcing can resolve
    // the upstream TLAMM node + its inventory when generating recs for an
    // MTF, then filter to recs whose target is this site. For TLAMMs, also
    // include self-replenishment recs targeting this hub.
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
      historicalBurnByNode: ctx.historicalBurn,
    });
    const tlammSelfRecs = nodeRow.isTlamm
      ? generateTlammSelfReplenishment({
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
        })
      : [];
    const recs = [...allRecs, ...tlammSelfRecs].filter((r) => r.nodeId === nodeId);

    const [supplierRows, companionItemsByItemId] = await Promise.all([
      db.select().from(suppliersTable),
      buildCompanionItemsByItemId(),
    ]);
    const recLookups = {
      itemNamesById: new Map(allItems.map((i) => [i.id, i.name])),
      nodeNamesById: new Map([[nodeRow.id, nodeRow.name]]),
      supplierNamesById: new Map(supplierRows.map((s) => [s.id, s.name])),
      supplierFromNodeById: new Map<string, string>(),
      companionItemsByItemId,
      itemUnitPriceUsdById: new Map(
        allItems.map((i) => [i.id, Number(i.unitPriceUsd) || 0]),
      ),
    };
    const generatedAt = new Date().toISOString();

    const history = buildSyntheticHistory(nodeId, dailyDemand);

    res.json({
      node: nodeRow,
      demandProfile: profile ?? null,
      balances,
      dosByItem,
      alerts: alertRows.map(mapDbAlertToApi),
      recentOrders: orderRows.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
        requestedDeliveryAt: o.requestedDeliveryAt.toISOString(),
        lineCount: 0,
      })),
      recommendations: recs.map((r) =>
        mapRecommendationToApi(r, {
          status: "OPEN",
          generatedAt,
          lookups: recLookups,
        }),
      ),
      history,
      bloodReadiness,
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/sites/:nodeId/par", async (req, res, next) => {
  try {
    const nodeId = req.params.nodeId;
    const body = (req.body ?? {}) as {
      activeSupportedPopulation?: unknown;
      note?: unknown;
    };
    const raw = body.activeSupportedPopulation;
    const par =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim() !== ""
          ? Number(raw)
          : NaN;
    if (!Number.isFinite(par) || par < 0) {
      return res
        .status(400)
        .json({ error: "activeSupportedPopulation must be a non-negative number" });
    }
    const newPar = Math.round(par);
    const note =
      typeof body.note === "string" && body.note.trim() !== ""
        ? body.note.trim().slice(0, 500)
        : null;

    const [nodeRow] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
    if (!nodeRow) return res.status(404).json({ error: "node not found" });
    const [existing] = await db
      .select()
      .from(demandProfiles)
      .where(eq(demandProfiles.nodeId, nodeId));
    if (!existing) {
      return res.status(404).json({ error: "demand profile not found for node" });
    }

    const oldPar = existing.activeSupportedPopulation;
    const seeded = existing.seededActiveSupportedPopulation;

    if (newPar !== oldPar) {
      const [updated] = await db
        .update(demandProfiles)
        .set({ activeSupportedPopulation: newPar })
        .where(eq(demandProfiles.nodeId, nodeId))
        .returning();

      const isReset = newPar === seeded && oldPar !== seeded;
      const summary = `${nodeRow.name} PAR ${oldPar.toLocaleString()} → ${newPar.toLocaleString()}${
        isReset ? " (reset to seeded value)" : ""
      }${note ? ` — ${note}` : ""}`;

      await db.insert(activityEntries).values({
        kind: "PAR_CHANGED",
        actor: "operator",
        message: summary,
        refType: "node",
        refId: nodeId,
        meta: {
          nodeId,
          from: oldPar,
          to: newPar,
          seededValue: seeded,
          reset: isReset,
          note,
        },
      });

      invalidateSimCache();
      return res.json(updated);
    }

    return res.json(existing);
  } catch (err) {
    next(err);
  }
});

function buildSyntheticHistory(
  nodeId: string,
  dailyDemand: { itemId: string; quantity: number }[],
) {
  const out: Array<{ date: string; demand: number; consumption: number }> = [];
  const today = new Date();
  const totalDaily = dailyDemand.reduce((s, d) => s + d.quantity, 0);
  for (let i = 30; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const noise = ((Math.sin((i + nodeId.length) * 0.7) + 1) / 2) * 0.4 + 0.8;
    out.push({
      date: d.toISOString().slice(0, 10),
      demand: Number((totalDaily * noise).toFixed(1)),
      consumption: Number((totalDaily * noise * 0.95).toFixed(1)),
    });
  }
  return out;
}

export default router;
