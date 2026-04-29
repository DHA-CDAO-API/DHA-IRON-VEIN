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
import { inArray } from "drizzle-orm";
import { loadSimContext } from "../lib/ctx";
import {
  computeCasualtyDemand,
  evaluateSiteSufficiency,
  suggestPatientReroutes,
  buildOnHandIndex,
  type ShipmentArrival,
  type PatientTypeMeta,
  type PatientRequirementRow,
  type SimNode,
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
  // Legacy single-site selector. Still accepted for backward compatibility;
  // when both `siteId` and `siteIds` are absent the response is the
  // unscoped requirements view.
  siteId: z.string().nullish(),
  // New multi-site selector. When length >= 2, `multiSiteMode` controls
  // how the sites are evaluated.
  siteIds: z.array(z.string()).optional(),
  multiSiteMode: z.enum(["combined", "compare", "primary"]).optional(),
  primarySiteId: z.string().nullish(),
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

    // Resolve the effective site selection. `siteIds` (when populated) is
    // authoritative; otherwise fall back to the legacy single `siteId`.
    const rawSiteIds: string[] = (() => {
      if (body.siteIds && body.siteIds.length > 0) return [...body.siteIds];
      if (body.siteId) return [body.siteId];
      return [];
    })();
    // Dedup while preserving order so the response echo is predictable.
    const seen = new Set<string>();
    const selectedSiteIds = rawSiteIds.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Mode resolution: only matters when 2+ sites are selected. With 0/1
    // sites we behave exactly like the old single-site path ("single").
    const isMultiSite = selectedSiteIds.length >= 2;
    const requestedMode = body.multiSiteMode ?? "combined";
    const effectiveMode: "single" | "combined" | "compare" | "primary" =
      isMultiSite ? requestedMode : "single";
    const primarySiteId =
      effectiveMode === "primary"
        ? body.primarySiteId && selectedSiteIds.includes(body.primarySiteId)
          ? body.primarySiteId
          : selectedSiteIds[0] ?? null
        : null;

    // Inbound shipments fetched once for any selected site.
    const inboundRowsBySite = new Map<string, ShipmentArrival[]>();
    if (selectedSiteIds.length > 0) {
      const rows = await db
        .select()
        .from(shipments)
        .where(inArray(shipments.toNode, selectedSiteIds));
      const now = Date.now();
      for (const id of selectedSiteIds) inboundRowsBySite.set(id, []);
      for (const r of rows) {
        const list = inboundRowsBySite.get(r.toNode);
        if (!list) continue;
        list.push({
          itemId: r.itemId,
          quantity: r.quantity,
          hoursToArrival: Math.max(0, (r.etaAt.getTime() - now) / 3_600_000),
        });
      }
    }

    const supplierById = new Map(suppliers.map((s) => [s.id, s]));
    const onHandIndex = buildOnHandIndex(ctx.balances);

    // Helper: average upstream/outgoing route days for a single site (used
    // to score supplier alternatives more realistically).
    const upstreamDaysForSite = (siteId: string): number => {
      const rs = ctx.routes.filter(
        (r) => r.fromNode === siteId || r.toNode === siteId,
      );
      if (rs.length === 0) return 5;
      return rs.reduce((s, r) => s + r.days, 0) / rs.length;
    };

    type RawSufficiency = ReturnType<typeof evaluateSiteSufficiency>;
    const evaluateForSites = (
      siteIds: string[],
      pooled: boolean,
    ): RawSufficiency => {
      const onHandByItem: Record<string, number> = {};
      const inbound: ShipmentArrival[] = [];
      for (const id of siteIds) {
        for (const b of ctx.balances) {
          if (b.nodeId !== id) continue;
          onHandByItem[b.itemId] = (onHandByItem[b.itemId] ?? 0) + b.onHand;
        }
        inbound.push(...(inboundRowsBySite.get(id) ?? []));
      }
      // For pooled (combined) mode, average the upstream days across the
      // selected sites; for a single site use that site's routes.
      const upstream =
        siteIds.length === 1
          ? upstreamDaysForSite(siteIds[0])
          : siteIds.length > 0
            ? siteIds.reduce((s, id) => s + upstreamDaysForSite(id), 0) /
              siteIds.length
            : 5;
      return evaluateSiteSufficiency({
        required,
        onHandByItem,
        inbound,
        arrivalWindowHours: body.arrivalWindowHours,
        resupplyEtaHours: body.resupplyEtaHours ?? undefined,
        supplierContext: {
          suppliers,
          upstreamRouteDays: upstream,
        },
      });
      void pooled;
    };

    const mapSufficiency = (s: RawSufficiency) => ({
      summary: s.summary,
      rows: s.rows.map((r) => ({
        ...r,
        supplierAlternatives: r.supplierAlternatives?.map((alt) => {
          const sup = supplierById.get(alt.supplierId);
          return {
            supplierId: alt.supplierId,
            supplierName: alt.supplierName,
            channel: alt.channel,
            country: sup?.country ?? "",
            projectedEta: alt.etaDays,
            score: alt.rankScore,
            reliabilityScore: alt.reliabilityScore,
            leadTimeDaysMean: sup?.leadTimeDaysMean,
            rationale: null,
          };
        }),
      })),
    });

    // Helper: derive an "unmet patient subset" from a sufficiency result
    // (used to drive reroute suggestions). Mirrors the legacy heuristic.
    const unmetSubset = (s: RawSufficiency): Record<string, number> => {
      const redCount = s.summary.redCount;
      const totalReq = s.summary.totalRequiredItems;
      const unmetFraction = totalReq > 0 ? Math.min(1, redCount / totalReq) : 0;
      const out: Record<string, number> = {};
      for (const [pid, n] of Object.entries(body.patientCounts)) {
        const u = Math.ceil(n * unmetFraction);
        if (u > 0) out[pid] = u;
      }
      return out;
    };

    // Build reroute candidate pool given the effective mode + selection.
    const candidatePoolForOrigin = (
      originSiteId: string,
      modeOverride?: typeof effectiveMode,
    ): SimNode[] => {
      const mode = modeOverride ?? effectiveMode;
      let pool: SimNode[] = ctx.nodes;
      if (body.restrictReroutesToHub) {
        const originSite = ctx.nodes.find((n) => n.id === originSiteId);
        pool = pool.filter(
          (n) =>
            n.regionalHub &&
            originSite?.regionalHub &&
            n.regionalHub === originSite.regionalHub,
        );
      }
      if (mode === "combined") {
        // Pool is everything outside the selection.
        pool = pool.filter((n) => !selectedSiteIds.includes(n.id));
      } else if (mode === "primary") {
        // Pool is constrained to the *other* selected sites.
        const others = new Set(
          selectedSiteIds.filter((id) => id !== originSiteId),
        );
        pool = pool.filter((n) => others.has(n.id));
      }
      return pool;
    };

    let sufficiency: ReturnType<typeof mapSufficiency> | null = null;
    let reroutes: ReturnType<typeof suggestPatientReroutes> = [];
    const comparison: Array<{
      siteId: string;
      siteName: string;
      sufficiency: ReturnType<typeof mapSufficiency>;
    }> = [];

    if (selectedSiteIds.length === 0) {
      // Unscoped — keep the legacy behaviour (no sufficiency/reroutes).
      sufficiency = null;
      reroutes = [];
    } else if (effectiveMode === "single") {
      const onlyId = selectedSiteIds[0];
      const raw = evaluateForSites([onlyId], false);
      sufficiency = mapSufficiency(raw);
      const unmet = unmetSubset(raw);
      if (Object.keys(unmet).length > 0) {
        reroutes = suggestPatientReroutes({
          originSiteId: onlyId,
          unmetPatientCounts: unmet,
          arrivalWindowHours: body.arrivalWindowHours,
          candidateSites: candidatePoolForOrigin(onlyId, "single"),
          routes: ctx.routes,
          onHandBySiteItem: onHandIndex,
          patientTypes: patientMeta,
          patientRequirements: requirements,
          items: ctx.items,
        });
      }
    } else if (effectiveMode === "combined") {
      const raw = evaluateForSites(selectedSiteIds, true);
      sufficiency = mapSufficiency(raw);
      const unmet = unmetSubset(raw);
      if (Object.keys(unmet).length > 0) {
        // Use the first selected site as the geographic anchor for distance
        // calculations; reroute pool is all sites *outside* the selection.
        reroutes = suggestPatientReroutes({
          originSiteId: selectedSiteIds[0],
          unmetPatientCounts: unmet,
          arrivalWindowHours: body.arrivalWindowHours,
          candidateSites: candidatePoolForOrigin(selectedSiteIds[0]),
          routes: ctx.routes,
          onHandBySiteItem: onHandIndex,
          patientTypes: patientMeta,
          patientRequirements: requirements,
          items: ctx.items,
        });
      }
    } else if (effectiveMode === "primary" && primarySiteId) {
      const raw = evaluateForSites([primarySiteId], false);
      sufficiency = mapSufficiency(raw);
      const unmet = unmetSubset(raw);
      if (Object.keys(unmet).length > 0) {
        reroutes = suggestPatientReroutes({
          originSiteId: primarySiteId,
          unmetPatientCounts: unmet,
          arrivalWindowHours: body.arrivalWindowHours,
          candidateSites: candidatePoolForOrigin(primarySiteId),
          routes: ctx.routes,
          onHandBySiteItem: onHandIndex,
          patientTypes: patientMeta,
          patientRequirements: requirements,
          items: ctx.items,
        });
      }
    } else if (effectiveMode === "compare") {
      // Per-site evaluations; no top-level sufficiency or reroutes.
      for (const id of selectedSiteIds) {
        const raw = evaluateForSites([id], false);
        const node = ctx.nodes.find((n) => n.id === id);
        comparison.push({
          siteId: id,
          siteName: node?.name ?? id,
          sufficiency: mapSufficiency(raw),
        });
      }
      sufficiency = null;
      reroutes = [];
    }

    const totalPatients = Object.values(body.patientCounts).reduce(
      (s, n) => s + n,
      0,
    );

    res.json({
      arrivalWindowHours: body.arrivalWindowHours,
      totalPatients,
      patientCounts: body.patientCounts,
      requiredItems: required,
      sufficiency,
      reroutes: reroutes ?? [],
      multiSiteMode: effectiveMode,
      selectedSiteIds,
      primarySiteId,
      comparison,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
