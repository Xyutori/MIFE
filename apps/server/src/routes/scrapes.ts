import {
	animeSeries,
	animeThumbnails,
	mediaAssets,
	scrapeEvents,
	scrapeRuns,
	series,
	sourceScrapeState,
	sources,
} from "@SyMi/db/schema/index";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
	resumeAnimeScrape,
	retryAnimeScrape,
	startAnimeScrapes,
} from "../jobs/anime";
import { addRunEvent, readJsonObject } from "../jobs/common";
import { interruptRunRequests } from "../jobs/control";
import {
	resumeImageRun as resumeImages,
	retryImageRun as retryImages,
	startImageDownload,
} from "../jobs/images";
import {
	resumeMetadataRun as resumeMetadata,
	retryMetadataRun as retryMetadata,
	startMetadataScrapes,
} from "../jobs/metadata";
import {
	getScrapeSettings,
	listEditableScrapeSources,
	SCRAPE_SETTING_KEYS,
	saveScrapeSettings,
	validateScrapeSettingsPatch,
} from "../scrape-settings";
import { db } from "../services";

type ScrapeRow = typeof scrapeRuns.$inferSelect;

function parseJson(value: unknown) {
	return readJsonObject(value);
}

async function getRun(id: string, workspace?: string) {
	const rows = await db
		.select()
		.from(scrapeRuns)
		.where(
			workspace
				? and(eq(scrapeRuns.id, id), eq(scrapeRuns.workspaceId, workspace))
				: eq(scrapeRuns.id, id),
		)
		.limit(1);
	return rows[0] ?? null;
}

async function pauseRun(run: ScrapeRow) {
	const finishedAt = new Date();
	const rows = await db
		.update(scrapeRuns)
		.set({
			status: "paused",
			workerToken: null,
			workerLeaseExpiresAt: null,
			currentStep: "Dijeda oleh pengguna",
			updatedAt: finishedAt,
		})
		.where(
			and(
				eq(scrapeRuns.id, run.id),
				inArray(scrapeRuns.status, ["queued", "running"]),
			),
		)
		.returning();
	if (!rows[0]) return null;
	interruptRunRequests(run.id, "Scrape dijeda oleh pengguna");
	await addRunEvent(run.id, "Scrape dijeda oleh pengguna", {
		level: "warning",
	});
	return rows[0];
}

async function cancelRun(run: ScrapeRow) {
	const finishedAt = new Date();
	const rows = await db
		.update(scrapeRuns)
		.set({
			status: "cancelled",
			jobKey: null,
			workerToken: null,
			workerLeaseExpiresAt: null,
			finishedAt,
			currentStep: "Dibatalkan oleh pengguna",
			errorMessage: null,
			updatedAt: finishedAt,
		})
		.where(
			and(
				eq(scrapeRuns.id, run.id),
				inArray(scrapeRuns.status, ["queued", "running", "paused"]),
			),
		)
		.returning();
	if (!rows[0]) return null;
	interruptRunRequests(run.id, "Scrape dibatalkan oleh pengguna");
	await addRunEvent(run.id, "Scrape dibatalkan oleh pengguna", {
		level: "warning",
	});
	return rows[0];
}

function isImageRun(run: ScrapeRow) {
	return run.kind === "images";
}

function isAnimeRun(run: ScrapeRow) {
	// Anime image-run (kind=images, sourceId=null) memakai workspace "anime"
	// tapi harus ditangani handler images; cek kind dulu sebelum workspace.
	return run.workspaceId === "anime" && run.kind !== "images";
}

