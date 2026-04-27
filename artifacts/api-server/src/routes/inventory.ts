import { Router, type IRouter } from "express";
import { db, inventoryBalances } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { loadSimContext } from "../lib/ctx";
import { computeDailyDemand, projectDaysOfSupply, statusFromDOS } from "@workspace/sim";

const router: IRouter = Router();

router.get("/inventory/balances", async (req, res, next) => {
  try {
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : undefined;
    const itemId = typeof req.query.itemId === "string" ? req.query.itemId : undefined;
    const conds = [];
    if (nodeId) conds.push(eq(inventoryBalances.nodeId, nodeId));
    if (itemId) conds.push(eq(inventoryBalances.itemId, itemId));
    const rows = conds.length
      ? await db.select().from(inventoryBalances).where(and(...conds))
      : await db.select().from(inventoryBalances);

    const ctx = await loadSimContext();
    const itemNameById = new Map(ctx.ctx.items.map((i) => [i.id, i]));

    const burnByNodeItem = new Map<string, number>();
    for (const node of ctx.ctx.nodes) {
      const profile = ctx.ctx.profiles.get(node.id);
      if (!profile) continue;
      const demands = computeDailyDemand({
        profile,
        items: ctx.ctx.items,
        operationalState: ctx.ctx.states.get(profile.operationalState),
        itemSkew: ctx.ctx.itemSkew,
      });
      for (const d of demands) burnByNodeItem.set(`${node.id}:${d.itemId}`, d.quantity);
    }

    res.json(
      rows.map((b) => {
        const it = itemNameById.get(b.itemId);
        const burn = burnByNodeItem.get(`${b.nodeId}:${b.itemId}`) ?? 0;
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
      }),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
