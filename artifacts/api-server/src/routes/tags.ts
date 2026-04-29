import { Router, type IRouter } from "express";
import {
  db,
  tags as tagsTable,
  tagAssignments as tagAssignmentsTable,
  activityEntries,
  appSettings,
  nodes as nodesTable,
  items as itemsTable,
  suppliers as suppliersTable,
  orders as ordersTable,
  shipments as shipmentsTable,
  scenarios as scenariosTable,
  alerts as alertsTable,
  bloodLots as bloodLotsTable,
  TAG_ENTITY_TYPES,
  type TagEntityType,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  resolveModel,
  suggestTagsForEntity,
  type AIProvider,
} from "@workspace/ai-orchestrator";
import { decryptText } from "../lib/crypto";

const router: IRouter = Router();

const TAG_COLOR_PALETTE = [
  "slate",
  "rose",
  "amber",
  "emerald",
  "sky",
  "violet",
  "fuchsia",
  "cyan",
  "lime",
  "orange",
] as const;

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function newTagId(slug: string): string {
  return `tag_${slug.slice(0, 30)}_${Date.now().toString(36)}`;
}

function pickColorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_COLOR_PALETTE[h % TAG_COLOR_PALETTE.length] ?? "slate";
}

function isEntityType(v: unknown): v is TagEntityType {
  return (
    typeof v === "string" &&
    (TAG_ENTITY_TYPES as readonly string[]).includes(v)
  );
}

async function loadAiSettings(): Promise<{ provider: AIProvider; model: string }> {
  const [s] = await db.select().from(appSettings);
  const provider = ((s?.aiProvider ?? "openai") as AIProvider) === "anthropic"
    ? "anthropic"
    : "openai";
  return { provider, model: resolveModel(provider, s?.aiModel ?? undefined) };
}

function deeplinkFor(entityType: TagEntityType, entityId: string): string | null {
  switch (entityType) {
    case "node":
      return `/sites/${entityId}`;
    case "item":
      return `/items/${entityId}`;
    case "supplier":
      return `/suppliers`;
    case "order":
      return `/orders/${entityId}`;
    case "shipment":
      return `/orders`;
    case "scenario":
      return `/scenarios`;
    case "alert":
      return null;
    case "blood_lot":
      return null;
    default:
      return null;
  }
}

