import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  patientTypes,
  patientItemRequirements,
  eventTypes,
  eventPatientMix,
  shipments,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { loadSimContext } from "../lib/ctx";
import {
  computeCasualtyDemand,
  evaluateSiteSufficiency,
  suggestPatientReroutes,
  buildOnHandIndex,
  type ShipmentArrival,
  type PatientTypeMeta,
  type PatientRequirementRow,
} from "@workspace/sim";

const router: IRouter = Router();

// ----- Patient & event reference data -----

router.get("/patient-types", async (_req, res, next) => {
  try {
    const [types, reqRows] = await Promise.all([
      db.select().from(patientTypes),
      db.select().from(patientItemRequirements),
    ]);
    const reqsByType = new Map<
      string,
      Array<{ itemId: string; quantityPerPatient: number; notes: string }>
    >();
    for (const r of reqRows) {
      if (!reqsByType.has(r.patientTypeId))
        reqsByType.set(r.patientTypeId, []);
      reqsByType.get(r.patientTypeId)!.push({
        itemId: r.itemId,
        quantityPerPatient: r.quantityPerPatient,
        notes: r.notes,
      });
    }
    res.json(
      types.map((t) => ({
        id: t.id,
        name: t.name,
        severity: t.severity,
        careCategory: t.careCategory,
        avgClinicianMinutes: t.avgClinicianMinutes,
        description: t.description,
        requirements: reqsByType.get(t.id) ?? [],
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/event-types", async (_req, res, next) => {
  try {
    const [evts, mixRows] = await Promise.all([
      db.select().from(eventTypes),
      db.select().from(eventPatientMix),
    ]);
    const mixByEvent = new Map<
      string,
      Array<{ patientTypeId: string; defaultShare: number }>
    >();
    for (const m of mixRows) {
      if (!mixByEvent.has(m.eventTypeId)) mixByEvent.set(m.eventTypeId, []);
      mixByEvent.get(m.eventTypeId)!.push({
        patientTypeId: m.patientTypeId,
        defaultShare: m.defaultShare,
      });
    }
    res.json(
      evts.map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
        description: e.description,
        defaultArrivalWindowHours: e.defaultArrivalWindowHours,
        defaultPatientMix: mixByEvent.get(e.id) ?? [],
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ----- Casualty evaluation -----

const EvaluateInput = z.object({
  siteId: z.string().nullish(),
  patientCounts: z.record(z.string(), z.number().nonnegative()),
  arrivalWindowHours: z.number().positive().default(48),
  resupplyEtaHours: z.number().positive().nullish(),
  // Optional: when present, restrict reroute candidates to the same
  // regional hub (faster and operationally realistic). Defaults to false
  // — we'll consider all sites the operator could plausibly divert to.
  restrictReroutesToHub: z.boolean().default(false),
});

router.post("/casualty/evaluate", async (req, res, next) => {
  try {
    const parsed = EvaluateInput.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid casualty evaluate body", details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const { ctx, suppliers } = await loadSimContext();
    const [patientTypeRows, requirementRows] = await Promise.all([
      db.select().from(patientTypes),
      db.select().from(patientItemRequirements),
    ]);
    const patientMeta: PatientTypeMeta[] = patientTypeRows.map((p) => ({
      id: p.id,
      name: p.name,
      severity: p.severity,
      avgClinicianMinutes: p.avgClinicianMinutes,
    }));
    const requirements: PatientRequirementRow[] = requirementRows.map((r) => ({
      patientTypeId: r.patientTypeId,
      itemId: r.itemId,
      quantityPerPatient: r.quantityPerPatient,
    }));

    const required = computeCasualtyDemand({
      input: {
        patientCounts: body.patientCounts,
        arrivalWindowHours: body.arrivalWindowHours,
      },
      items: ctx.items,
      patientTypes: patientMeta,
      patientRequirements: requirements,
    });

    // Site-scoped sufficiency + reroute suggestions.
    let sufficiency: ReturnType<typeof evaluateSiteSufficiency> | null = null;
    let reroutes: ReturnType<typeof suggestPatientReroutes> | null = null;
    let upstreamRouteDays = 5;
    if (body.siteId) {
      const balances = ctx.balances.filter((b) => b.nodeId === body.siteId);
      const onHandByItem: Record<string, number> = {};
      for (const b of balances) {
        onHandByItem[b.itemId] = (onHandByItem[b.itemId] ?? 0) + b.onHand;
      }
      // Inbound shipments to this site over the arrival window.
      const inboundRows = await db
        .select()
        .from(shipments)
        .where(eq(shipments.toNode, body.siteId));
      const now = Date.now();
      const inbound: ShipmentArrival[] = inboundRows.map((r) => ({
        itemId: r.itemId,
        quantity: r.quantity,
        hoursToArrival: Math.max(0, (r.etaAt.getTime() - now) / 3_600_000),
      }));

      // Look up the upstream route lead time for the site (used to score
      // supplier alternatives more realistically). We'll average outgoing
      // edges; if no route is known, leave the sim default.
      const siteRoutes = ctx.routes.filter(
        (r) => r.fromNode === body.siteId || r.toNode === body.siteId,
      );
      if (siteRoutes.length > 0) {
        upstreamRouteDays =
          siteRoutes.reduce((s, r) => s + r.days, 0) / siteRoutes.length;
      }

      sufficiency = evaluateSiteSufficiency({
        required,
        onHandByItem,
        inbound,
        arrivalWindowHours: body.arrivalWindowHours,
        resupplyEtaHours: body.resupplyEtaHours ?? undefined,
        supplierContext: {
          suppliers,
          upstreamRouteDays,
        },
      });

      // Reroute suggestions for the *unmet* patient subset. We approximate
      // unmet share per patient type by the global red-row severity: if 80%
      // of the bill-of-materials is red, we treat 80% of the patients as
      // unmet (rounded). This is intentionally simple — operators can edit
      // the patient counts and re-evaluate.
      const redCount = sufficiency.summary.redCount;
      const totalReq = sufficiency.summary.totalRequiredItems;
      const unmetFraction = totalReq > 0 ? Math.min(1, redCount / totalReq) : 0;
      const unmetPatientCounts: Record<string, number> = {};
      for (const [pid, n] of Object.entries(body.patientCounts)) {
        const u = Math.ceil(n * unmetFraction);
        if (u > 0) unmetPatientCounts[pid] = u;
      }
      if (Object.keys(unmetPatientCounts).length > 0) {
        const originSite = ctx.nodes.find((n) => n.id === body.siteId);
        const candidates = body.restrictReroutesToHub
          ? ctx.nodes.filter(
              (n) =>
                n.regionalHub &&
                originSite?.regionalHub &&
                n.regionalHub === originSite.regionalHub,
            )
          : ctx.nodes;
        reroutes = suggestPatientReroutes({
          originSiteId: body.siteId,
          unmetPatientCounts,
          arrivalWindowHours: body.arrivalWindowHours,
          candidateSites: candidates,
          routes: ctx.routes,
          onHandBySiteItem: buildOnHandIndex(ctx.balances),
          patientTypes: patientMeta,
          patientRequirements: requirements,
          items: ctx.items,
        });
      }
    }

    // Staffing summary headline (clinician roster + total clinician hours)
    // is implicit in the PPE row totals; surface a plain version too.
    const staffingPatients = Object.entries(body.patientCounts)
      .filter(([, n]) => n > 0)
      .map(([pid, count]) => ({
        patientTypeId: pid,
        count,
        avgClinicianMinutes:
          patientMeta.find((p) => p.id === pid)?.avgClinicianMinutes ?? 60,
      }));
    const totalPatients = staffingPatients.reduce((s, p) => s + p.count, 0);

    // Map RecommendationAlternative -> SupplierAlternative shape declared
    // in OpenAPI (projectedEta/score/country are renamed/derived fields).
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));
    const mappedSufficiency = sufficiency
      ? {
          summary: sufficiency.summary,
          rows: sufficiency.rows.map((r) => ({
            ...r,
            supplierAlternatives: r.supplierAlternatives?.map((alt) => {
              const s = supplierById.get(alt.supplierId);
              return {
                supplierId: alt.supplierId,
                supplierName: alt.supplierName,
                channel: alt.channel,
                country: s?.country ?? "",
                projectedEta: alt.etaDays,
                score: alt.rankScore,
                reliabilityScore: alt.reliabilityScore,
                leadTimeDaysMean: s?.leadTimeDaysMean,
                rationale: null,
              };
            }),
          })),
        }
      : null;

    res.json({
      arrivalWindowHours: body.arrivalWindowHours,
      totalPatients,
      patientCounts: body.patientCounts,
      requiredItems: required,
      sufficiency: mappedSufficiency,
      reroutes: reroutes ?? [],
    });
  } catch (err) {
    next(err);
  }
});

export default router;
