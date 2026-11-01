/**
 * Reader/catalog preferences, ported from XyMI
 * `packages/db/src/schema/user-preferences.ts`.
 *
 * ## FK decision
 * XyMI referenced its own `auth_users.id`. The MIFE equivalent is the
 * better-auth `user.id` (see `auth.ts`, which must stay untouched), so
 * `userId` has a FK to `user.id` with `onDelete: "cascade"`: deleting a user
 * removes their preferences, same cascade contract as XyMI.
 * Personal reader settings stay separated by owner + feature key via the
 * `(user_id, key)` unique index.
 */

import {
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/** Personal reader/catalog settings, separated by owner and feature key. */
export const userPreferences = pgTable(
	"user_preferences",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		value: text("value").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("user_preferences_owner_key_unique").on(
			table.userId,
			table.key,
		),
		index("user_preferences_owner_idx").on(table.userId),
	],
);