// Build a one-record summary that we send to the AI suggester. The
// summary text is intentionally short — we're describing one record, not
// the whole theater.
async function buildEntitySummary(
  entityType: TagEntityType,
  entityId: string,
): Promise<{ label: string; sublabel: string | null; summary: string } | null> {
  switch (entityType) {
    case "node": {
      const [row] = await db
        .select()
        .from(nodesTable)
        .where(eq(nodesTable.id, entityId));
      if (!row) return null;
      const summary = `Site / Node
- id: ${row.id}
- name: ${row.name}
- type: ${row.type}
- country: ${row.countryCode ?? "-"}
- regional hub: ${row.regionalHub ?? "-"}
- optempo: ${row.optempo}
- population: ${row.population}
- stockDays: ${row.stockDays}`;
      return { label: row.name, sublabel: row.type, summary };
    }
    case "item": {
      const [row] = await db
        .select()
        .from(itemsTable)
        .where(eq(itemsTable.id, entityId));
      if (!row) return null;
      const summary = `Catalog Item
- id: ${row.id}
- name: ${row.name}
- category: ${row.category}
- class of supply: ${row.classOfSupply}
- criticality: ${row.criticality}
- unit of issue: ${row.unitOfIssue}
- mandatory: ${row.mandatory}`;
      return { label: row.name, sublabel: row.category, summary };
    }
    case "supplier": {
      const [row] = await db
        .select()
        .from(suppliersTable)
        .where(eq(suppliersTable.id, entityId));
      if (!row) return null;
      const summary = `Supplier
- id: ${row.id}
- name: ${row.name}
- channel: ${row.channel}
- country: ${row.country}
- lead time (days, mean): ${row.leadTimeDaysMean}
- reliability score: ${row.reliabilityScore}
- items covered count: ${row.itemsCovered}`;
      return { label: row.name, sublabel: row.channel, summary };
    }
    case "order": {
      const [row] = await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.id, entityId));
      if (!row) return null;
      const summary = `Purchase Order
- id: ${row.id}
- order#: ${row.orderNo}
- destination node: ${row.nodeId}
- supplier: ${row.supplierId}
- status: ${row.status}
- priority: ${row.priority}
- requested delivery: ${row.requestedDeliveryAt instanceof Date ? row.requestedDeliveryAt.toISOString() : row.requestedDeliveryAt}
- total USD: ${row.totalUsd}`;
      return { label: row.orderNo, sublabel: row.status, summary };
    }
    case "shipment": {
      const [row] = await db
        .select()
        .from(shipmentsTable)
        .where(eq(shipmentsTable.id, entityId));
      if (!row) return null;
      const summary = `Shipment
- id: ${row.id}
- from node: ${row.fromNode}
- to node: ${row.toNode}
- item: ${row.itemId}
- quantity: ${row.quantity}
- priority: ${row.priority}
- ETA: ${row.etaAt instanceof Date ? row.etaAt.toISOString() : row.etaAt}`;
      return { label: row.id, sublabel: row.priority, summary };
    }
    case "scenario": {
      const [row] = await db
        .select({
          id: scenariosTable.id,
          name: scenariosTable.name,
          kind: scenariosTable.kind,
          summaryPlain: decryptText(scenariosTable.summaryEnc),
        })
        .from(scenariosTable)
        .where(eq(scenariosTable.id, entityId));
      if (!row) return null;
      const summary = `Scenario Run
- id: ${row.id}
- name: ${row.name}
- kind: ${row.kind}
- summary: ${row.summaryPlain ?? ""}`;
      return { label: row.name, sublabel: row.kind, summary };
    }
    case "alert": {
      const [row] = await db
        .select()
        .from(alertsTable)
        .where(eq(alertsTable.id, entityId));
      if (!row) return null;
      const summary = `Alert
- id: ${row.id}
- severity: ${row.severity}
- category: ${row.category}
- node: ${row.nodeId}
- item: ${row.itemId ?? "-"}
- status: ${row.status}
- message: ${row.message}`;
      return { label: row.message.slice(0, 80), sublabel: row.severity, summary };
    }
    case "blood_lot": {
      const [row] = await db
        .select()
        .from(bloodLotsTable)
        .where(eq(bloodLotsTable.id, entityId));
      if (!row) return null;
      const summary = `Blood Lot
- id: ${row.id}
- node: ${row.nodeId}
- component: ${row.component}
- ABO/Rh: ${row.aboGroup ?? "-"}/${row.rhFactor ?? "-"}
- units: ${row.units}
- status: ${row.status}
- expires: ${row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt}`;
      return { label: `${row.component} ${row.aboGroup ?? ""}${row.rhFactor ?? ""}`.trim(), sublabel: row.status, summary };
    }
  }
  return null;
}

function tagToApi(t: typeof tagsTable.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    color: t.color,
    description: t.description,
    source: t.source,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function assignmentToApi(
  a: typeof tagAssignmentsTable.$inferSelect,
  t: typeof tagsTable.$inferSelect,
) {
  return {
    id: a.id,
    tagId: a.tagId,
    tag: tagToApi(t),
    entityType: a.entityType,
    entityId: a.entityId,
    appliedBy: a.appliedBy,
    appliedByActor: a.appliedByActor,
    aiModel: a.aiModel ?? null,
    aiProvider: a.aiProvider ?? null,
    rationale: a.rationale ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/tags", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const allTags = await db.select().from(tagsTable).orderBy(asc(tagsTable.name));
    const counts = await db
      .select({
        tagId: tagAssignmentsTable.tagId,
        n: sql<number>`count(*)::int`,
      })
      .from(tagAssignmentsTable)
      .groupBy(tagAssignmentsTable.tagId);
    const countByTag = new Map(counts.map((c) => [c.tagId, c.n]));
    const filtered = q
      ? allTags.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.slug.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q),
        )
      : allTags;
    res.json(
      filtered.map((t) => ({
        ...tagToApi(t),
        usageCount: countByTag.get(t.id) ?? 0,
      })),
    );
  } catch (err) {
    next(err);
  }
});

