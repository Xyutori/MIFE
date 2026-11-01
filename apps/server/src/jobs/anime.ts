import {
	animeEpisodeSources,
	animeEpisodes,
	animeSeries,
	animeSources,
	animeThumbnails,
	scrapeRuns,
	sourceScrapeState,
	sources,
} from "@SyMi/db/schema/index";
import { and, eq, sql } from "drizzle-orm";
import { invalidateCache } from "../cache/index";
import { animeThumbnailObjectKey } from "../media/object-keys";
import { db } from "../services";
import type { SourceConfig } from "../sources/types";
import {
	batches,
	getScrapeBatchConcurrency,
	getScrapeBatchSize,
	withConcurrency,
} from "./batches";
import {
	addRunEvent,
	beginRun,
	finishRun,
	now,
	readJsonObject,
	updateRun,
} from "./common";
import {
	clearRetryNotice,
	isRunControlError,
	waitForRunResume,
} from "./control";
import { downloadUrlToBlob } from "./images";
import {
	type DueSlot,
	isSourceDueForSlot,
	todayInZone,
} from "./schedule-slots";
import { normalizeTitle } from "./store";
import {
	claimRunWorkerToken,
	currentRunWorkerLease,
	releaseRunWorker,
	withRunWorkerLease,
} from "./worker-lease";

export const ANIME_WORKSPACE_ID = "anime";
const PAGE_SIZE = 24;
const activeRuns = new Set<string>();

export type AnimeListItem = {
	title: string;
	externalId: string;
	slug: string | null;
	sourceUrl: string | null;
	posterUrl: string | null;
	latestEpisodeNumber: string | null;
	sourceUpdatedAt: string | null;
	raw: unknown;
};

export type AnimeEpisodeItem = {
	externalId: string;
	numberText: string;
	title: string | null;
	sourceUrl: string | null;
	releasedAt: string | null;
	raw: unknown;
};

export type AnimeDetails = {
	title: string;
	alternativeTitle: string | null;
	synopsis: string | null;
	status: string | null;
	score: number | null;
	episodeCount: number | null;
	animeType: string | null;
	studio: string | null;
	genres: string[];
	posterUrl: string | null;
	episodes: AnimeEpisodeItem[];
	raw: unknown;
};

export interface AnimeSourceAdapter {
	listAnime(
		source: SourceConfig,
		options: { page: number; pageSize: number },
	): Promise<{
		items: AnimeListItem[];
		totalPages: number;
		totalRecords: number;
	}>;
	getDetails(source: SourceConfig, item: AnimeListItem): Promise<AnimeDetails>;
}

const animeAdapters = new Map<string, AnimeSourceAdapter>();

/**
 * Register a site adapter for an anime source key (e.g. `otakudesu`).
 * Site parsers live outside the scrape lane; without a registered adapter
 * the scheduler skips the source and records a warning event.
 */
export function registerAnimeAdapter(key: string, adapter: AnimeSourceAdapter) {
	animeAdapters.set(key, adapter);
}

function animeAdapterFor(key: string) {
	return animeAdapters.get(key) ?? null;
}

function sourceConfig(
	row: typeof sources.$inferSelect,
	runId?: string,
): SourceConfig {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		key: row.key,
		name: row.name,
		baseUrl: row.baseUrl,
		prefix: row.prefix,
		requestDelayMs: row.requestDelayMs,
		runId,
	};
}

function toDate(value: unknown): Date | null {
	if (value instanceof Date)
		return Number.isNaN(value.getTime()) ? null : value;
	if (typeof value === "string" && value.trim()) {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}
	return null;
}

function normalizeEpisodeNumber(value: string) {
	const clean = value.trim().replace(",", ".");
	const numeric = Number(clean);
	return Number.isFinite(numeric)
		? String(numeric)
		: clean.toLocaleLowerCase("id-ID");
}

function episodeSortNumber(value: string) {
	const numeric = Number(value.trim().replace(",", "."));
	return Number.isFinite(numeric) ? numeric : null;
}

function rawObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

type AnimeListSnapshot = {
	externalId: string;
	title: string | null;
	posterUrl: string | null;
	latestEpisodeNumber: string | null;
	latestEpisodeAt: Date | null;
};

