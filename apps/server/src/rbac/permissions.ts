import type { Database } from "@SyMi/db";

/**
 * Built-in RBAC roles and permissions, adapted from XyMI.
 *
 * ASSUMPTION (DB lane contract): `packages/db` provides the RBAC tables with
 * the SAME table/column names as XyMI — `rbac_roles(key, label, description,
 * is_system, created_at, updated_at)`, `rbac_permissions` (same shape),
 * `rbac_role_permissions(role_key, permission_key)`, and
 * `rbac_user_roles(user_id, role_key, created_at)` — including the seeded
 * `user`/`admin` roles and the full admin grant matrix. This module reaches
 * those tables through parameterized raw SQL on `db.$client` (pg `Pool`) so
 * it does not depend on the Drizzle table objects; verify the names again
 * once the DB lane lands.
 *
 * Only platform-core permissions live here. Feature lanes append their own
 * keys (e.g. `library.manage`) next to these and grant them to `admin`.
 */

export const builtInRoles = [
	{ key: "user", label: "User", description: "Standard application user." },
	{
		key: "admin",
		label: "Admin",
		description: "Administrator with full application access.",
	},
] as const;

export type RoleKey = (typeof builtInRoles)[number]["key"];

export const builtInPermissions = [
	{
		key: "rbac.roles.read",
		label: "View roles",
		description: "View application roles.",
	},
	{
		key: "rbac.roles.manage",
		label: "Manage roles",
		description: "Create, update, and delete application roles.",
	},
	{
		key: "rbac.permissions.read",
		label: "View permissions",
		description: "View application permissions.",
	},
	{
		key: "rbac.permissions.manage",
		label: "Manage permissions",
		description: "Create, update, and delete application permissions.",
	},
	{
		key: "users.read",
		label: "View users",
		description: "View user accounts.",
	},
	{
		key: "users.manage",
		label: "Manage users",
		description: "Change user roles and suspension state.",
	},
	{
		key: "media.read",
		label: "View user media",
		description: "View user-submitted profile and library media.",
	},
	{
		key: "media.manage",
		label: "Manage user media",
		description: "Manage user-submitted profile and library media.",
	},
] as const;

export type PermissionKey = (typeof builtInPermissions)[number]["key"];

export function isAdminRoleKey(role: string | null | undefined): boolean {
	return role === "admin";
}

/**
 * True when the user holds the `admin` role grant in `rbac_user_roles`.
 * Fail-closed: any database error yields `false`.
 */
export async function isAdmin(db: Database, userId: string): Promise<boolean> {
	try {
		const result = await db.$client.query(
			"SELECT 1 AS allowed FROM rbac_user_roles WHERE user_id = $1 AND role_key = 'admin' LIMIT 1",
			[userId],
		);
		return result.rows.length > 0;
	} catch {
		return false;
	}
}

/**
 * True when the user may exercise `permissionKey`. The `admin` role bypasses
 * the grant matrix; every other role is checked against
 * `rbac_role_permissions` on each call. Fail-closed like XyMI.
 */
export async function hasPermission(
	db: Database,
	userId: string,
	permissionKey: string,
): Promise<boolean> {
	try {
		const result = await db.$client.query(
			`SELECT 1 AS allowed
			 FROM rbac_user_roles AS user_role
			 LEFT JOIN rbac_role_permissions AS role_permission
			   ON role_permission.role_key = user_role.role_key
			  AND role_permission.permission_key = $2
			 WHERE user_role.user_id = $1
			   AND (user_role.role_key = 'admin' OR role_permission.permission_key IS NOT NULL)
			 LIMIT 1`,
			[userId, permissionKey],
		);
		return result.rows.length > 0;
	} catch {
		return false;
	}
}

/** Role keys granted to the user in `rbac_user_roles`. Empty on error. */
export async function userRoleKeys(
	db: Database,
	userId: string,
): Promise<string[]> {
	try {
		const result = await db.$client.query(
			"SELECT role_key FROM rbac_user_roles WHERE user_id = $1 ORDER BY role_key",
			[userId],
		);
		return result.rows.map((row) =>
			String((row as { role_key: unknown }).role_key),
		);
	} catch {
		return [];
	}
}