const CreateTagBody = z.object({
  name: z.string().min(1).max(60),
  color: z.string().optional(),
  description: z.string().max(280).optional(),
  source: z.enum(["manual", "ai"]).optional(),
});

router.post("/tags", async (req, res, next) => {
  try {
    const parsed = CreateTagBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
    }
    const slug = slugify(parsed.data.name);
    if (!slug) return res.status(400).json({ error: "name must include letters or numbers" });
    const [existing] = await db.select().from(tagsTable).where(eq(tagsTable.slug, slug));
    if (existing) return res.status(409).json({ error: "tag with that slug already exists", tag: tagToApi(existing) });
    const id = newTagId(slug);
    const color = parsed.data.color ?? pickColorFor(parsed.data.name);
    const source = parsed.data.source ?? "manual";
    await db.insert(tagsTable).values({
      id,
      name: parsed.data.name.trim(),
      slug,
      color,
      description: parsed.data.description ?? "",
      source,
      createdBy: source === "ai" ? "ai" : "operator",
    });
    const [created] = await db.select().from(tagsTable).where(eq(tagsTable.id, id));
    res.status(201).json(tagToApi(created!));
  } catch (err) {
    next(err);
  }
});

router.get("/tags/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const [tag] = await db.select().from(tagsTable).where(eq(tagsTable.slug, slug));
    if (!tag) return res.status(404).json({ error: "tag not found" });
    const assignments = await db
      .select()
      .from(tagAssignmentsTable)
      .where(eq(tagAssignmentsTable.tagId, tag.id))
      .orderBy(desc(tagAssignmentsTable.createdAt));

    // Group assignments by entity type so the detail view can render each
    // group separately. Resolve labels in a single batched query per
    // entity type to keep the round-trips small.
    const grouped = new Map<TagEntityType, typeof assignments>();
    for (const a of assignments) {
      if (!isEntityType(a.entityType)) continue;
      const arr = grouped.get(a.entityType) ?? [];
      arr.push(a);
      grouped.set(a.entityType, arr);
    }

    const byEntityType: Array<{
      entityType: TagEntityType;
      entries: Array<{
        entityType: TagEntityType;
        entityId: string;
        label: string;
        sublabel: string | null;
        deeplink: string | null;
        appliedBy: string;
        rationale: string | null;
        createdAt: string;
      }>;
    }> = [];

    for (const [entityType, rows] of grouped.entries()) {
      const ids = rows.map((r) => r.entityId);
      const labels = await resolveEntityLabels(entityType, ids);
      const entries = rows.map((r) => {
        const lab = labels.get(r.entityId);
        return {
          entityType,
          entityId: r.entityId,
          label: lab?.label ?? r.entityId,
          sublabel: lab?.sublabel ?? null,
          deeplink: deeplinkFor(entityType, r.entityId),
          appliedBy: r.appliedBy,
          rationale: r.rationale ?? null,
          createdAt: r.createdAt.toISOString(),
        };
      });
      byEntityType.push({ entityType, entries });
    }

    // Stable order — same order as TAG_ENTITY_TYPES.
    byEntityType.sort(
      (a, b) =>
        TAG_ENTITY_TYPES.indexOf(a.entityType) -
        TAG_ENTITY_TYPES.indexOf(b.entityType),
    );

    res.json({
      tag: tagToApi(tag),
      usageCount: assignments.length,
      byEntityType,
    });
  } catch (err) {
    next(err);
  }
});

const UpdateTagBody = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().optional(),
  description: z.string().max(280).optional(),
});