export const scrapesRoutes = new Elysia({ name: "scrapes-routes" })
	.get(
		"/api/admin/scrapes",
		async ({ query }) => {
			const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
			const conditions = [];
			if (query.workspace)
				conditions.push(eq(scrapeRuns.workspaceId, query.workspace));
			if (query.status) conditions.push(eq(scrapeRuns.status, query.status));
			if (query.kind) conditions.push(eq(scrapeRuns.kind, query.kind));
			const rows = await db
				.select({
					run: scrapeRuns,
					sourceName: sources.name,
					sourceKey: sources.key,
				})
				.from(scrapeRuns)
				.leftJoin(sources, eq(scrapeRuns.sourceId, sources.id))
				.where(conditions.length > 0 ? and(...conditions) : undefined)
				.orderBy(desc(scrapeRuns.createdAt))
				.limit(limit);
			const total = await db
				.select({ id: scrapeRuns.id })
				.from(scrapeRuns)
				.where(conditions.length > 0 ? and(...conditions) : undefined);
			// Enriched overview for the admin panels (`ComicScrapePanel`,
			// `ScrapeRunsPanel`, `SuperKomikJobsPanel`): `{runs,total}` stays
			// untouched for compatibility; the extra keys are honest counts
			// from existing tables (null/[] when a metric is unavailable or
			// the workspace is unscoped — panels already `?? null/[]`).
			const workspaceScope = query.workspace
				? eq(scrapeRuns.workspaceId, query.workspace)
				: undefined;
			const [activeRows, sourceRows, titleRows, pendingRows] =
				await Promise.all([
					db
						.select({ count: count() })
						.from(scrapeRuns)
						.where(
							workspaceScope
								? and(
										workspaceScope,
										inArray(scrapeRuns.status, ["queued", "running", "paused"]),
									)
								: inArray(scrapeRuns.status, ["queued", "running", "paused"]),
						),
					db
						.select({
							id: sources.id,
							key: sources.key,
							name: sources.name,
							enabled: sources.enabled,
							lastFullAt: sourceScrapeState.lastFullAt,
							lastSuccessAt: sourceScrapeState.lastSuccessAt,
							lastAttemptAt: sourceScrapeState.lastAttemptAt,
						})
						.from(sources)
						.leftJoin(
							sourceScrapeState,
							eq(sourceScrapeState.sourceId, sources.id),
						)
						.where(
							query.workspace
								? eq(sources.workspaceId, query.workspace)
								: undefined,
						)
						.orderBy(asc(sources.key)),
					query.workspace === "anime"
						? db.select({ count: count() }).from(animeSeries)
						: query.workspace
							? db
									.select({ count: count() })
									.from(series)
									.where(eq(series.workspaceId, query.workspace))
							: Promise.resolve([{ count: 0 }]),
					query.workspace === "anime"
						? db
								.select({ count: count() })
								.from(animeThumbnails)
								.where(ne(animeThumbnails.downloadStatus, "saved"))
						: query.workspace
							? db
									.select({ count: count() })
									.from(mediaAssets)
									.innerJoin(sources, eq(mediaAssets.sourceId, sources.id))
									.where(
										and(
											eq(sources.workspaceId, query.workspace),
											ne(mediaAssets.downloadStatus, "saved"),
										),
									)
							: Promise.resolve([{ count: 0 }]),
				]);
			const toIso = (value: Date | null | undefined) =>
				value instanceof Date ? value.toISOString() : null;
			return {
				runs: rows.map((row) => ({
					...row.run,
					sourceName: row.sourceName,
					sourceKey: row.sourceKey,
					summary: parseJson(row.run.summaryJson),
				})),
				total: total.length,
				activeRunCount: activeRows[0]?.count ?? 0,
				totalTitles: query.workspace ? (titleRows[0]?.count ?? 0) : null,
				pendingImages: query.workspace ? (pendingRows[0]?.count ?? 0) : null,
				pendingThumbnails: query.workspace
					? (pendingRows[0]?.count ?? 0)
					: null,
				mediaSummary: null,
				sources: sourceRows.map((source) => ({
					id: source.id,
					key: source.key,
					name: source.name,
					sourceKey: source.key,
					sourceName: source.name,
					enabled: source.enabled,
					lastFullAt: toIso(source.lastFullAt),
					lastSuccessAt: toIso(source.lastSuccessAt),
					lastAttemptAt: toIso(source.lastAttemptAt),
				})),
			};
		},
		{
			query: t.Object({
				workspace: t.Optional(t.String()),
				status: t.Optional(t.String()),
				kind: t.Optional(t.String()),
				limit: t.Optional(t.Number()),
			}),
		},
	)
	.post(
		"/api/admin/scrapes",
		async ({ body }) => {
			const workspace = body.workspace ?? "comic";
			if (workspace === "anime") {
				const runs = await startAnimeScrapes("manual");
				return { runs };
			}
			const runs = await startMetadataScrapes(
				body.mode ?? "incremental",
				"manual",
				workspace,
			);
			return { runs };
		},
		{
			body: t.Object({
				mode: t.Optional(
					t.Union([t.Literal("full"), t.Literal("incremental")]),
				),
				workspace: t.Optional(t.String()),
			}),
		},
	)
	.post(
		"/api/admin/scrapes/images-download",
		async ({ body }) => {
			const run = await startImageDownload(
				{
					seriesId: body.seriesId,
					chapterId: body.chapterId,
					sourceKey: body.sourceKey,
				},
				{
					workspaceId: body.workspace ?? "comic",
					verifyAll: body.verifyAll ?? false,
				},
			);
			return { run };
		},
		{
			body: t.Object({
				seriesId: t.Optional(t.String()),
				chapterId: t.Optional(t.String()),
				sourceKey: t.Optional(t.String()),
				workspace: t.Optional(t.String()),
				verifyAll: t.Optional(t.Boolean()),
			}),
		},
	)
	.get(
		"/api/admin/scrapes/:id",
		async ({ params, set }) => {
			const run = await getRun(params.id);
			if (!run) {
				set.status = 404;
				return { error: "Scrape run tidak ditemukan" };
			}
			const events = await db
				.select()
				.from(scrapeEvents)
				.where(eq(scrapeEvents.runId, params.id))
				.orderBy(desc(scrapeEvents.createdAt))
				.limit(100);
			return {
				...run,
				summary: parseJson(run.summaryJson),
				events: events.reverse().map((event) => ({
					...event,
					details: parseJson(event.detailsJson),
				})),
			};
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.post(
		"/api/admin/scrapes/:id/pause",
		async ({ params, set }) => {
			const run = await getRun(params.id);
			if (!run) {
				set.status = 404;
				return { error: "Scrape run tidak ditemukan" };
			}
			const paused = await pauseRun(run);
			if (!paused) {
				set.status = 409;
				return { error: `Run tidak dapat dijeda dengan status ${run.status}` };
			}
			return paused;
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.post(
		"/api/admin/scrapes/:id/resume",
		async ({ params, set }) => {
			const run = await getRun(params.id);
			if (!run) {
				set.status = 404;
				return { error: "Scrape run tidak ditemukan" };
			}
			try {
				const resumed = isImageRun(run)
					? await resumeImages(params.id)
					: isAnimeRun(run)
						? await resumeAnimeScrape(params.id)
						: await resumeMetadata(params.id);
				await addRunEvent(
					params.id,
					"Scrape dilanjutkan; data tersimpan diperiksa ulang",
					{ level: "info" },
				);
				return resumed;
			} catch (error) {
				set.status = 409;
				return {
					error:
						error instanceof Error
							? error.message
							: "Run tidak dapat dilanjutkan",
				};
			}
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.post(
		"/api/admin/scrapes/:id/cancel",
		async ({ params, set }) => {
			const run = await getRun(params.id);
			if (!run) {
				set.status = 404;
				return { error: "Scrape run tidak ditemukan" };
			}
			const cancelled = await cancelRun(run);
			if (!cancelled) {
				set.status = 409;
				return {
					error: `Run tidak dapat dibatalkan dengan status ${run.status}`,
				};
			}
			return cancelled;
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.post(
		"/api/admin/scrapes/:id/retry",
		async ({ params, set }) => {
			const run = await getRun(params.id);
			if (!run) {
				set.status = 404;
				return { error: "Scrape run tidak ditemukan" };
			}
			try {
				const retried = isImageRun(run)
					? await retryImages(params.id)
					: isAnimeRun(run)
						? await retryAnimeScrape(params.id)
						: await retryMetadata(params.id);
				await addRunEvent(
					params.id,
					`Retry dimulai sebagai run ${retried.id}`,
					{
						level: "info",
					},
				);
				return { run: retried };
			} catch (error) {
				set.status = 409;
				return {
					error:
						error instanceof Error
							? error.message
							: "Run tidak dapat dicoba ulang",
				};
			}
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get("/api/admin/scrape-settings", async () => {
		const [{ values, sources }, editableSources] = await Promise.all([
			getScrapeSettings(),
			listEditableScrapeSources(),
		]);
		return {
			values,
			sources,
			validKeys: [...SCRAPE_SETTING_KEYS],
			editableSources,
		};
	})
	.put(
		"/api/admin/scrape-settings",
		async ({ body, set }) => {
			const validated = validateScrapeSettingsPatch(body);
			if (!validated.ok) {
				set.status = 400;
				return { error: validated.error };
			}
			await saveScrapeSettings(validated.patch);
			const [{ values, sources }, editableSources] = await Promise.all([
				getScrapeSettings(),
				listEditableScrapeSources(),
			]);
			return {
				values,
				sources,
				validKeys: [...SCRAPE_SETTING_KEYS],
				editableSources,
			};
		},
		{ body: t.Record(t.String(), t.Unknown()) },
	);
