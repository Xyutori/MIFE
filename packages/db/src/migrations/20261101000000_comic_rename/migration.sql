-- Data migration: rename the comic workspace `mife` -> `comic`.
--
-- No DDL here, only DML. Every statement is guarded (`EXISTS` / `ON CONFLICT`
-- / `NOT EXISTS`) so re-running this migration is a no-op (idempotent) and it
-- is safe whether it runs before or after the application seed
-- (`seedWorkspaceSources`, which now writes `comic:*` ids with
-- `onConflictDoNothing`).
--
-- Order matters because the schema has no `ON UPDATE CASCADE`: the `comic`
-- target rows are ensured first (copied from the `mife` rows), children are
-- repointed to them, and only then are the orphaned `mife` rows deleted.
--> statement-breakpoint
INSERT INTO "workspaces" ("id", "slug", "name", "enabled", "created_at", "updated_at")
SELECT 'comic', 'comic', 'Comic', "enabled", "created_at", "updated_at"
FROM "workspaces" WHERE "id" = 'mife'
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "sources" ("id", "workspace_id", "key", "name", "base_url", "prefix", "enabled", "request_delay_ms", "config_json", "created_at", "updated_at")
SELECT 'comic' || substring("id" from 5), 'comic', "key", "name", "base_url", "prefix", "enabled", "request_delay_ms", "config_json", "created_at", "updated_at"
FROM "sources" WHERE "workspace_id" = 'mife' AND "id" LIKE 'mife:%'
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "workspaces" SET "slug" = 'comic', "name" = 'Comic'
WHERE "id" = 'comic' AND ("slug" = 'mife' OR "name" = 'MIFE');--> statement-breakpoint
UPDATE "series" SET "workspace_id" = 'comic'
WHERE "workspace_id" = 'mife'
AND EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'comic');--> statement-breakpoint
UPDATE "series_aliases" SET "workspace_id" = 'comic'
WHERE "workspace_id" = 'mife'
AND EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'comic');--> statement-breakpoint
UPDATE "scrape_runs" SET "workspace_id" = 'comic'
WHERE "workspace_id" = 'mife'
AND EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'comic');--> statement-breakpoint
UPDATE "series_sources" SET "source_id" = 'comic' || substring("series_sources"."source_id" from 5)
WHERE "series_sources"."source_id" LIKE 'mife:%'
AND EXISTS (SELECT 1 FROM "sources" WHERE "sources"."id" = 'comic' || substring("series_sources"."source_id" from 5));--> statement-breakpoint
UPDATE "chapter_sources" SET "source_id" = 'comic' || substring("chapter_sources"."source_id" from 5)
WHERE "chapter_sources"."source_id" LIKE 'mife:%'
AND EXISTS (SELECT 1 FROM "sources" WHERE "sources"."id" = 'comic' || substring("chapter_sources"."source_id" from 5));--> statement-breakpoint
UPDATE "media_assets" SET "source_id" = 'comic' || substring("media_assets"."source_id" from 5)
WHERE "media_assets"."source_id" LIKE 'mife:%'
AND EXISTS (SELECT 1 FROM "sources" WHERE "sources"."id" = 'comic' || substring("media_assets"."source_id" from 5));--> statement-breakpoint
UPDATE "scrape_runs" SET "source_id" = 'comic' || substring("scrape_runs"."source_id" from 5)
WHERE "scrape_runs"."source_id" LIKE 'mife:%'
AND EXISTS (SELECT 1 FROM "sources" WHERE "sources"."id" = 'comic' || substring("scrape_runs"."source_id" from 5));--> statement-breakpoint
UPDATE "source_scrape_state" SET "source_id" = 'comic' || substring("source_scrape_state"."source_id" from 5)
WHERE "source_scrape_state"."source_id" LIKE 'mife:%'
AND EXISTS (SELECT 1 FROM "sources" WHERE "sources"."id" = 'comic' || substring("source_scrape_state"."source_id" from 5));--> statement-breakpoint
UPDATE "sources" SET "workspace_id" = 'comic'
WHERE "workspace_id" = 'mife'
AND "sources"."id" NOT LIKE 'mife:%'
AND NOT EXISTS (SELECT 1 FROM "sources" AS "tgt" WHERE "tgt"."workspace_id" = 'comic' AND "tgt"."key" = "sources"."key")
AND EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'comic');--> statement-breakpoint
DELETE FROM "sources" WHERE "id" LIKE 'mife:%'
AND EXISTS (SELECT 1 FROM "sources" AS "tgt" WHERE "tgt"."id" = 'comic' || substring("sources"."id" from 5))
AND NOT EXISTS (SELECT 1 FROM "series_sources" WHERE "series_sources"."source_id" = "sources"."id")
AND NOT EXISTS (SELECT 1 FROM "chapter_sources" WHERE "chapter_sources"."source_id" = "sources"."id")
AND NOT EXISTS (SELECT 1 FROM "media_assets" WHERE "media_assets"."source_id" = "sources"."id")
AND NOT EXISTS (SELECT 1 FROM "scrape_runs" WHERE "scrape_runs"."source_id" = "sources"."id")
AND NOT EXISTS (SELECT 1 FROM "source_scrape_state" WHERE "source_scrape_state"."source_id" = "sources"."id");--> statement-breakpoint
DELETE FROM "workspaces" WHERE "id" = 'mife'
AND EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'comic')
AND NOT EXISTS (SELECT 1 FROM "sources" WHERE "workspace_id" = 'mife')
AND NOT EXISTS (SELECT 1 FROM "series" WHERE "workspace_id" = 'mife')
AND NOT EXISTS (SELECT 1 FROM "series_aliases" WHERE "workspace_id" = 'mife')
AND NOT EXISTS (SELECT 1 FROM "scrape_runs" WHERE "workspace_id" = 'mife');