router.patch("/tags/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const parsed = UpdateTagBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
    }
    const [existing] = await db.select().from(tagsTable).where(eq(tagsTable.slug, slug));
    if (!existing) return res.status(404).json({ error: "tag not found" });
    const update: Partial<typeof tagsTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) {
      update.name = parsed.data.name.trim();
      const newSlug = slugify(parsed.data.name);
      if (newSlug && newSlug !== existing.slug) {
        const [conflict] = await db.select().from(tagsTable).where(eq(tagsTable.slug, newSlug));
        if (conflict && conflict.id !== existing.id) {
          return res.status(409).json({ error: "another tag already uses that slug" });
        }
        update.slug = newSlug;
      }
    }
    if (parsed.data.color !== undefined) update.color = parsed.data.color;
    if (parsed.data.description !== undefined) update.description = parsed.data.description;
    await db.update(tagsTable).set(update).where(eq(tagsTable.id, existing.id));
    const [updated] = await db.select().from(tagsTable).where(eq(tagsTable.id, existing.id));
    res.json(tagToApi(updated!));
  } catch (err) {
    next(err);
  }
});

router.delete("/tags/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const [existing] = await db.select().from(tagsTable).where(eq(tagsTable.slug, slug));
    if (!existing) return res.status(404).json({ error: "tag not found" });
    await db.delete(tagAssignmentsTable).where(eq(tagAssignmentsTable.tagId, existing.id));
    await db.delete(tagsTable).where(eq(tagsTable.id, existing.id));
    await db.insert(activityEntries).values({
      kind: "TAG_DELETED",
      actor: "operator",
      message: `Deleted tag "${existing.name}"`,
      refType: "tag",
      refId: existing.id,
      meta: { slug: existing.slug },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/tags/:slug/merge", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const intoSlug = typeof req.body?.intoSlug === "string" ? req.body.intoSlug : "";
    if (!intoSlug || intoSlug === slug) {
      return res.status(400).json({ error: "intoSlug is required and must differ from source slug" });
    }
    const [src] = await db.select().from(tagsTable).where(eq(tagsTable.slug, slug));
    const [dst] = await db.select().from(tagsTable).where(eq(tagsTable.slug, intoSlug));
    if (!src || !dst) return res.status(404).json({ error: "source or target tag not found" });

    // Move every src assignment to dst, dropping rows that would conflict
    // with an existing dst assignment.
    const srcAssignments = await db
      .select()
      .from(tagAssignmentsTable)
      .where(eq(tagAssignmentsTable.tagId, src.id));
    const dstAssignments = await db
      .select()
      .from(tagAssignmentsTable)
      .where(eq(tagAssignmentsTable.tagId, dst.id));
    const dstKeys = new Set(dstAssignments.map((a) => `${a.entityType}:${a.entityId}`));
    for (const a of srcAssignments) {
      const key = `${a.entityType}:${a.entityId}`;
      if (dstKeys.has(key)) {
        await db.delete(tagAssignmentsTable).where(eq(tagAssignmentsTable.id, a.id));
      } else {
        await db
          .update(tagAssignmentsTable)
          .set({ tagId: dst.id })
          .where(eq(tagAssignmentsTable.id, a.id));
        dstKeys.add(key);
      }
    }
    await db.delete(tagsTable).where(eq(tagsTable.id, src.id));
    await db.insert(activityEntries).values({
      kind: "TAG_MERGED",
      actor: "operator",
      message: `Merged tag "${src.name}" into "${dst.name}"`,
      refType: "tag",
      refId: dst.id,
      meta: { fromSlug: src.slug, intoSlug: dst.slug, moved: srcAssignments.length },
    });
    res.json(tagToApi(dst));
  } catch (err) {
    next(err);
  }
});