/**
 * Watermark incremental ala komik untuk anime: lewati getDetails bila
 * snapshot daftar sama persis dengan DB. Keterbatasan yang didokumentasikan:
 * adapter list (mis. otakudesu) tetap mengunduh SELURUH /anime-list/ lalu
 * slice per halaman — biaya list tidak bisa dihindari tanpa mengubah adapter
 * (di luar cakupan lane ini). Penghematan nyata ada di detail-page fetch +
 * download poster yang dilewati untuk entri tak berubah.
 */
function isAnimeListItemUnchanged(
	known: AnimeListSnapshot,
	item: AnimeListItem,
) {
	if (
		(known.latestEpisodeNumber ?? null) !== (item.latestEpisodeNumber ?? null)
	)
		return false;
	if ((known.posterUrl ?? null) !== (item.posterUrl ?? null)) return false;
	if ((known.title ?? "") !== (item.title || "")) return false;
	const knownAt =
		known.latestEpisodeAt instanceof Date
			? known.latestEpisodeAt.getTime()
			: Number.NaN;
	const itemAt = item.sourceUpdatedAt
		? Date.parse(item.sourceUpdatedAt)
		: Number.NaN;
	if (Number.isFinite(itemAt) || Number.isFinite(knownAt))
		return itemAt === knownAt;
	return true;
}

async function refreshAnimeSearchVector(animeId: string) {
	await db.execute(
		sql`UPDATE anime_series SET search_vector = to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(alternative_title, '') || ' ' || coalesce(synopsis, '')) WHERE id = ${animeId}`,
	);
}

type AnimeCursor = {
	nextPage?: number;
	lastSuccessAt?: string | null;
};

function readAnimeCursor(value: unknown): AnimeCursor {
	return readJsonObject(value) as AnimeCursor;
}

