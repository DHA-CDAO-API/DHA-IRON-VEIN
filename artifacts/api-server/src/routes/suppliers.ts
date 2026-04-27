import { Router, type IRouter } from "express";
import { db, suppliers } from "@workspace/db";

const router: IRouter = Router();

router.get("/suppliers", async (_req, res, next) => {
  try {
    const rows = await db.select().from(suppliers);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
