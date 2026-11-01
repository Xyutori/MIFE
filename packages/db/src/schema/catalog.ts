/**
 * Manga/comic catalog tables, ported from XyMI `packages/db/src/schema/index.ts`.
 *
 * ## Primary-key decisions
 * XyMI uses opaque text IDs everywhere (no AUTOINCREMENT column exists in the
 * source), so every `id` stays `text().primaryKey()`. Keeping the original IDs
 * as the primary key (instead of introducing `serial`/`uuid` surrogates)
 * preserves bookmark compatibility: `comic_bookmark_entries.series_id` and all
 * scraper cursors keep pointing at the same values after migration.
 * Join tables without their own identity (`series_genres`) keep the XyMI shape:
 * no surrogate PK, uniqueness enforced by a unique index.
 *
 * ## Type mapping (SQLite -> Postgres)
 * - `text` ISO-8601 datetime -> `timestamptz` (`timestamp` with
 *   `withTimezone: true, mode: "date"`). Insert defaults that used
 *   `strftime(...)` become `.defaultNow()`; `updatedAt` is refreshed app-side
 *   on write (same contract as XyMI, which had no update trigger either).
 * - `integer({ mode: "boolean" })` -> `boolean`.
 * - `integer` -> `integer`, `real` -> `real`.
 * - JSON stored as TEXT (`*_json`, `raw_payload`, `summary_json`, ...) ->
 *   `jsonb` with an explicit `$type`. Defaults use `'[]'::jsonb` / `'{}'::jsonb`.
 *
 * ## Index simplifications
 * Two SQLite expression indexes ordered by `julianday(...)` have no Postgres
 * equivalent; they are ported as plain composite btree indexes on the same
 * leading columns (`*_recent_v3`, `*_title_v3`). `timestamptz` sorts natively,
 * so catalog ordering keeps working; NULL placement follows Postgres defaults.
 * `lower(...)` functional indexes port 1:1.
 *
 * ## Full-text search (`series.search_vector`)
 * - Column type is `tsvector` (via `customType`, since drizzle-orm 1.0-rc.5 has
 *   no built-in tsvector column) with a GIN index below. The `pg_trgm`
 *   extension is enabled in the migration SQL for future trigram similarity
 *   search; the GIN index on `search_vector` itself needs no extension.
 * - FTS *querying* ships later (API phase). Until then the filler contract is:
 *   on every series insert/update, app-side must run
 *     `UPDATE series SET search_vector =
 *        to_tsvector('simple', coalesce(title,'') || ' ' ||
 *        coalesce(alternative_title,'') || ' ' || coalesce(description,''))
 *      WHERE id = :id;`
 *   (`'simple'` dictionary: no stemming, predictable for Indonesian text.
 *   Revisit if stemming per-language is needed.)
 * - `migrate-from-xymi.ts` backfills the column with the same expression.
 */

import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	customType,
	index,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/** `tsvector` column type (drizzle-orm 1.0-rc.5 has no built-in tsvector). */
export const tsvector = customType<{ data: string }>({
	dataType: () => "tsvector",
});

const timestamps = () => ({
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

const timestamptz = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });

export const workspaces = pgTable(
	"workspaces",
	{
		id: text("id").primaryKey(),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		...timestamps(),
	},
	(table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)],
);

export const sources = pgTable(
	"sources",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		name: text("name").notNull(),
		baseUrl: text("base_url").notNull(),
		prefix: text("prefix").notNull().default(""),
		enabled: boolean("enabled").notNull().default(true),
		requestDelayMs: integer("request_delay_ms").notNull().default(700),
		configJson: jsonb("config_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("sources_workspace_key_unique").on(
			table.workspaceId,
			table.key,
		),
		index("sources_workspace_idx").on(table.workspaceId),
	],
);