async function saveAnimeItem(
	source: SourceConfig,
	item: AnimeListItem,
	details: AnimeDetails,
) {
	const timestamp = now();
	const normalizedTitle =
		normalizeTitle(details.title || item.title) || item.externalId;
	const known = await db
		.select({ animeId: animeSources.animeId })
		.from(animeSources)
		.where(
			and(
				eq(animeSources.sourceId, source.id),
				eq(animeSources.externalId, item.externalId),
			),
		)
		.limit(1);
	let animeId = known[0]?.animeId;
	if (!animeId) {
		const titleMatch = await db
			.select({ id: animeSeries.id })
			.from(animeSeries)
			.where(eq(animeSeries.normalizedTitle, normalizedTitle))
			.limit(1);
		animeId = titleMatch[0]?.id;
	}
	if (!animeId) {
		animeId = crypto.randomUUID();
		await db
			.insert(animeSeries)
			.values({
				id: animeId,
				normalizedTitle,
				title: details.title || item.title,
				alternativeTitle: details.alternativeTitle,
				synopsis: details.synopsis,
				status: details.status,
				score: details.score,
				episodeCount: details.episodeCount,
				animeType: details.animeType,
				studio: details.studio,
				genresJson: details.genres,
				latestEpisodeNumber: item.latestEpisodeNumber,
				latestEpisodeAt: toDate(item.sourceUpdatedAt),
				createdAt: timestamp,
				updatedAt: timestamp,
			})
			.onConflictDoNothing();
		const created = await db
			.select({ id: animeSeries.id })
			.from(animeSeries)
			.where(eq(animeSeries.normalizedTitle, normalizedTitle))
			.limit(1);
		animeId = created[0]?.id ?? animeId;
	} else {
		await db
			.update(animeSeries)
			.set({
				title: details.title || item.title,
				alternativeTitle: details.alternativeTitle ?? undefined,
				synopsis: details.synopsis ?? undefined,
				status: details.status ?? undefined,
				score: details.score ?? undefined,
				episodeCount: details.episodeCount ?? undefined,
				animeType: details.animeType ?? undefined,
				studio: details.studio ?? undefined,
				genresJson: details.genres,
				latestEpisodeNumber: item.latestEpisodeNumber ?? undefined,
				latestEpisodeAt: toDate(item.sourceUpdatedAt) ?? undefined,
				updatedAt: timestamp,
			})
			.where(eq(animeSeries.id, animeId));
	}
	await refreshAnimeSearchVector(animeId);

	const linkRows = await db
		.select({ id: animeSources.id })
		.from(animeSources)
		.where(
			and(
				eq(animeSources.sourceId, source.id),
				eq(animeSources.externalId, item.externalId),
			),
		)
		.limit(1);
	const animeSourceId = linkRows[0]?.id ?? crypto.randomUUID();
	const linkValues = {
		animeId,
		sourceId: source.id,
		externalId: item.externalId,
		slug: item.slug,
		sourceUrl: item.sourceUrl,
		title: details.title || item.title,
		alternativeTitle: details.alternativeTitle,
		posterUrl: details.posterUrl ?? item.posterUrl,
		rawPayload: rawObject(details.raw),
		lastScrapedAt: timestamp,
		updatedAt: timestamp,
	};
	if (linkRows[0]) {
		await db
			.update(animeSources)
			.set(linkValues)
			.where(eq(animeSources.id, animeSourceId));
	} else {
		await db
			.insert(animeSources)
			.values({ id: animeSourceId, ...linkValues, createdAt: timestamp })
			.onConflictDoNothing();
	}

	let savedEpisodes = 0;
	for (const episode of details.episodes) {
		const normalizedNumber = normalizeEpisodeNumber(episode.numberText);
		const existingEpisode = await db
			.select({ id: animeEpisodes.id })
			.from(animeEpisodes)
			.where(
				and(
					eq(animeEpisodes.animeId, animeId),
					eq(animeEpisodes.normalizedNumber, normalizedNumber),
				),
			)
			.limit(1);
		const episodeId = existingEpisode[0]?.id ?? crypto.randomUUID();
		if (existingEpisode[0]) {
			await db
				.update(animeEpisodes)
				.set({
					numberText: episode.numberText,
					sortNumber: episodeSortNumber(episode.numberText),
					title: episode.title,
					releasedAt: toDate(episode.releasedAt),
					updatedAt: timestamp,
				})
				.where(eq(animeEpisodes.id, episodeId));
		} else {
			await db
				.insert(animeEpisodes)
				.values({
					id: episodeId,
					animeId,
					normalizedNumber,
					numberText: episode.numberText,
					sortNumber: episodeSortNumber(episode.numberText),
					title: episode.title,
					releasedAt: toDate(episode.releasedAt),
					createdAt: timestamp,
					updatedAt: timestamp,
				})
				.onConflictDoNothing();
		}
		const linkEpisode = await db
			.select({ id: animeEpisodeSources.id })
			.from(animeEpisodeSources)
			.where(
				and(
					eq(animeEpisodeSources.sourceId, source.id),
					eq(animeEpisodeSources.externalId, episode.externalId),
				),
			)
			.limit(1);
		const episodeSourceId = linkEpisode[0]?.id ?? crypto.randomUUID();
		const episodeValues = {
			episodeId,
			animeSourceId,
			sourceId: source.id,
			externalId: episode.externalId,
			sourceUrl: episode.sourceUrl,
			rawPayload: rawObject(episode.raw),
			lastScrapedAt: timestamp,
			updatedAt: timestamp,
		};
		if (linkEpisode[0]) {
			await db
				.update(animeEpisodeSources)
				.set(episodeValues)
				.where(eq(animeEpisodeSources.id, episodeSourceId));
		} else {
			await db
				.insert(animeEpisodeSources)
				.values({ id: episodeSourceId, ...episodeValues, createdAt: timestamp })
				.onConflictDoNothing();
		}
		savedEpisodes += 1;
	}
	return { animeId, animeSourceId, savedEpisodes };
}

