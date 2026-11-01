/**
 * Anime tables, ported from XyMI `packages/db/src/schema/index.ts`
 * (`anime_series` and related tables).
 *
 * ## Primary-key decisions
 * Same policy as `catalog.ts`: XyMI uses opaque text IDs, so every `id` stays
 * `text().primaryKey()`. Original IDs/slugs are preserved untouched, keeping
 * `anime_bookmark_entries.anime_id` and scraper cursors compatible.
 * Join tables without identity (`anime_series_genres`) keep the XyMI shape:
 * no surrogate PK, uniqueness via a unique index.
 *
 * ## Type mapping
 * Identical to `catalog.ts`: ISO-8601 TEXT datetimes -> `timestamptz`,
 * `integer({ mode: "boolean" })` -> `boolean`, TEXT-encoded JSON -> `jsonb`.
 * FKs to the shared `sources` / `image_blobs` tables are imported from
 * `catalog.ts` (no table is duplicated across files).
 *
 * ## Full-text search (`anime_series.search_vector`)
 * Same contract as `series.search_vector`: `tsvector` + GIN index, filled
 * app-side on every write with
 *   `to_tsvector('simple', coalesce(title,'') || ' ' ||
 *    coalesce(alternative_title,'') || ' ' || coalesce(synopsis,''))`.
 * FTS querying ships later (API phase).
 */

import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { imageBlobs, sources, tsvector } from "./catalog";

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

export const animeSeries = pgTable(
	"anime_series",
	{
		id: text("id").primaryKey(),
		normalizedTitle: text("normalized_title").notNull(),
		title: text("title").notNull(),
		alternativeTitle: text("alternative_title"),
		synopsis: text("synopsis"),
		status: text("status"),
		releaseYear: integer("release_year"),
		score: real("score"),
		episodeCount: integer("episode_count"),
		animeType: text("anime_type"),
		studio: text("studio"),
		genresJson: jsonb("genres_json")
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		metadataJson: jsonb("metadata_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		isVisible: boolean("is_visible").notNull().default(true),
		latestEpisodeNumber: text("latest_episode_number"),
		latestEpisodeAt: timestamptz("latest_episode_at"),
		searchVector: tsvector("search_vector"),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("anime_series_normalized_title_unique").on(
			table.normalizedTitle,
		),
		index("anime_series_latest_v2_idx").on(
			table.isVisible,
			table.latestEpisodeAt,
			table.updatedAt,
		),
		index("anime_series_title_v2_idx").on(
			table.isVisible,
			table.title,
			table.updatedAt,
		),
		index("anime_series_public_search_v2_idx").on(
			table.isVisible,
			table.normalizedTitle,
		),
		index("anime_series_search_vector_idx").using("gin", table.searchVector),
	],
);

export const animeSeriesGenres = pgTable(
	"anime_series_genres",
	{
		animeId: text("anime_id")
			.notNull()
			.references(() => animeSeries.id, { onDelete: "cascade" }),
		genreKey: text("genre_key").notNull(),
	},
	(table) => [
		uniqueIndex("anime_series_genres_anime_genre_unique").on(
			table.animeId,
			table.genreKey,
		),
		index("anime_series_genres_lookup_idx").on(table.genreKey, table.animeId),
	],
);

export const animeSources = pgTable(
	"anime_sources",
	{
		id: text("id").primaryKey(),
		animeId: text("anime_id")
			.notNull()
			.references(() => animeSeries.id, { onDelete: "cascade" }),
		sourceId: text("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		externalId: text("external_id").notNull(),
		slug: text("slug"),
		sourceUrl: text("source_url"),
		title: text("title").notNull(),
		alternativeTitle: text("alternative_title"),
		posterUrl: text("poster_url"),
		rawPayload: jsonb("raw_payload")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		lastScrapedAt: timestamptz("last_scraped_at"),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("anime_sources_source_external_unique").on(
			table.sourceId,
			table.externalId,
		),
		index("anime_sources_anime_idx").on(table.animeId),
	],
);

export const animeEpisodes = pgTable(
	"anime_episodes",
	{
		id: text("id").primaryKey(),
		animeId: text("anime_id")
			.notNull()
			.references(() => animeSeries.id, { onDelete: "cascade" }),
		normalizedNumber: text("normalized_number").notNull(),
		numberText: text("number_text").notNull(),
		sortNumber: real("sort_number"),
		title: text("title"),
		releasedAt: timestamptz("released_at"),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("anime_episodes_anime_number_unique").on(
			table.animeId,
			table.normalizedNumber,
		),
		index("anime_episodes_anime_recent_v2_idx").on(
			table.animeId,
			table.sortNumber,
			table.updatedAt,
		),
	],
);

export const animeEpisodeSources = pgTable(
	"anime_episode_sources",
	{
		id: text("id").primaryKey(),
		episodeId: text("episode_id")
			.notNull()
			.references(() => animeEpisodes.id, { onDelete: "cascade" }),
		animeSourceId: text("anime_source_id")
			.notNull()
			.references(() => animeSources.id, { onDelete: "cascade" }),
		sourceId: text("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		externalId: text("external_id").notNull(),
		sourceUrl: text("source_url"),
		streamLinksJson: jsonb("stream_links_json")
			.$type<unknown[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		downloadLinksJson: jsonb("download_links_json")
			.$type<unknown[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		rawPayload: jsonb("raw_payload")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		lastScrapedAt: timestamptz("last_scraped_at"),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("anime_episode_sources_source_external_unique").on(
			table.sourceId,
			table.externalId,
		),
		uniqueIndex("anime_episode_sources_anime_source_episode_unique").on(
			table.animeSourceId,
			table.episodeId,
		),
		index("anime_episode_sources_episode_idx").on(table.episodeId),
	],
);

export const animeThumbnails = pgTable(
	"anime_thumbnails",
	{
		id: text("id").primaryKey(),
		animeSourceId: text("anime_source_id")
			.notNull()
			.references(() => animeSources.id, { onDelete: "cascade" }),
		externalUrl: text("external_url").notNull(),
		blobSha256: text("blob_sha256").references(() => imageBlobs.sha256, {
			onDelete: "set null",
		}),
		downloadStatus: text("download_status").notNull().default("remote"),
		lastError: text("last_error"),
		downloadedAt: timestamptz("downloaded_at"),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("anime_thumbnails_source_url_unique").on(
			table.animeSourceId,
			table.externalUrl,
		),
		index("anime_thumbnails_status_idx").on(table.downloadStatus),
	],
);
