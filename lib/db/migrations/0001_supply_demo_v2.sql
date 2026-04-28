-- Migration for task #157: Add isolated schema for the Supply demo import.
-- Adds four new tables prefixed `supply_demo_v2_` and their indexes/foreign
-- keys. Contains only CREATE TABLE / ALTER TABLE ADD CONSTRAINT (FK) /
-- CREATE INDEX statements — no ALTER or DROP of any pre-existing object.
--
-- Applied via `pnpm --filter @workspace/db push` (drizzle-kit push). This
-- file is the equivalent SQL extracted from `drizzle-kit generate` for
-- review/audit purposes.

CREATE TABLE "supply_demo_v2_catalog" (
        "id" serial PRIMARY KEY NOT NULL,
        "mfr_cat_no" text NOT NULL,
        "manufacturer_short" text NOT NULL,
        "manufacturer_long" text,
        "product_noun" text,
        "product_type" text,
        "item_dsc_short" text,
        "full_description" text,
        "product_ndc" text,
        "product_size" text,
        "unspsc_commodity" text,
        "ghx_commodity_type" text,
        "sos_type_description" text,
        "source" text DEFAULT 'supply_demo_v2' NOT NULL,
        "imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_demo_v2_facilities" (
        "id" serial PRIMARY KEY NOT NULL,
        "code" text NOT NULL,
        "display_name" text NOT NULL,
        "source" text DEFAULT 'supply_demo_v2' NOT NULL,
        "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "supply_demo_v2_facilities_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "supply_demo_v2_imports" (
        "id" serial PRIMARY KEY NOT NULL,
        "source_file" text NOT NULL,
        "started_at" timestamp with time zone DEFAULT now() NOT NULL,
        "finished_at" timestamp with time zone,
        "source_rows_read" integer,
        "duplicates_collapsed" integer,
        "catalog_upserts" integer,
        "facility_upserts" integer,
        "issue_rows_inserted" integer,
        "notes" text
);
--> statement-breakpoint
CREATE TABLE "supply_demo_v2_issues" (
        "id" serial PRIMARY KEY NOT NULL,
        "catalog_id" integer NOT NULL,
        "facility_id" integer NOT NULL,
        "quantity" numeric NOT NULL,
        "total_quantity" numeric NOT NULL,
        "line_count" integer NOT NULL,
        "source" text DEFAULT 'supply_demo_v2' NOT NULL,
        "imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supply_demo_v2_issues" ADD CONSTRAINT "supply_demo_v2_issues_catalog_id_supply_demo_v2_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."supply_demo_v2_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_demo_v2_issues" ADD CONSTRAINT "supply_demo_v2_issues_facility_id_supply_demo_v2_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."supply_demo_v2_facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supply_demo_v2_catalog_mfr_cat_manufacturer_unique" ON "supply_demo_v2_catalog" USING btree ("mfr_cat_no","manufacturer_short");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_demo_v2_issues_catalog_facility_quantity_unique" ON "supply_demo_v2_issues" USING btree ("catalog_id","facility_id","quantity");--> statement-breakpoint
CREATE INDEX "supply_demo_v2_issues_catalog_facility_idx" ON "supply_demo_v2_issues" USING btree ("catalog_id","facility_id");
