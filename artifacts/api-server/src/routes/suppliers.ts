import { Router, type IRouter } from "express";
import { db, suppliers } from "@workspace/db";
import { mapSupplierToApi } from "../lib/mappers";

const router: IRouter = Router();

router.get("/suppliers", async (_req, res, next) => {
  try {
    const rows = await db.select().from(suppliers);
    res.json(rows.map(mapSupplierToApi));
  } catch (err) {
    next(err);
  }
});

export default router;
