import { Router, type IRouter } from "express";
import { db, catalogEntries } from "@workspace/db";
import { ilike, or, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/catalog/items", async (req, res, next) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 50));
    const where = search.length > 0
      ? or(
          ilike(catalogEntries.description, `%${search}%`),
          ilike(catalogEntries.manufacturer, `%${search}%`),
          ilike(catalogEntries.productNoun, `%${search}%`),
          ilike(catalogEntries.productType, `%${search}%`),
          ilike(catalogEntries.mfrCatNo, `%${search}%`),
        )
      : undefined;
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(catalogEntries)
      .where(where ?? sql`true`);
    const rows = await db
      .select()
      .from(catalogEntries)
      .where(where ?? sql`true`)
      .orderBy(sql`order_lines DESC`)
      .limit(limit);
    res.json({
      total: count,
      items: rows.map((r) => ({
        mfrCatNo: r.mfrCatNo,
        appItemId: r.appItemId,
        mapped: r.mapped,
        orderLines: r.orderLines,
        totalQty: r.totalQty,
        description: r.description,
        manufacturer: r.manufacturer,
        productNoun: r.productNoun,
        productType: r.productType,
        unspscCommodity: r.unspscCommodity,
        productSize: r.productSize,
        ghxCommodityType: r.ghxCommodityType,
        fullDescription: r.fullDescription,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
