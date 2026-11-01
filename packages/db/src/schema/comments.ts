/**
 * Comment tables (MVP, no realtime).
 *
 * ## Primary-key / FK decisions
 * - All `id` columns stay `text().primaryKey()` (opaque IDs, same as catalog).
 * - `authorId` / `replyToUserId` / `reporterId` intentionally have NO foreign
 *   key: they store the better-auth `user.id` as opaque text so this module
 *   stays decoupled from the auth adapter (same contract as bookmarks
 *   `userId`). Orphaned rows for deleted users are cleaned app-side.
 * - `targetId` intentionally has NO foreign key: it points at `chapters.id`
 *   (when `targetType = 'comic_chapter'`) or `anime_episodes.id` (when
 *   `targetType = 'anime_episode'`), and the scraper may recreate those rows.
 *   Target existence is validated app-side.
 * - `parentId` / `rootId` / `replyToCommentId` intentionally have NO foreign
 *   key: threading is 1 level only (a reply's `parentId` = `rootId` =
 *   top-level comment id, `replyToCommentId` = the comment being replied to
 *   for display purposes). Deletes are soft (`status` + `deletedAt`), so no
 *   cascade is needed; orphans are resolved app-side.
 * - `comment_reports.commentId` keeps its FK to `comments.id` with cascade
 *   delete so reports disappear with a hard-deleted comment.
 *
 * ## Content / moderation contract
 * - `contentJson` stores the canonical rich-text document (TipTap-style
 *   `CommentDoc`); `plainText` is the searchable/display fallback derived
 *   app-side on every write.
 * - `wordCount` is computed app-side (max 1000 kata); the check constraint
 *   below is a backstop, not the primary enforcement.
 * - `status`: `'active'` (visible), `'hidden'` (moderator-hidden),
 *   `'deleted'` (soft-deleted, row retained for thread shape).
 */

import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

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

/** Minimal TipTap-style document stored in `comments.content_json`. */
export type CommentDoc = {
	type: "doc";
	content: Array<Record<string, unknown>>;
};

export const comments = pgTable(
	"comments",
	{
		id: text("id").primaryKey(),
		targetType: text("target_type").notNull(),
		targetId: text("target_id").notNull(),
		authorId: text("author_id").notNull(),
		// NULL = top-level comment; set = top-level comment id (1-level only).
		parentId: text("parent_id"),
		// NULL = top-level comment; set = top-level comment id.
		rootId: text("root_id"),
		replyToCommentId: text("reply_to_comment_id"),
		replyToUserId: text("reply_to_user_id"),
		contentJson: jsonb("content_json").$type<CommentDoc>().notNull(),
		plainText: text("plain_text").notNull(),
		wordCount: integer("word_count").notNull().default(0),
		hasSpoiler: boolean("has_spoiler").notNull().default(false),
		status: text("status").notNull().default("active"),
		editedAt: timestamptz("edited_at"),
		deletedAt: timestamptz("deleted_at"),
		...timestamps(),
	},
	(table) => [
		check(
			"comments_target_type_check",
			sql`${table.targetType} in ('comic_chapter', 'anime_episode', 'comic_series', 'anime_series')`,
		),
		check(
			"comments_status_check",
			sql`${table.status} in ('active', 'hidden', 'deleted')`,
		),
		check(
			"comments_word_count_check",
			sql`${table.wordCount} >= 0 AND ${table.wordCount} <= 1000`,
		),
		index("comments_target_created_idx").on(
			table.targetType,
			table.targetId,
			table.createdAt,
		),
		index("comments_parent_created_idx").on(table.parentId, table.createdAt),
		index("comments_author_created_idx").on(table.authorId, table.createdAt),
	],
);

export const commentReports = pgTable(
	"comment_reports",
	{
		id: text("id").primaryKey(),
		commentId: text("comment_id")
			.notNull()
			.references(() => comments.id, { onDelete: "cascade" }),
		reporterId: text("reporter_id").notNull(),
		reason: text("reason").notNull(),
		details: text("details"),
		status: text("status").notNull().default("open"),
		...timestamps(),
	},
	(table) => [
		check(
			"comment_reports_status_check",
			sql`${table.status} in ('open', 'resolved', 'dismissed')`,
		),
		index("comment_reports_comment_created_idx").on(
			table.commentId,
			table.createdAt,
		),
	],
);
