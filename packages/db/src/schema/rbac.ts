/**
 * RBAC + user-uploaded media tables, ported from XyMI
 * `packages/db/src/schema/rbac.ts`.
 *
 * ## Primary-key / FK decisions
 * - `rbac_roles.key` and `rbac_permissions.key` stay `text().primaryKey()`;
 *   permission/role keys are stable slugs referenced by code, so keeping them
 *   as the PK avoids a surrogate nobody would join on.
 * - Join tables (`rbac_role_permissions`, `rbac_user_roles`) keep the XyMI
 *   shape: no surrogate PK, uniqueness via unique indexes. Note
 *   `rbac_user_roles_single_role_idx` on `(user_id)` is intentional: it
 *   enforces a single role per user at the DB level.
 * - `userId` / `ownerUserId` intentionally have NO foreign key, mirroring
 *   XyMI: they store the better-auth `user.id` as opaque text so this module
 *   stays decoupled from the auth adapter.
 * - `media_type` stays `text` + CHECK (not `pgEnum`) so new upload kinds can
 *   be added without a type-migration; the allowed set is the XyMI one.
 */

import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = () => ({
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

/** Database-backed application roles. */
export const rbacRoles = pgTable(
	"rbac_roles",
	{
		key: text("key").primaryKey(),
		label: text("label").notNull(),
		description: text("description"),
		isSystem: boolean("is_system").notNull().default(false),
		...timestamps(),
	},
	(table) => [uniqueIndex("rbac_roles_label_unique").on(table.label)],
);

export const rbacPermissions = pgTable(
	"rbac_permissions",
	{
		key: text("key").primaryKey(),
		label: text("label").notNull(),
		description: text("description"),
		isSystem: boolean("is_system").notNull().default(false),
		...timestamps(),
	},
	(table) => [uniqueIndex("rbac_permissions_label_unique").on(table.label)],
);

export const rbacRolePermissions = pgTable(
	"rbac_role_permissions",
	{
		roleKey: text("role_key")
			.notNull()
			.references(() => rbacRoles.key, { onDelete: "cascade" }),
		permissionKey: text("permission_key")
			.notNull()
			.references(() => rbacPermissions.key, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("rbac_role_permissions_unique").on(
			table.roleKey,
			table.permissionKey,
		),
		index("rbac_role_permissions_permission_idx").on(table.permissionKey),
	],
);

export const rbacUserRoles = pgTable(
	"rbac_user_roles",
	{
		userId: text("user_id").notNull(),
		roleKey: text("role_key")
			.notNull()
			.references(() => rbacRoles.key, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("rbac_user_roles_unique").on(table.userId, table.roleKey),
		uniqueIndex("rbac_user_roles_single_role_idx").on(table.userId),
		index("rbac_user_roles_role_idx").on(table.roleKey, table.userId),
	],
);

/** User-uploaded media is kept out of scraper inventory tables. */
export const userMedia = pgTable(
	"user_media",
	{
		id: text("id").primaryKey(),
		ownerUserId: text("owner_user_id").notNull(),
		mediaType: text("media_type").notNull(),
		ownerId: text("owner_id").notNull(),
		objectKey: text("object_key").notNull(),
		contentType: text("content_type").notNull(),
		byteSize: integer("byte_size").notNull(),
		sha256: text("sha256").notNull(),
		...timestamps(),
	},
	(table) => [
		check(
			"user_media_type_check",
			sql`${table.mediaType} in ('profile_avatar', 'profile_header', 'bookmark_group_cover')`,
		),
		uniqueIndex("user_media_owner_type_owner_unique").on(
			table.ownerUserId,
			table.mediaType,
			table.ownerId,
		),
		uniqueIndex("user_media_object_key_unique").on(table.objectKey),
		index("user_media_type_created_idx").on(table.mediaType, table.createdAt),
		index("user_media_owner_idx").on(table.ownerUserId, table.mediaType),
	],
);
