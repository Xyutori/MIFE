import { series, sources } from "@SyMi/db/schema/index";
import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { invalidateCache } from "../cache/index";
import { db } from "../services";

const sourcePatchBody = t.Object({
	baseUrl: t.Optional(t.String()),
	prefix: t.Optional(t.String()),
	requestDelayMs: t.Optional(t.Number()),
	enabled: t.Optional(t.Boolean()),
});

type SourcePatch = {
	baseUrl?: string;
	prefix?: string;
	requestDelayMs?: number;
	enabled?: boolean;
};

function parseConfig(value: unknown): unknown {
	if (typeof value === "string") {
		try {
			return JSON.parse(value) as unknown;
		} catch {
			return {};
		}
	}
	return value ?? {};
}

function buildSourcePatch(
	body: SourcePatch,
): Partial<typeof sources.$inferInsert> | { error: string } {
	const patch: Partial<typeof sources.$inferInsert> = {};
	if (body.baseUrl !== undefined) {
		const baseUrl = body.baseUrl.trim();
		if (!/^https?:\/\//i.test(baseUrl))
			return { error: "baseUrl harus diawali http:// atau https://" };
		patch.baseUrl = baseUrl;
	}
	if (body.prefix !== undefined) patch.prefix = body.prefix;
	if (body.requestDelayMs !== undefined)
		patch.requestDelayMs = Math.min(
			60000,
			Math.max(0, Math.round(body.requestDelayMs)),
		);
	if (body.enabled !== undefined) patch.enabled = body.enabled;
	return patch;
}

/**
 * Local query functions: routes validate + map to HTTP, queries live here.
 * Response shapes are kept as the admin panels consume them —
 * `ComicLibraryPanel` reads `{ id, isVisible }`, `SourcesPanel` /
 * `ScrapeSchedulePanel` read `{ id, key, name, baseUrl, prefix,
 * requestDelayMs, enabled }` plus parsed `config` (see
 * `apps/web/src/lib/components/admin/`).
 */
async function setSeriesVisibility(id: string, isVisible: boolean) {
	const rows = await db
		.update(series)
		.set({ isVisible, updatedAt: new Date() })
		.where(eq(series.id, id))
		.returning({
			id: series.id,
			isVisible: series.isVisible,
			workspaceId: series.workspaceId,
		});
	return rows[0] ?? null;
}

async function patchSourceById(
	id: string,
	patch: Partial<typeof sources.$inferInsert>,
) {
	const rows = await db
		.update(sources)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(sources.id, id))
		.returning();
	return rows[0] ?? null;
}

async function patchAnimeSourceById(
	id: string,
	patch: Partial<typeof sources.$inferInsert>,
) {
	const rows = await db
		.update(sources)
		.set({ ...patch, updatedAt: new Date() })
		.where(and(eq(sources.id, id), eq(sources.workspaceId, "anime")))
		.returning();
	return rows[0] ?? null;
}

export const libraryAdminRoutes = new Elysia({ name: "library-admin-routes" })
	.patch(
		"/api/admin/library/:id",
		async ({ params, body, set }) => {
			const row = await setSeriesVisibility(params.id, body.isVisible);
			if (!row) {
				set.status = 404;
				return { error: "Komik tidak ditemukan" };
			}
			await invalidateCache(`${row.workspaceId}:`);
			return { id: row.id, isVisible: row.isVisible };
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({ isVisible: t.Boolean() }),
		},
	)
	.patch(
		"/api/admin/sources/:id",
		async ({ params, body, set }) => {
			const patch = buildSourcePatch(body);
			if ("error" in patch) {
				set.status = 400;
				return { error: patch.error };
			}
			const row = await patchSourceById(params.id, patch);
			if (!row) {
				set.status = 404;
				return { error: "Sumber tidak ditemukan" };
			}
			return { ...row, config: parseConfig(row.configJson) };
		},
		{ params: t.Object({ id: t.String() }), body: sourcePatchBody },
	)
	.patch(
		"/api/admin/anime/sources/:id",
		async ({ params, body, set }) => {
			const patch = buildSourcePatch(body);
			if ("error" in patch) {
				set.status = 400;
				return { error: patch.error };
			}
			const row = await patchAnimeSourceById(params.id, patch);
			if (!row) {
				set.status = 404;
				return { error: "Sumber anime tidak ditemukan" };
			}
			return {
				...row,
				supported: true,
				config: parseConfig(row.configJson),
			};
		},
		{ params: t.Object({ id: t.String() }), body: sourcePatchBody },
	);