router.get("/tags/for/:entityType/:entityId", async (req, res, next) => {
  try {
    const entityType = req.params.entityType;
    const entityId = req.params.entityId;
    if (!isEntityType(entityType)) {
      return res.status(400).json({ error: "invalid entity type" });
    }
    const rows = await db
      .select({
        a: tagAssignmentsTable,
        t: tagsTable,
      })
      .from(tagAssignmentsTable)
      .innerJoin(tagsTable, eq(tagAssignmentsTable.tagId, tagsTable.id))
      .where(
        and(
          eq(tagAssignmentsTable.entityType, entityType),
          eq(tagAssignmentsTable.entityId, entityId),
        ),
      )
      .orderBy(asc(tagsTable.name));
    res.json(rows.map((r) => assignmentToApi(r.a, r.t)));
  } catch (err) {
    next(err);
  }
});

const AddTagBody = z.object({
  tagId: z.string().optional(),
  name: z.string().min(1).max(60).optional(),
  color: z.string().optional(),
  appliedBy: z.enum(["manual", "ai"]).optional(),
  aiModel: z.string().optional(),
  aiProvider: z.string().optional(),
  rationale: z.string().max(500).optional(),
});

router.post("/tags/for/:entityType/:entityId", async (req, res, next) => {
  try {
    const entityType = req.params.entityType;
    const entityId = req.params.entityId;
    if (!isEntityType(entityType)) {
      return res.status(400).json({ error: "invalid entity type" });
    }
    const parsed = AddTagBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (!body.tagId && !body.name) {
      return res.status(400).json({ error: "tagId or name is required" });
    }

    let tagRow: typeof tagsTable.$inferSelect | undefined;
    if (body.tagId) {
      const [t] = await db.select().from(tagsTable).where(eq(tagsTable.id, body.tagId));
      tagRow = t;
    } else if (body.name) {
      const slug = slugify(body.name);
      const [existing] = await db.select().from(tagsTable).where(eq(tagsTable.slug, slug));
      if (existing) {
        tagRow = existing;
      } else {
        const id = newTagId(slug);
        const source = body.appliedBy === "ai" ? "ai" : "manual";
        await db.insert(tagsTable).values({
          id,
          name: body.name.trim(),
          slug,
          color: body.color ?? pickColorFor(body.name),
          description: "",
          source,
          createdBy: source === "ai" ? "ai" : "operator",
        });
        const [created] = await db.select().from(tagsTable).where(eq(tagsTable.id, id));
        tagRow = created;
      }
    }

    if (!tagRow) return res.status(404).json({ error: "tag not found" });

    // Resolve the entity label up front so the activity entry & response
    // stay readable.
    const entityLabel = await resolveEntityLabel(entityType, entityId);
    if (!entityLabel) return res.status(404).json({ error: "entity not found" });

    // upsert: if it already exists, just return that row.
    const [existingAssign] = await db
      .select()
      .from(tagAssignmentsTable)
      .where(
        and(
          eq(tagAssignmentsTable.tagId, tagRow.id),
          eq(tagAssignmentsTable.entityType, entityType),
          eq(tagAssignmentsTable.entityId, entityId),
        ),
      );
    if (existingAssign) {
      return res.status(200).json(assignmentToApi(existingAssign, tagRow));
    }

    const appliedBy = body.appliedBy ?? "manual";
    const inserted = await db
      .insert(tagAssignmentsTable)
      .values({
        tagId: tagRow.id,
        entityType,
        entityId,
        appliedBy,
        appliedByActor: appliedBy === "ai" ? "ai" : "operator",
        aiModel: body.aiModel ?? null,
        aiProvider: body.aiProvider ?? null,
        rationale: body.rationale ?? null,
      })
      .returning();

    await db.insert(activityEntries).values({
      kind: appliedBy === "ai" ? "TAG_AI_APPLIED" : "TAG_ADDED",
      actor: appliedBy === "ai" ? "ai" : "operator",
      message: `Tagged ${humanEntityLabel(entityType)} "${entityLabel.label}" with #${tagRow.name}`,
      refType: entityType,
      refId: entityId,
      meta: {
        tagId: tagRow.id,
        tagSlug: tagRow.slug,
        appliedBy,
        aiModel: body.aiModel ?? null,
        rationale: body.rationale ?? null,
      },
    });

    res.status(201).json(assignmentToApi(inserted[0]!, tagRow));
  } catch (err) {
    next(err);
  }
});