async function downloadAnimePoster(
	runId: string,
	source: SourceConfig,
	animeId: string,
	animeTitle: string,
	animeSourceId: string,
	posterUrl: string | null,
) {
	if (!posterUrl) return;
	const timestamp = now();
	const existing = await db
		.select()
		.from(animeThumbnails)
		.where(
			and(
				eq(animeThumbnails.animeSourceId, animeSourceId),
				eq(animeThumbnails.externalUrl, posterUrl),
			),
		)
		.limit(1);
	const thumbId = existing[0]?.id ?? crypto.randomUUID();
	if (!existing[0]) {
		await db
			.insert(animeThumbnails)
			.values({
				id: thumbId,
				animeSourceId,
				externalUrl: posterUrl,
				downloadStatus: "remote",
				createdAt: timestamp,
				updatedAt: timestamp,
			})
			.onConflictDoNothing();
	}
	const thumb = (
		await db
			.select()
			.from(animeThumbnails)
			.where(eq(animeThumbnails.id, thumbId))
			.limit(1)
	)[0];
	if (!thumb || (thumb.downloadStatus === "saved" && thumb.blobSha256)) return;
	try {
		const blob = await downloadUrlToBlob(
			runId,
			posterUrl,
			source,
			(sha256, contentType) =>
				animeThumbnailObjectKey({
					animeId,
					animeTitle,
					sourceKey: source.key,
					sha256,
					contentType,
				}),
		);
		await db
			.update(animeThumbnails)
			.set({
				blobSha256: blob.sha256,
				downloadStatus: "saved",
				lastError: null,
				downloadedAt: now(),
				updatedAt: now(),
			})
			.where(eq(animeThumbnails.id, thumb.id));
	} catch (error) {
		if (isRunControlError(error)) throw error;
		await db
			.update(animeThumbnails)
			.set({
				downloadStatus: "failed",
				lastError:
					error instanceof Error
						? error.message.slice(0, 1_000)
						: String(error),
				updatedAt: now(),
			})
			.where(eq(animeThumbnails.id, thumb.id));
		throw error;
	}
}

async function runAnimeForSource(
	runId: string,
	sourceRow: typeof sources.$inferSelect,
	resuming = false,
	workerToken?: string,
) {
	if (!currentRunWorkerLease(runId)) {
		const token =
			workerToken ??
			(await claimRunWorkerToken(runId, resuming ? "resume" : "start"));
		// Klaim yang gagal berarti worker lain memenangkan lease atomik di DB.
		// Jangan sentuh activeRuns: hanya pemilik lease yang boleh
		// menambah/menghapus agar worker yang kalah tidak memicu duplikat.
		if (!token) {
			return;
		}
		activeRuns.add(runId);
		try {
			await withRunWorkerLease(runId, token, () =>
				runAnimeForSource(runId, sourceRow, resuming, token),
			);
		} finally {
			await releaseRunWorker(runId, token);
			activeRuns.delete(runId);
		}
		return;
	}
	const source = sourceConfig(sourceRow, runId);
	const startedAt = now();
	let progressTotal = 0;
	let progressCompleted = 0;
	let progressFailed = 0;
	let savedEpisodes = 0;
	let unchangedAnime = 0;

	try {
		await updateRun(runId, {
			status: "running",
			startedAt,
			currentStep: `${source.name}: membaca daftar anime`,
		});
		const adapter = animeAdapterFor(source.key);
		if (!adapter) {
			await addRunEvent(
				runId,
				`${source.name}: belum ada adapter anime yang terdaftar, sumber dilewati`,
				{ level: "warning" },
			);
			await finishRun(runId, "completed", {
				summary: { source: source.key, skipped: true },
			});
			return;
		}
		const stateRows = await db
			.select()
			.from(sourceScrapeState)
			.where(eq(sourceScrapeState.sourceId, source.id))
			.limit(1);
		const cursor = readAnimeCursor(stateRows[0]?.cursorJson);
		let page = resuming && cursor.nextPage ? cursor.nextPage : 1;
		// Snapshot DB untuk perbandingan incremental (bug #3): hanya item
		// baru/berubah yang memicu getDetails + saveAnimeItem.
		const knownLinks = await db
			.select({
				externalId: animeSources.externalId,
				title: animeSources.title,
				posterUrl: animeSources.posterUrl,
				latestEpisodeNumber: animeSeries.latestEpisodeNumber,
				latestEpisodeAt: animeSeries.latestEpisodeAt,
			})
			.from(animeSources)
			.innerJoin(animeSeries, eq(animeSources.animeId, animeSeries.id))
			.where(eq(animeSources.sourceId, source.id));
		const knownByExternalId = new Map(
			knownLinks.map((row) => [row.externalId, row]),
		);
		await addRunEvent(runId, `${source.name}: scrape anime dimulai`);
		let totalPages = 1;
		const batchSize = await getScrapeBatchSize();
		const batchConcurrency = await getScrapeBatchConcurrency();
		do {
			await waitForRunResume(runId);
			const result = await adapter.listAnime(source, {
				page,
				pageSize: PAGE_SIZE,
			});
			totalPages = result.totalPages;
			if (page === 1) progressTotal = result.totalRecords;
			for (const [batchIndex, batch] of Array.from(
				batches(result.items, batchSize),
			).entries()) {
				await withConcurrency(batch, batchConcurrency, async (item) => {
					await waitForRunResume(runId);
					const known = knownByExternalId.get(item.externalId);
					if (known && isAnimeListItemUnchanged(known, item)) {
						unchangedAnime += 1;
						progressCompleted += 1;
						return;
					}
					try {
						const details = await adapter.getDetails(source, item);
						const saved = await saveAnimeItem(source, item, details);
						knownByExternalId.set(item.externalId, {
							externalId: item.externalId,
							title: details.title || item.title,
							posterUrl: details.posterUrl ?? item.posterUrl,
							latestEpisodeNumber: item.latestEpisodeNumber,
							latestEpisodeAt: toDate(item.sourceUpdatedAt),
						});
						savedEpisodes += saved.savedEpisodes;
						await downloadAnimePoster(
							runId,
							source,
							saved.animeId,
							details.title || item.title,
							saved.animeSourceId,
							details.posterUrl ?? item.posterUrl,
						).catch((error) => {
							if (isRunControlError(error)) throw error;
						});
						progressCompleted += 1;
					} catch (error) {
						if (isRunControlError(error)) throw error;
						progressFailed += 1;
						progressCompleted += 1;
						await addRunEvent(
							runId,
							`${source.name}: gagal memuat ${item.title}`,
							{
								level: "error",
								details: {
									externalId: item.externalId,
									error: error instanceof Error ? error.message : String(error),
								},
							},
						);
					}
				});
				await updateRun(runId, {
					currentStep: `${source.name}: halaman ${page}/${totalPages}, batch ${batchIndex + 1} selesai`,
					progressTotal,
					progressCompleted,
					progressFailed,
				});
				void batchIndex;
			}
			page += 1;
			await db
				.update(sourceScrapeState)
				.set({
					cursorJson: { nextPage: page } as Record<string, unknown>,
					updatedAt: now(),
				})
				.where(eq(sourceScrapeState.sourceId, source.id));
		} while (page <= totalPages);
		await db
			.update(sourceScrapeState)
			.set({
				cursorJson: {},
				lastSuccessAt: now(),
				updatedAt: now(),
			})
			.where(eq(sourceScrapeState.sourceId, source.id));
		await updateRun(runId, {
			progressTotal: Math.max(progressTotal, progressCompleted),
			progressCompleted,
			progressFailed,
		});
		await invalidateCache(`${ANIME_WORKSPACE_ID}:`);
		await finishRun(runId, progressFailed > 0 ? "partial" : "completed", {
			summary: {
				source: source.key,
				savedEpisodes,
				unchangedAnime,
				progressFailed,
			},
		});
	} catch (error) {
		if (isRunControlError(error)) return;
		const message =
			error instanceof Error
				? error.message
				: "Kesalahan scrape tidak diketahui";
		await finishRun(runId, "failed", {
			errorMessage: message,
			summary: { source: source.key },
		});
	} finally {
		clearRetryNotice(runId);
		activeRuns.delete(runId);
	}
}

