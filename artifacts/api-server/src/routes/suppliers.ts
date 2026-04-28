import { Router, type IRouter } from "express";
import { db, suppliers, items } from "@workspace/db";
import { itemsCoveredBySupplier, mapSupplierToApi } from "../lib/mappers";

const router: IRouter = Router();

router.get("/suppliers", async (_req, res, next) => {
  try {
    const [supplierRows, itemRows] = await Promise.all([
      db.select().from(suppliers),
      db.select({ id: items.id, category: items.category }).from(items),
    ]);
    res.json(
      supplierRows.map((s) =>
        mapSupplierToApi(s, itemsCoveredBySupplier(s, itemRows)),
      ),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
