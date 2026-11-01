import type { Database } from "@SyMi/db";

import { builtInPermissions, builtInRoles } from "./permissions";

/**
 * Seed the RBAC catalog: upsert every built-in role and permission, then
 * grant the full permission set to the `admin` role. Idempotent and safe to
 * run on every server start; never throws — a missing/unmigrated table only
 * produces a warning so boot continues.
 *
 * Mirrors the XyMI startup seeding (`create and seed RBAC storage` in
 * `XyMI/apps/server/src/rbac/storage.ts`): XyMI used `INSERT OR IGNORE` for
 * roles/permissions plus one `INSERT OR IGNORE` grant row per permission for
 * `admin`. The pg equivalent here is `ON CONFLICT DO NOTHING` (no conflict
 * target, so it works regardless of the constraint/index names the DB lane
 * chooses).
 *
 * MUST run before `ensureBootstrapAdmin`: the bootstrap inserts into
 * `rbac_user_roles`, whose `role_key` FK requires the seeded `admin` role.
 *
 * ASSUMPTION (DB lane contract): tables/columns keep the XyMI names —
 * `rbac_roles(key, label, description, is_system, ...)`,
 * `rbac_permissions` (same shape),
 * `rbac_role_permissions(role_key, permission_key)` — with `is_system` as a
 * pg boolean. Verify once the DB lane lands.
 */
export async function ensureRbacSeed(db: Database): Promise<void> {
	try {
		for (const role of builtInRoles) {
			await db.$client.query(
				"INSERT INTO rbac_roles (key, label, description, is_system) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
				[role.key, role.label, role.description, true],
			);
		}
		for (const permission of builtInPermissions) {
			await db.$client.query(
				"INSERT INTO rbac_permissions (key, label, description, is_system) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
				[permission.key, permission.label, permission.description, true],
			);
			await db.$client.query(
				"INSERT INTO rbac_role_permissions (role_key, permission_key) VALUES ('admin', $1) ON CONFLICT DO NOTHING",
				[permission.key],
			);
		}
	} catch (error) {
		console.warn("RBAC seed skipped (database unavailable?)", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