export const series = pgTable(
	"series",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		normalizedTitle: text("normalized_title").notNull(),
		alternativeTitle: text("alternative_title"),
		description: text("description"),
		coverImageUrl: text("cover_image_url"),
		status: text("status"),
		releaseYear: integer("release_year"),
		authorsJson: jsonb("authors_json")
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		artistsJson: jsonb("artists_json")
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		genresJson: jsonb("genres_json")
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		formatsJson: jsonb("formats_json")
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		comicType: text("comic_type"),
		countryId: text("country_id"),
		viewCount: integer("view_count"),
		localViewCount: integer("local_view_count").notNull().default(0),
		rating: real("rating"),
		bookmarkCount: integer("bookmark_count"),
		popularityRank: integer("popularity_rank"),
		isFeatured: boolean("is_featured"),
		isRecommended: boolean("is_recommended"),
		isVisible: boolean("is_visible").notNull().default(true),
		latestChapterNumber: text("latest_chapter_number"),
		latestChapterAt: timestamptz("latest_chapter_at"),
		sourceUpdatedAt: timestamptz("source_updated_at"),
		searchVector: tsvector("search_vector"),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("series_workspace_title_unique").on(
			table.workspaceId,
			table.normalizedTitle,
		),
		index("series_workspace_updated_idx").on(
			table.workspaceId,
			table.updatedAt,
		),
		index("series_title_idx").on(table.title),
		index("series_catalog_recent_v2_idx").on(
			table.workspaceId,
			table.isVisible,
			table.latestChapterAt,
			table.updatedAt,
		),
		index("series_catalog_title_v2_idx").on(
			table.workspaceId,
			table.isVisible,
			table.title,
			table.updatedAt,
		),
		// Simplified from julianday(...) expression ordering; see header.
		index("series_catalog_recent_v3_idx").on(
			table.workspaceId,
			table.isVisible,
			table.latestChapterAt,
			table.updatedAt,
		),
		index("series_catalog_title_v3_idx").on(
			table.workspaceId,
			table.isVisible,
			table.title,
			table.updatedAt,
		),
		index("series_public_country_v2_idx").on(
			table.workspaceId,
			table.isVisible,
			sql`lower(${table.countryId})`,
		),
		index("series_public_type_v2_idx").on(
			table.workspaceId,
			table.isVisible,
			sql`lower(${table.comicType})`,
		),
		index("series_search_vector_idx").using("gin", table.searchVector),
	],
);

export const seriesAliases = pgTable(
	"series_aliases",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		seriesId: text("series_id")
			.notNull()
			.references(() => series.id, { onDelete: "cascade" }),
		alias: text("alias").notNull(),
		normalizedAlias: text("normalized_alias").notNull(),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("series_aliases_workspace_alias_unique").on(
			table.workspaceId,
			table.normalizedAlias,
		),
		index("series_aliases_series_idx").on(table.seriesId),
	],
);

export const seriesGenres = pgTable(
	"series_genres",
	{
		seriesId: text("series_id")
			.notNull()
			.references(() => series.id, { onDelete: "cascade" }),
		genreKey: text("genre_key").notNull(),
	},
	(table) => [
		uniqueIndex("series_genres_series_genre_unique").on(
			table.seriesId,
			table.genreKey,
		),
		index("series_genres_lookup_idx").on(table.genreKey, table.seriesId),
	],
);

