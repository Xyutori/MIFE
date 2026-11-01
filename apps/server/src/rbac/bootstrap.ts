import type { Database } from "@SyMi/db";

import { normalizeEmail } from "../auth/email";

/**
 * Promotes the `AUTH_BOOTSTRAP_ADMIN_EMAIL` user to admin when no admin
 * exists yet. Idempotent and safe to call on every startup; it never throws —
 * expected "nothing to do" outcomes are reported via the status string and
 * unexpected database errors (e.g. RBAC tables not migrated yet) are logged
 * as a warning so boot continues.
 *
 * SINGLE CALL SITE (deliberate): `apps/server/src/index.ts` runs this once
 * at startup, before listening. Rationale: it runs outside any request hot
 * path, needs no changes to the Better Auth configuration (`emailAndPassword`
 * stays exactly as-is), and cannot interfere with sign-up/sign-in flows.
 * Limitation: the bootstrap user must have signed up already; the promotion
 * then applies on the next server start. Reuse this same function from a
 * future sign-up hook or CLI instead of adding a second promotion path.
 *
 * ASSUMPTION (DB lane contract): RBAC tables exist with XyMI names
 * (`rbac_user_roles(user_id, role_key, ...)`, `rbac_roles` seeded with the
 * `admin` role). The MIFE Better Auth user table is `user(id, email)`.
 */
export type BootstrapStatus =
	| "promoted"
	| "skipped-no-email"
	| "skipped-admin-exists"
	| "skipped-no-user"
	| "skipped-unavailable";

export async function ensureBootstrapAdmin(
	db: Database,
	bootstrapEmail: string | undefined,
): Promise<BootstrapStatus> {
	if (!bootstrapEmail?.trim()) return "skipped-no-email";

	let email: string;
	try {
		email = normalizeEmail(bootstrapEmail);
	} catch {
		return "skipped-no-email";
	}

	try {
		const admins = await db.$client.query(
			"SELECT user_id FROM rbac_user_roles WHERE role_key = 'admin' LIMIT 1",
		);
		if (admins.rows.length > 0) return "skipped-admin-exists";

		const users = await db.$client.query(
			'SELECT id FROM "user" WHERE lower(email) = $1 LIMIT 2',
			[email],
		);
		if (users.rows.length !== 1) return "skipped-no-user";

		const userId = String((users.rows[0] as { id: unknown }).id);
		await db.$client.query(
			"INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'admin') ON CONFLICT DO NOTHING",
			[userId],
		);
		return "promoted";
	} catch (error) {
		console.warn("Admin bootstrap skipped (database unavailable?)", {
			error: error instanceof Error ? error.message : String(error),
		});
		return "skipped-unavailable";
	}
}