export async function startAnimeScrapes(
	triggeredBy: "manual" | "scheduler" = "manual",
) {
	const sourceRows = await db
		.select()
		.from(sources)
		.where(
			and(
				eq(sources.workspaceId, ANIME_WORKSPACE_ID),
				eq(sources.enabled, true),
			),
		);
	const runs = [];
	for (const source of sourceRows) {
		const started = await beginRun({
			workspaceId: ANIME_WORKSPACE_ID,
			sourceId: source.id,
			jobKey: `metadata:${ANIME_WORKSPACE_ID}:${source.id}`,
			kind: "metadata",
			mode: "incremental",
			triggeredBy,
		});
		runs.push(started.run);
		if (started.created) {
			void runAnimeForSource(started.run.id, source).catch((error) => {
				if (!isRunControlError(error))
					console.error("Anime worker could not be started", {
						runId: started.run.id,
						error: error instanceof Error ? error.message : String(error),
					});
				activeRuns.delete(started.run.id);
			});
		}
	}
	return runs;
}

export async function resumeAnimeScrape(runId: string, workerToken?: string) {
	const rows = await db
		.select()
		.from(scrapeRuns)
		.where(eq(scrapeRuns.id, runId))
		.limit(1);
	const run = rows[0];
	if (run?.workspaceId !== ANIME_WORKSPACE_ID || !run.sourceId)
		throw new Error("Anime run tidak ditemukan");
	if (
		run.status !== "queued" &&
		run.status !== "paused" &&
		run.status !== "running"
	)
		throw new Error("Hanya scrape yang dijeda yang dapat dilanjutkan");
	if (!activeRuns.has(runId)) {
		const sourceRows = await db
			.select()
			.from(sources)
			.where(eq(sources.id, run.sourceId))
			.limit(1);
		if (!sourceRows[0]) throw new Error("Sumber scrape tidak ditemukan");
		void runAnimeForSource(runId, sourceRows[0], true, workerToken).catch(
			(error) => {
				if (isRunControlError(error)) return;
				console.error("Anime worker could not be resumed", {
					runId,
					error: error instanceof Error ? error.message : String(error),
				});
				activeRuns.delete(runId);
			},
		);
	}
	return (
		await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId)).limit(1)
	)[0];
}