export const seriesSources = pgTable(
	"series_sources",
	{
		id: text("id").primaryKey(),
		seriesId: text("series_id")
			.notNull()
			.references(() => series.id, { onDelete: "cascade" }),
		sourceId: text("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		externalId: text("external_id").notNull(),
		category: text("category"),
		slug: text("slug"),
		sourceUrl: text("source_url"),
		title: text("title").notNull(),
		alternativeTitle: text("alternative_title"),
		bannerUrl: text("banner_url"),
		sourceUpdatedAt: timestamptz("source_updated_at"),
		rawPayload: jsonb("raw_payload")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		lastScrapedAt: timestamptz("last_scraped_at"),
		lastHydratedAt: timestamptz("last_hydrated_at"),
		needsHydration: boolean("needs_hydration").notNull().default(true),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("series_sources_source_external_unique").on(
			table.sourceId,
			table.externalId,
		),
		index("series_sources_series_idx").on(table.seriesId),
		index("series_sources_source_updated_idx").on(
			table.sourceId,
			table.sourceUpdatedAt,
		),
	],
);

export const chapters = pgTable(
	"chapters",
	{
		id: text("id").primaryKey(),
		seriesId: text("series_id")
			.notNull()
			.references(() => series.id, { onDelete: "cascade" }),
		normalizedNumber: text("normalized_number").notNull(),
		numberText: text("number_text").notNull(),
		sortNumber: real("sort_number"),
		title: text("title"),
		publishedAt: timestamptz("published_at"),
		viewCount: integer("view_count"),
		localViewCount: integer("local_view_count").notNull().default(0),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("chapters_series_number_unique").on(
			table.seriesId,
			table.normalizedNumber,
		),
		index("chapters_series_number_idx").on(table.seriesId, table.sortNumber),
		index("chapters_series_recent_v2_idx").on(
			table.seriesId,
			table.sortNumber,
			table.publishedAt,
			table.updatedAt,
		),
		index("chapters_series_number_search_v2_idx").on(
			table.seriesId,
			sql`lower(${table.numberText})`,
		),
		index("chapters_published_idx").on(table.publishedAt),
	],
);

export const chapterSources = pgTable(
	"chapter_sources",
	{
		id: text("id").primaryKey(),
		chapterId: text("chapter_id")
			.notNull()
			.references(() => chapters.id, { onDelete: "cascade" }),
		seriesSourceId: text("series_source_id")
			.notNull()
			.references(() => seriesSources.id, { onDelete: "cascade" }),
		sourceId: text("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		externalId: text("external_id").notNull(),
		slug: text("slug"),
		sourceUrl: text("source_url"),
		title: text("title"),
		thumbnailUrl: text("thumbnail_url"),
		readerUrlStatus: text("reader_url_status").notNull().default("pending"),
		readerUrlCount: integer("reader_url_count").notNull().default(0),
		readerUrlsScrapedAt: timestamptz("reader_urls_scraped_at"),
		readerUrlError: text("reader_url_error"),
		publishedAt: timestamptz("published_at"),
		viewCount: integer("view_count"),
		rawPayload: jsonb("raw_payload")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		lastScrapedAt: timestamptz("last_scraped_at"),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("chapter_sources_source_external_unique").on(
			table.sourceId,
			table.externalId,
		),
		uniqueIndex("chapter_sources_series_source_chapter_unique").on(
			table.seriesSourceId,
			table.chapterId,
		),
		index("chapter_sources_chapter_idx").on(table.chapterId),
		index("chapter_sources_release_idx").on(table.publishedAt),
		index("chapter_sources_reader_url_status_idx").on(
			table.sourceId,
			table.readerUrlStatus,
		),
		check(
			"chapter_sources_reader_url_status_check",
			sql`${table.readerUrlStatus} in ('pending', 'running', 'complete', 'complete_empty', 'failed')`,
		),
	],
);

export const imageBlobs = pgTable(
	"image_blobs",
	{
		sha256: text("sha256").primaryKey(),
		objectKey: text("object_key").notNull(),
		contentType: text("content_type").notNull(),
		byteSize: integer("byte_size").notNull(),
		...timestamps(),
	},
	(table) => [uniqueIndex("image_blobs_object_key_unique").on(table.objectKey)],
);

export const chapterPages = pgTable(
	"chapter_pages",
	{
		id: text("id").primaryKey(),
		chapterSourceId: text("chapter_source_id")
			.notNull()
			.references(() => chapterSources.id, { onDelete: "cascade" }),
		pageIndex: integer("page_index").notNull(),
		isActive: boolean("is_active").notNull().default(true),
		externalUrl: text("external_url").notNull(),
		blobSha256: text("blob_sha256").references(() => imageBlobs.sha256, {
			onDelete: "set null",
		}),
		downloadStatus: text("download_status").notNull().default("remote"),
		downloadAttempts: integer("download_attempts").notNull().default(0),
		lastError: text("last_error"),
		downloadedAt: timestamptz("downloaded_at"),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("chapter_pages_source_position_unique").on(
			table.chapterSourceId,
			table.pageIndex,
		),
		index("chapter_pages_status_idx").on(table.downloadStatus),
		index("chapter_pages_external_url_idx").on(table.externalUrl),
	],
);

export const imageVariants = pgTable(
	"image_variants",
	{
		id: text("id").primaryKey(),
		blobSha256: text("blob_sha256")
			.notNull()
			.references(() => imageBlobs.sha256, { onDelete: "cascade" }),
		format: text("format").notNull(),
		objectKey: text("object_key").notNull(),
		contentType: text("content_type").notNull(),
		byteSize: integer("byte_size").notNull(),
		sha256: text("sha256"),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("image_variants_blob_format_unique").on(
			table.blobSha256,
			table.format,
		),
		uniqueIndex("image_variants_object_key_unique").on(table.objectKey),
	],
);

export const mediaAssets = pgTable(
	"media_assets",
	{
		id: text("id").primaryKey(),
		assetType: text("asset_type").notNull(),
		ownerType: text("owner_type").notNull(),
		ownerId: text("owner_id").notNull(),
		sourceId: text("source_id").references(() => sources.id, {
			onDelete: "set null",
		}),
		pageIndex: integer("page_index"),
		externalUrl: text("external_url").notNull(),
		blobSha256: text("blob_sha256").references(() => imageBlobs.sha256, {
			onDelete: "set null",
		}),
		downloadStatus: text("download_status").notNull().default("remote"),
		integrityStatus: text("integrity_status").notNull().default("unchecked"),
		sha256: text("sha256"),
		contentType: text("content_type"),
		byteSize: integer("byte_size"),
		downloadAttempts: integer("download_attempts").notNull().default(0),
		lastError: text("last_error"),
		downloadedAt: timestamptz("downloaded_at"),
		lastVerifiedAt: timestamptz("last_verified_at"),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("media_assets_owner_unique").on(
			table.assetType,
			table.ownerType,
			table.ownerId,
		),
		index("media_assets_status_idx").on(
			table.downloadStatus,
			table.integrityStatus,
		),
		index("media_assets_source_idx").on(table.sourceId),
		index("media_assets_external_url_idx").on(table.externalUrl),
	],
);

export const scrapeRuns = pgTable(
	"scrape_runs",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		sourceId: text("source_id").references(() => sources.id, {
			onDelete: "set null",
		}),
		kind: text("kind").notNull(),
		mode: text("mode").notNull().default("incremental"),
		status: text("status").notNull().default("queued"),
		triggeredBy: text("triggered_by").notNull().default("manual"),
		jobKey: text("job_key"),
		workerToken: text("worker_token"),
		workerLeaseExpiresAt: timestamptz("worker_lease_expires_at"),
		progressTotal: integer("progress_total").notNull().default(0),
		progressCompleted: integer("progress_completed").notNull().default(0),
		progressFailed: integer("progress_failed").notNull().default(0),
		currentStep: text("current_step"),
		startedAt: timestamptz("started_at"),
		finishedAt: timestamptz("finished_at"),
		errorMessage: text("error_message"),
		summaryJson: jsonb("summary_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		...timestamps(),
	},
	(table) => [
		index("scrape_runs_workspace_created_idx").on(
			table.workspaceId,
			table.createdAt,
		),
		index("scrape_runs_status_idx").on(table.status),
		index("scrape_runs_source_kind_idx").on(table.sourceId, table.kind),
		uniqueIndex("scrape_runs_job_key_unique").on(table.jobKey),
	],
);

export const scrapeEvents = pgTable(
	"scrape_events",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => scrapeRuns.id, { onDelete: "cascade" }),
		level: text("level").notNull().default("info"),
		message: text("message").notNull(),
		detailsJson: jsonb("details_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		...timestamps(),
	},
	(table) => [
		index("scrape_events_run_created_idx").on(table.runId, table.createdAt),
	],
);

export const sourceScrapeState = pgTable(
	"source_scrape_state",
	{
		id: text("id").primaryKey(),
		sourceId: text("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		lastFullAt: timestamptz("last_full_at"),
		lastSuccessAt: timestamptz("last_success_at"),
		lastAttemptAt: timestamptz("last_attempt_at"),
		lastAutoScrapeDate: text("last_auto_scrape_date"),
		// Slot "HH:MM" terakhir yang dijalankan scrape otomatis (multi-jadwal
		// harian). Bersama lastAutoScrapeDate membentuk penanda monoton
		// "YYYY-MM-DD HH:MM" zona waktu scrape agar tiap slot jalan tepat
		// sekali per hari per sumber.
		lastAutoScrapeSlot: text("last_auto_scrape_slot"),
		cursorJson: jsonb("cursor_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("source_scrape_state_source_unique").on(table.sourceId),
	],
);

export const appSettings = pgTable("app_settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	...timestamps(),
});
