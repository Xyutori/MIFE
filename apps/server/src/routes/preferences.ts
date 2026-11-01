/**
 * User preferences (reader/catalog settings).
 *
 * XyMI had no HTTP preferences route — preferences were read/written
 * internally by the settings endpoints (`readPreferences`/`writePreferences`
 * in `apps/server/src/preferences.ts`). MIFE exposes them explicitly so old
 * and new clients share one contract:
 * - `GET /api/v1/preferences?keys=a,b` -> `{ values: { a: ..., b: ... } }`
 * - `PUT /api/v1/preferences` `{ values: { a: ... } }` -> `{ values }`
 *
 * Semantics: last-write-wins per `(userId, key)` via upsert, values stored
 * as JSON text (same encoding as XyMI). Both endpoints require a Better Auth
 * session (explicit 401). Unknown keys are accepted and echoed back.
 */

import { userPreferences } from "@SyMi/db/schema/index";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { auth, db } from "../services";

function decode(value: string) {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

async function resolveUserId(request: Request): Promise<string | null> {
	try {
		const session = await auth.api.getSession({ headers: request.headers });
		const id = session?.user?.id;
		return typeof id === "string" && id.length > 0 ? id : null;
	} catch {
		return null;
	}
}

async function readPreferences(userId: string, keys: string[]) {
	if (keys.length === 0) return {};
	const rows = await db
		.select({ key: userPreferences.key, value: userPreferences.value })
		.from(userPreferences)
		.where(
			and(
				eq(userPreferences.userId, userId),
				inArray(userPreferences.key, keys),
			),
		);
	return Object.fromEntries(
		rows.map((row) => [row.key, decode(row.value)]),
	) as Record<string, unknown>;
}

async function writePreferences(
	userId: string,
	values: Record<string, unknown>,
) {
	const entries = Object.entries(values);
	if (entries.length === 0) return;
	const now = new Date();
	// Single multi-row upsert: per-row values come from `excluded`, so one
	// statement handles any number of keys (no N-query loop).
	await db
		.insert(userPreferences)
		.values(
			entries.map(([key, value]) => ({
				id: crypto.randomUUID(),
				userId,
				key,
				value: JSON.stringify(value),
				updatedAt: now,
			})),
		)
		.onConflictDoUpdate({
			target: [userPreferences.userId, userPreferences.key],
			set: { value: sql`excluded."value"`, updatedAt: now },
		});
}

function requireKeys(query: string | undefined) {
	return (query ?? "")
		.split(",")
		.map((key) => key.trim())
		.filter((key) => key.length > 0)
		.slice(0, 100);
}

export const preferenceRoutes = new Elysia({ name: "preference-routes" })
	.get(
		"/api/v1/preferences",
		async ({ query, request, set }) => {
			const userId = await resolveUserId(request);
			if (!userId) {
				set.status = 401;
				return { error: "Autentikasi diperlukan" };
			}
			const keys = requireKeys(query.keys);
			return { values: await readPreferences(userId, keys) };
		},
		{ query: t.Object({ keys: t.Optional(t.String()) }) },
	)
	.put(
		"/api/v1/preferences",
		async ({ body, request, set }) => {
			const userId = await resolveUserId(request);
			if (!userId) {
				set.status = 401;
				return { error: "Autentikasi diperlukan" };
			}
			const values =
				body.values && typeof body.values === "object" ? body.values : {};
			await writePreferences(userId, values as Record<string, unknown>);
			return {
				values: await readPreferences(userId, Object.keys(values)),
			};
		},
		{
			body: t.Object({
				values: t.Record(t.String(), t.Unknown()),
			}),
		},
	);