export async function retryAnimeScrape(runId: string) {
	const rows = await db
		.select()
		.from(scrapeRuns)
		.where(eq(scrapeRuns.id, runId))
		.limit(1);
	const run = rows[0];
	if (run?.workspaceId !== ANIME_WORKSPACE_ID || !run.sourceId)
		throw new Error("Anime run tidak ditemukan");
	if (!["partial", "failed", "cancelled"].includes(run.status))
		throw new Error("Run ini belum dapat dicoba ulang");
	const sourceRows = await db
		.select()
		.from(sources)
		.where(eq(sources.id, run.sourceId))
		.limit(1);
	if (!sourceRows[0]?.enabled) throw new Error("Sumber scrape tidak aktif");
	const started = await beginRun({
		workspaceId: ANIME_WORKSPACE_ID,
		sourceId: sourceRows[0].id,
		jobKey: `metadata:${ANIME_WORKSPACE_ID}:${sourceRows[0].id}`,
		kind: "metadata",
		mode: "incremental",
		triggeredBy: "manual",
	});
	if (started.created) {
		void runAnimeForSource(started.run.id, sourceRows[0]).catch((error) => {
			if (isRunControlError(error)) return;
			console.error("Anime retry worker could not be started", {
				runId: started.run.id,
				error: error instanceof Error ? error.message : String(error),
			});
			activeRuns.delete(started.run.id);
		});
	}
	return started.run;
}

export async function runScheduledAnimeScrapeForToday(
	timeZone: string,
	slot: DueSlot = { today: todayInZone(timeZone), time: "20:00" },
) {
	const sourceRows = await db
		.select()
		.from(sources)
		.where(
			and(
				eq(sources.workspaceId, ANIME_WORKSPACE_ID),
				eq(sources.enabled, true),
			),
		);
	const due: typeof sourceRows = [];
	for (const source of sourceRows) {
		const state = await db
			.select()
			.from(sourceScrapeState)
			.where(eq(sourceScrapeState.sourceId, source.id))
			.limit(1);
		if (!isSourceDueForSlot(state[0], slot)) continue;
		due.push(source);
	}
	if (due.length === 0) return [];
	const runs = [];
	for (const source of due) {
		const started = await beginRun({
			workspaceId: ANIME_WORKSPACE_ID,
			sourceId: source.id,
			jobKey: `metadata:${ANIME_WORKSPACE_ID}:${source.id}`,
			kind: "metadata",
			mode: "incremental",
			triggeredBy: "scheduler",
		});
		runs.push(started.run);
		if (started.created) {
			void runAnimeForSource(started.run.id, source).catch((error) => {
				if (isRunControlError(error)) return;
				console.error("Scheduled anime worker could not be started", {
					runId: started.run.id,
					error: error instanceof Error ? error.message : String(error),
				});
				activeRuns.delete(started.run.id);
			});
		}
		await db
			.update(sourceScrapeState)
			.set({
				lastAutoScrapeDate: slot.today,
				lastAutoScrapeSlot: slot.time,
				updatedAt: now(),
			})
			.where(eq(sourceScrapeState.sourceId, source.id));
	}
	return runs;
}

export async function startAnimeImageDownload(
	sourceKey?: string,
	triggeredBy: "manual" | "scheduler" = "manual",
) {
	const { startImageDownload } = await import("./images");
	return startImageDownload(sourceKey ? { sourceKey } : {}, {
		workspaceId: ANIME_WORKSPACE_ID,
		triggeredBy,
	});
}
