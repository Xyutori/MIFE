/**
 * Bookmark tables, ported from XyMI `packages/db/src/schema/bookmarks.ts`.
 *
 * ## Primary-key / FK decisions
 * - All `id` columns stay `text().primaryKey()` (original IDs preserved).
 * - `groupId` / `seriesId` / `animeId` keep their FKs to the catalog tables so
 *   cascade deletes still clean up entries when a series/group disappears.
 * - `userId` intentionally has NO foreign key, mirroring XyMI: it stores the
 *   better-auth `user.id` as opaque text so this module stays decoupled from
 *   the auth adapter. Orphaned groups for deleted users are cleaned app-side.
 * - The `defaultKey` partial-unique semantics carry over for free: Postgres,
 *   like SQLite, treats NULLs as distinct in unique indexes, so only rows with
 *   `default_key = 'default'` are deduplicated per `(user_id, media_type)`.
 */

import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { animeSeries } from "./anime";
import { series } from "./catalog";

const timestamps = () => ({
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

/** A user's saved collection. `mediaType` keeps comic and anime distinct. */
export const bookmarkGroups = pgTable(
	"bookmark_groups",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		mediaType: text("media_type").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		normalizedName: text("normalized_name").notNull(),
		// Only the per-type default group stores "default"; NULLs stay distinct.
		defaultKey: text("default_key"),
		customCoverUrl: text("custom_cover_url"),
		orderIndex: integer("order_index").notNull().default(0),
		...timestamps(),
	},
	(table) => [
		check(
			"bookmark_groups_media_type_check",
			sql`${table.mediaType} in ('comic', 'anime')`,
		),
		uniqueIndex("bookmark_groups_owner_type_name_unique").on(
			table.userId,
			table.mediaType,
			table.normalizedName,
		),
		uniqueIndex("bookmark_groups_default_unique").on(
			table.userId,
			table.mediaType,
			table.defaultKey,
		),
		index("bookmark_groups_owner_type_order_idx").on(
			table.userId,
			table.mediaType,
			table.orderIndex,
		),
	],
);

/** Comic bookmarks reference whole series, never chapters. */
export const comicBookmarkEntries = pgTable(
	"comic_bookmark_entries",
	{
		id: text("id").primaryKey(),
		groupId: text("group_id")
			.notNull()
			.references(() => bookmarkGroups.id, { onDelete: "cascade" }),
		seriesId: text("series_id")
			.notNull()
			.references(() => series.id, { onDelete: "cascade" }),
		orderIndex: integer("order_index").notNull().default(0),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("comic_bookmark_entries_group_series_unique").on(
			table.groupId,
			table.seriesId,
		),
		index("comic_bookmark_entries_group_order_idx").on(
			table.groupId,
			table.orderIndex,
			table.createdAt,
		),
	],
);

/** Anime bookmarks reference whole anime series, never episodes. */
export const animeBookmarkEntries = pgTable(
	"anime_bookmark_entries",
	{
		id: text("id").primaryKey(),
		groupId: text("group_id")
			.notNull()
			.references(() => bookmarkGroups.id, { onDelete: "cascade" }),
		animeId: text("anime_id")
			.notNull()
			.references(() => animeSeries.id, { onDelete: "cascade" }),
		orderIndex: integer("order_index").notNull().default(0),
		...timestamps(),
	},
	(table) => [
		uniqueIndex("anime_bookmark_entries_group_anime_unique").on(
			table.groupId,
			table.animeId,
		),
		index("anime_bookmark_entries_group_order_idx").on(
			table.groupId,
			table.orderIndex,
			table.createdAt,
		),
	],
);
