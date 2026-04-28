import { Router, type IRouter } from "express";
import { db, suppliers, supplierItems } from "@workspace/db";
import { mapSupplierToApi } from "../lib/mappers";

const router: IRouter = Router();

router.get("/suppliers", async (_req, res, next) => {
  try {
    const [supplierRows, coverageRows] = await Promise.all([
      db.select().from(suppliers),
      db.select().from(supplierItems),
    ]);
    const coverageBySupplier = new Map<string, string[]>();
    for (const row of coverageRows) {
      const list = coverageBySupplier.get(row.supplierId);
      if (list) list.push(row.itemId);
      else coverageBySupplier.set(row.supplierId, [row.itemId]);
    }
    res.json(
      supplierRows.map((s) =>
        mapSupplierToApi(s, coverageBySupplier.get(s.id) ?? []),
      ),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