router.delete("/tags/for/:entityType/:entityId/:tagId", async (req, res, next) => {
  try {
    const entityType = req.params.entityType;
    const entityId = req.params.entityId;
    const tagId = req.params.tagId;
    if (!isEntityType(entityType)) {
      return res.status(400).json({ error: "invalid entity type" });
    }
    const [tagRow] = await db.select().from(tagsTable).where(eq(tagsTable.id, tagId));
    if (!tagRow) return res.status(404).json({ error: "tag not found" });
    const deleted = await db
      .delete(tagAssignmentsTable)
      .where(
        and(
          eq(tagAssignmentsTable.tagId, tagId),
          eq(tagAssignmentsTable.entityType, entityType),
          eq(tagAssignmentsTable.entityId, entityId),
        ),
      )
      .returning();
    if (deleted.length > 0) {
      const lbl = await resolveEntityLabel(entityType, entityId);
      await db.insert(activityEntries).values({
        kind: "TAG_REMOVED",
        actor: "operator",
        message: `Removed tag #${tagRow.name} from ${humanEntityLabel(entityType)} "${lbl?.label ?? entityId}"`,
        refType: entityType,
        refId: entityId,
        meta: { tagId: tagRow.id, tagSlug: tagRow.slug },
      });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const SuggestBody = z.object({
  entityType: z.enum(TAG_ENTITY_TYPES as unknown as [string, ...string[]]),
  entityId: z.string().min(1),
});

router.post("/tags/suggest", async (req, res, next) => {
  try {
    const parsed = SuggestBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
    }
    const entityType = parsed.data.entityType as TagEntityType;
    const entityId = parsed.data.entityId;
    const summary = await buildEntitySummary(entityType, entityId);
    if (!summary) return res.status(404).json({ error: "entity not found" });

    const allTags = await db.select().from(tagsTable);
    const { provider, model } = await loadAiSettings();

    const { suggestions } = await suggestTagsForEntity({
      provider,
      model,
      recordSummary: summary.summary,
      existingTags: allTags.map((t) => ({
        name: t.name,
        slug: t.slug,
        description: t.description || null,
      })),
    });

    // Decorate each suggestion with the existing slug/color when reusable.
    const byName = new Map(allTags.map((t) => [t.name.toLowerCase(), t]));
    const decorated = suggestions.map((s) => {
      const match = byName.get(s.name.toLowerCase());
      return {
        ...s,
        isNew: match ? false : s.isNew,
        slug: match?.slug ?? null,
        color: match?.color ?? pickColorFor(s.name),
      };
    });

    res.json({
      generatedAt: new Date().toISOString(),
      provider,
      model,
      suggestions: decorated,
    });
  } catch (err) {
    next(err);
  }
});

const AutoTagBody = z.object({
  entityType: z.enum(TAG_ENTITY_TYPES as unknown as [string, ...string[]]),
  scope: z.enum(["recent", "untagged"]),
  limit: z.number().int().min(1).max(25).optional(),
});

router.post("/tags/auto-tag", async (req, res, next) => {
  try {
    const parsed = AutoTagBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
    }
    const entityType = parsed.data.entityType as TagEntityType;
    const limit = parsed.data.limit ?? 10;
    const scope = parsed.data.scope;

    const candidates = await pickAutoTagCandidates(entityType, scope, limit);
    const allTags = await db.select().from(tagsTable);
    const byName = new Map(allTags.map((t) => [t.name.toLowerCase(), t]));
    const { provider, model } = await loadAiSettings();

    const results: Array<{
      entityId: string;
      label: string;
      applied: string[];
      error: string | null;
    }> = [];
    let appliedTotal = 0;
    for (const c of candidates) {
      try {
        const { suggestions } = await suggestTagsForEntity({
          provider,
          model,
          recordSummary: c.summary,
          existingTags: allTags.map((t) => ({
            name: t.name,
            slug: t.slug,
            description: t.description || null,
          })),
        });
        // High-confidence threshold for auto-application.
        const accepted = suggestions
          .filter((s) => s.confidence >= 0.7)
          .slice(0, 5);
        const appliedNames: string[] = [];
        for (const s of accepted) {
          const slug = slugify(s.name);
          let tagRow = byName.get(s.name.toLowerCase());
          if (!tagRow) {
            const id = newTagId(slug);
            await db.insert(tagsTable).values({
              id,
              name: s.name,
              slug,
              color: pickColorFor(s.name),
              description: "",
              source: "ai",
              createdBy: "ai",
            });
            const [created] = await db.select().from(tagsTable).where(eq(tagsTable.id, id));
            if (created) {
              tagRow = created;
              byName.set(s.name.toLowerCase(), created);
            }
          }
          if (!tagRow) continue;
          const [exists] = await db
            .select()
            .from(tagAssignmentsTable)
            .where(
              and(
                eq(tagAssignmentsTable.tagId, tagRow.id),
                eq(tagAssignmentsTable.entityType, entityType),
                eq(tagAssignmentsTable.entityId, c.entityId),
              ),
            );
          if (exists) continue;
          await db.insert(tagAssignmentsTable).values({
            tagId: tagRow.id,
            entityType,
            entityId: c.entityId,
            appliedBy: "ai",
            appliedByActor: "ai",
            aiModel: model,
            aiProvider: provider,
            rationale: s.rationale,
          });
          appliedNames.push(tagRow.name);
          appliedTotal += 1;
          await db.insert(activityEntries).values({
            kind: "TAG_AI_APPLIED",
            actor: "ai",
            message: `Auto-tagged ${humanEntityLabel(entityType)} "${c.label}" with #${tagRow.name}`,
            refType: entityType,
            refId: c.entityId,
            meta: {
              tagId: tagRow.id,
              tagSlug: tagRow.slug,
              appliedBy: "ai",
              aiModel: model,
              rationale: s.rationale,
            },
          });
        }
        results.push({ entityId: c.entityId, label: c.label, applied: appliedNames, error: null });
      } catch (err) {
        results.push({
          entityId: c.entityId,
          label: c.label,
          applied: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    res.json({
      generatedAt: new Date().toISOString(),
      provider,
      model,
      processed: candidates.length,
      applied: appliedTotal,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// ---- helpers used above ----

async function pickAutoTagCandidates(
  entityType: TagEntityType,
  scope: "recent" | "untagged",
  limit: number,
): Promise<Array<{ entityId: string; label: string; summary: string }>> {
  const ids = await pickEntityIds(entityType, scope, limit);
  const out: Array<{ entityId: string; label: string; summary: string }> = [];
  for (const id of ids) {
    const s = await buildEntitySummary(entityType, id);
    if (!s) continue;
    out.push({ entityId: id, label: s.label, summary: s.summary });
  }
  return out;
}

async function pickEntityIds(
  entityType: TagEntityType,
  scope: "recent" | "untagged",
  limit: number,
): Promise<string[]> {
  // Pull a wide candidate set, then filter by tagged/untagged at the end.
  const fetchAll = async (): Promise<Array<{ id: string }>> => {
    switch (entityType) {
      case "node":
        return db
          .select({ id: nodesTable.id })
          .from(nodesTable)
          .where(eq(nodesTable.hiddenFromMap, false))
          .limit(80);
      case "item":
        return db.select({ id: itemsTable.id }).from(itemsTable).limit(80);
      case "supplier":
        return db.select({ id: suppliersTable.id }).from(suppliersTable).limit(80);
      case "order":
        return db
          .select({ id: ordersTable.id })
          .from(ordersTable)
          .orderBy(desc(ordersTable.createdAt))
          .limit(80);
      case "shipment":
        return db
          .select({ id: shipmentsTable.id })
          .from(shipmentsTable)
          .orderBy(desc(shipmentsTable.departedAt))
          .limit(80);
      case "scenario":
        return db
          .select({ id: scenariosTable.id })
          .from(scenariosTable)
          .orderBy(desc(scenariosTable.runAt))
          .limit(80);
      case "alert":
        return db
          .select({ id: alertsTable.id })
          .from(alertsTable)
          .orderBy(desc(alertsTable.openedAt))
          .limit(80);
      case "blood_lot":
        return db
          .select({ id: bloodLotsTable.id })
          .from(bloodLotsTable)
          .orderBy(desc(bloodLotsTable.collectedAt))
          .limit(80);
      default:
        return [];
    }
  };
  const all = await fetchAll();
  if (scope === "recent") return all.slice(0, limit).map((r) => r.id);
  // untagged scope
  const tagged = await db
    .select({ id: tagAssignmentsTable.entityId })
    .from(tagAssignmentsTable)
    .where(eq(tagAssignmentsTable.entityType, entityType));
  const taggedSet = new Set(tagged.map((t) => t.id));
  const untagged = all.filter((a) => !taggedSet.has(a.id));
  return untagged.slice(0, limit).map((r) => r.id);
}

async function resolveEntityLabel(
  entityType: TagEntityType,
  entityId: string,
): Promise<{ label: string; sublabel: string | null } | null> {
  const m = await resolveEntityLabels(entityType, [entityId]);
  return m.get(entityId) ?? null;
}

async function resolveEntityLabels(
  entityType: TagEntityType,
  entityIds: string[],
): Promise<Map<string, { label: string; sublabel: string | null }>> {
  const out = new Map<string, { label: string; sublabel: string | null }>();
  if (entityIds.length === 0) return out;
  const ids = Array.from(new Set(entityIds));
  switch (entityType) {
    case "node": {
      const rows = await db.select().from(nodesTable).where(inArray(nodesTable.id, ids));
      for (const r of rows) out.set(r.id, { label: r.name, sublabel: r.type });
      break;
    }
    case "item": {
      const rows = await db.select().from(itemsTable).where(inArray(itemsTable.id, ids));
      for (const r of rows) out.set(r.id, { label: r.name, sublabel: r.category });
      break;
    }
    case "supplier": {
      const rows = await db.select().from(suppliersTable).where(inArray(suppliersTable.id, ids));
      for (const r of rows) out.set(r.id, { label: r.name, sublabel: r.channel });
      break;
    }
    case "order": {
      const rows = await db.select().from(ordersTable).where(inArray(ordersTable.id, ids));
      for (const r of rows) out.set(r.id, { label: r.orderNo, sublabel: r.status });
      break;
    }
    case "shipment": {
      const rows = await db.select().from(shipmentsTable).where(inArray(shipmentsTable.id, ids));
      for (const r of rows) out.set(r.id, { label: r.id, sublabel: r.priority });
      break;
    }
    case "scenario": {
      const rows = await db.select().from(scenariosTable).where(inArray(scenariosTable.id, ids));
      for (const r of rows) out.set(r.id, { label: r.name, sublabel: r.kind });
      break;
    }
    case "alert": {
      const rows = await db.select().from(alertsTable).where(inArray(alertsTable.id, ids));
      for (const r of rows)
        out.set(r.id, { label: r.message.slice(0, 80), sublabel: r.severity });
      break;
    }
    case "blood_lot": {
      const rows = await db.select().from(bloodLotsTable).where(inArray(bloodLotsTable.id, ids));
      for (const r of rows)
        out.set(r.id, {
          label: `${r.component} ${r.aboGroup ?? ""}${r.rhFactor ?? ""}`.trim(),
          sublabel: r.status,
        });
      break;
    }
  }
  return out;
}

function humanEntityLabel(t: TagEntityType): string {
  switch (t) {
    case "node":
      return "site";
    case "item":
      return "item";
    case "supplier":
      return "supplier";
    case "order":
      return "order";
    case "shipment":
      return "shipment";
    case "scenario":
      return "scenario";
    case "alert":
      return "alert";
    case "blood_lot":
      return "blood lot";
  }
}

export default router;
