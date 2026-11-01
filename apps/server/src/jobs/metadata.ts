import {
	chapterSources,
	chapters,
	scrapeRuns,
	seriesSources,
	sourceScrapeState,
	sources,
} from "@SyMi/db/schema/index";
import { and, eq, inArray } from "drizzle-orm";
import { invalidateCache } from "../cache/index";
import { db } from "../services";
import { adapterFor } from "../sources";
import type {
	ChapterRecord,
	SeriesRecord,
	SourceConfig,
} from "../sources/types";
import {
	batches,
	getScrapeBatchConcurrency,
	getScrapeBatchSize,
	getScrapeIncrementalMaxPages,
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
import {
	accountMetadataProgress,
	createMetadataProgressLedger,
	type MetadataProgressLedger,
	metadataCandidates,
	metadataDetectionMode,
	metadataProgressCounts,
	metadataProgressKey,
	setMetadataProgressTotal,
} from "./metadata-progress";
import {
	saveChapterPageUrls,
	saveChapters,
	saveSeries,
	syncChapterPageMediaInventory,
} from "./store";
import {
	claimRunWorkerToken,
	currentRunWorkerLease,
	releaseRunWorker,
	withRunWorkerLease,
} from "./worker-lease";

const COMIC_WORKSPACE_ID = "comic";
const PAGE_SIZE = 40;
const activeRuns = new Set<string>();

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

function extractLatestChapterId(value: unknown) {
	const raw =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	const chapterList = Array.isArray(raw.chapters) ? raw.chapters : [];
	const latest =
		chapterList[0] && typeof chapterList[0] === "object"
			? (chapterList[0] as Record<string, unknown>)
			: {};
	const valueFromList = latest.chapter_id ?? latest.id;
	const id = raw.latest_chapter_id ?? valueFromList;
	return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function extractLatestChapterNumber(value: unknown) {
	const raw =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	const chapterList = Array.isArray(raw.chapters) ? raw.chapters : [];
	const latest =
		chapterList[0] && typeof chapterList[0] === "object"
			? (chapterList[0] as Record<string, unknown>)
			: {};
	const number =
		raw.latest_chapter_number ?? latest.chapter_number ?? latest.chapterNumber;
	return typeof number === "string" || typeof number === "number"
		? String(number)
		: null;
}

function toTime(value: string | Date | null | undefined) {
	if (value instanceof Date) {
		const time = value.getTime();
		return Number.isFinite(time) ? time : Number.NaN;
	}
	if (typeof value === "string" && value) {
		const time = Date.parse(value);
		return Number.isFinite(time) ? time : Number.NaN;
	}
	return Number.NaN;
}

function hasChangedTimestamp(
	value: string | Date | null | undefined,
	previous: string | Date | null | undefined,
) {
	const current = toTime(value);
	const old = toTime(previous);
	if (!Number.isFinite(current)) return false;
	if (!Number.isFinite(old)) return true;
	return current !== old;
}

function latestSeriesUpdateAt(record: SeriesRecord) {
	return record.latestChapterAt ?? record.sourceUpdatedAt ?? null;
}

function hasReachedUpdateWatermark(
	records: SeriesRecord[],
	watermarkAt: string | Date | null,
) {
	const watermark = toTime(watermarkAt);
	if (!Number.isFinite(watermark) || records.length === 0) return false;
	const timestamps = records
		.map(latestSeriesUpdateAt)
		.filter((value): value is string => Boolean(value))
		.map((value) => Date.parse(value))
		.filter((value) => Number.isFinite(value));
	return (
		timestamps.length > 0 &&
		timestamps.every((value) => value <= (watermark as number))
	);
}

function hasReliableUpdateDates(records: SeriesRecord[]) {
	return records.some((record) => {
		const value = latestSeriesUpdateAt(record);
		return Boolean(value && Number.isFinite(Date.parse(value)));
	});
}

async function changedSeriesForPage(
	source: SourceConfig,
	records: SeriesRecord[],
	mode: "full" | "incremental",
) {
	if (mode === "full") return records;
	const externalIds = [...new Set(records.map((record) => record.externalId))];
	if (externalIds.length === 0) return [];
	const existingRows = await db
		.select({
			externalId: seriesSources.externalId,
			sourceUpdatedAt: seriesSources.sourceUpdatedAt,
			rawPayload: seriesSources.rawPayload,
			needsHydration: seriesSources.needsHydration,
			title: seriesSources.title,
			alternativeTitle: seriesSources.alternativeTitle,
		})
		.from(seriesSources)
		.where(
			and(
				eq(seriesSources.sourceId, source.id),
				inArray(seriesSources.externalId, externalIds),
			),
		);
	const existingById = new Map(
		existingRows.map((row) => [row.externalId, row]),
	);
	return records.filter((record) => {
		const existing = existingById.get(record.externalId);
		if (!existing || existing.needsHydration) return true;
		const oldRaw = readJsonObject(existing.rawPayload);
		const oldLatestId = extractLatestChapterId(oldRaw);
		const newLatestId =
			record.latestChapterId ?? extractLatestChapterId(record.raw);
		if (newLatestId && oldLatestId !== newLatestId) return true;
		const oldLatestNumber = extractLatestChapterNumber(oldRaw);
		const newLatestNumber =
			record.latestChapterNumber ?? extractLatestChapterNumber(record.raw);
		if (newLatestNumber && oldLatestNumber !== newLatestNumber) return true;
		if (hasChangedTimestamp(record.sourceUpdatedAt, existing.sourceUpdatedAt))
			return true;
		return (
			record.title !== existing.title ||
			(record.alternativeTitle ?? null) !== existing.alternativeTitle
		);
	});
}

async function discoverReaderUrls(
	runId: string,
	source: SourceConfig,
	seriesSourceId: string,
	chapterRecords: ChapterRecord[],
	force = false,
) {
	const eligibleStatuses = force
		? ["pending", "failed", "running", "complete", "complete_empty"]
		: ["pending", "failed", "running", "complete_empty"];
	const links = await db
		.select()
		.from(chapterSources)
		.where(
			and(
				eq(chapterSources.seriesSourceId, seriesSourceId),
				inArray(chapterSources.readerUrlStatus, eligibleStatuses),
			),
		);
	const recordsById = new Map(
		chapterRecords.map((record) => [record.externalId, record]),
	);
	let succeeded = 0;
	let failed = 0;

	await withConcurrency(links, 2, async (link) => {
		const chapterRecord = recordsById.get(link.externalId);
		if (!chapterRecord) return;
		await waitForRunResume(runId);
		const attemptedAt = now();
		await db
			.update(chapterSources)
			.set({
				readerUrlStatus: "running",
				readerUrlError: null,
				updatedAt: attemptedAt,
			})
			.where(eq(chapterSources.id, link.id));
		try {
			const urls = await adapterFor(source.key).getChapterPages(
				source,
				chapterRecord,
			);
			await saveChapterPageUrls(link.id, urls);
			const completedAt = now();
			await db
				.update(chapterSources)
				.set({
					readerUrlStatus: "complete",
					readerUrlCount: urls.length,
					readerUrlsScrapedAt: completedAt,
					readerUrlError: null,
					updatedAt: completedAt,
				})
				.where(eq(chapterSources.id, link.id));
			await syncChapterPageMediaInventory(link.id);
			succeeded += 1;
		} catch (error) {
			if (isRunControlError(error)) throw error;
			const message = error instanceof Error ? error.message : String(error);
			failed += 1;
			await db
				.update(chapterSources)
				.set({
					readerUrlStatus: "failed",
					readerUrlError: message.slice(0, 1_000),
					updatedAt: now(),
				})
				.where(eq(chapterSources.id, link.id));
			await addRunEvent(
				runId,
				`${source.name}: gagal mengambil URL halaman baca`,
				{
					level: "warning",
					details: {
						chapterSourceId: link.id,
						externalId: link.externalId,
						error: message.slice(0, 1_000),
					},
				},
			);
		}
	});

	return {
		succeeded,
		failed,
		attempted: links.filter((link) => recordsById.has(link.externalId)).length,
	};
}

async function retryPendingReaderUrls(runId: string, source: SourceConfig) {
	if (source.key !== "superkomik")
		return { succeeded: 0, failed: 0, attempted: 0 };
	const rows = await db
		.select({ link: chapterSources, number: chapters.numberText })
		.from(chapterSources)
		.innerJoin(chapters, eq(chapterSources.chapterId, chapters.id))
		.where(
			and(
				eq(chapterSources.sourceId, source.id),
				inArray(chapterSources.readerUrlStatus, [
					"pending",
					"failed",
					"running",
					"complete_empty",
				]),
			),
		);
	const groups = new Map<string, ChapterRecord[]>();
	for (const { link, number } of rows) {
		const group = groups.get(link.seriesSourceId) ?? [];
		group.push({
			externalId: link.externalId,
			slug: link.slug,
			sourceUrl: link.sourceUrl,
			number,
			title: link.title,
			thumbnailUrl: link.thumbnailUrl,
			publishedAt:
				link.publishedAt instanceof Date
					? link.publishedAt.toISOString()
					: null,
			viewCount: link.viewCount,
			raw: readJsonObject(link.rawPayload),
		});
		groups.set(link.seriesSourceId, group);
	}
	const totals = { succeeded: 0, failed: 0, attempted: 0 };
	for (const [seriesSourceId, records] of groups) {
		const result = await discoverReaderUrls(
			runId,
			source,
			seriesSourceId,
			records,
		);
		totals.succeeded += result.succeeded;
		totals.failed += result.failed;
		totals.attempted += result.attempted;
	}
	return totals;
}

type MetadataCursor = {
	watermarks?: Record<string, string>;
	completedCategories?: string[];
	categories?: Record<
		string,
		{ nextPage?: number; inProgressPage?: number; pageHadChanges?: boolean }
	>;
	pendingSeries?: Array<{ categoryKey: string; record: SeriesRecord }>;
	fullProgress?: MetadataProgressLedger;
};

function pendingSeriesKey(categoryKey: string, externalId: string) {
	return `${categoryKey}:${externalId}`;
}

function readMetadataCursor(value: unknown): MetadataCursor {
	const parsed = readJsonObject(value) as MetadataCursor;
	return parsed && typeof parsed === "object" ? parsed : {};
}

async function runForSource(
	runId: string,
	sourceRow: typeof sources.$inferSelect,
	requestedMode: "full" | "incremental",
	resuming = false,
	workerToken?: string,
) {
	if (!currentRunWorkerLease(runId)) {
		const token =
			workerToken ??
			(await claimRunWorkerToken(runId, resuming ? "resume" : "start"));
		// Klaim yang gagal berarti worker lain memenangkan lease atomik di DB.
		// Jangan sentuh activeRuns di sini: hanya pemilik lease yang boleh
		// menambah/menghapus, agar worker yang kalah tidak menghapus milik
		// pemenang dan memicu run duplikat.
		if (!token) {
			return;
		}
		activeRuns.add(runId);
		try {
			await withRunWorkerLease(runId, token, () =>
				runForSource(runId, sourceRow, requestedMode, resuming, token),
			);
		} finally {
			await releaseRunWorker(runId, token);
			activeRuns.delete(runId);
		}
		return;
	}
	const source = sourceConfig(sourceRow, runId);
	const workspaceId = sourceRow.workspaceId || COMIC_WORKSPACE_ID;
	const adapter = adapterFor(source.key);
	const stateRows = await db
		.select()
		.from(sourceScrapeState)
		.where(eq(sourceScrapeState.sourceId, source.id))
		.limit(1);
	const state = stateRows[0];
	const runRows = await db
		.select()
		.from(scrapeRuns)
		.where(eq(scrapeRuns.id, runId))
		.limit(1);
	const run = runRows[0];
	const cursor = readMetadataCursor(state?.cursorJson);
	const mode = requestedMode;
	cursor.categories ??= {};
	cursor.watermarks ??= {};
	cursor.completedCategories ??= [];
	if (mode === "full" && !resuming) {
		cursor.categories = {};
		cursor.completedCategories = [];
		cursor.pendingSeries = [];
		cursor.fullProgress = createMetadataProgressLedger(runId);
	}
	let legacyResumePage: string | undefined;
	if (mode === "full") {
		if (cursor.fullProgress?.runId !== runId) {
			const legacyPage = Object.entries(cursor.categories).find(
				([, progress]) => progress.inProgressPage !== undefined,
			);
			const legacyPendingKeys = new Set(
				(resuming ? (cursor.pendingSeries ?? []) : []).map((entry, index) =>
					metadataProgressKey(
						entry.categoryKey,
						0,
						entry.record.externalId,
						index,
					),
				),
			);
			const ledger = createMetadataProgressLedger(
				runId,
				run?.progressTotal ?? null,
			);
			ledger.baseCompleted = resuming
				? Math.max(0, (run?.progressCompleted ?? 0) - legacyPendingKeys.size)
				: 0;
			ledger.baseFailed = resuming
				? Math.max(0, (run?.progressFailed ?? 0) - legacyPendingKeys.size)
				: 0;
			for (const key of legacyPendingKeys)
				accountMetadataProgress(ledger, key, "failed");
			if (resuming && legacyPage)
				ledger.legacyUnaccountedPage = `${legacyPage[0]}:${legacyPage[1].inProgressPage}`;
			cursor.fullProgress = ledger;
		}
		legacyResumePage = cursor.fullProgress.legacyUnaccountedPage;
	}
	const pendingSeries = new Map(
		(cursor.pendingSeries ?? []).map((entry) => [
			pendingSeriesKey(entry.categoryKey, entry.record.externalId),
			entry,
		]),
	);
	const startedAt = now();
	let progressTotal =
		mode === "full" ? metadataProgressCounts(cursor.fullProgress!).total : 0;
	let progressCompleted =
		mode === "full"
			? metadataProgressCounts(cursor.fullProgress!).completed
			: 0;
	let progressFailed =
		mode === "full" ? metadataProgressCounts(cursor.fullProgress!).failed : 0;
	let processedSeries = 0;
	let savedChapters = 0;
	let unchangedSeries = 0;
	let pagesScanned = 0;
	let hitPageLimit = false;
	let readerUrlSucceeded = 0;
	let readerUrlFailed = 0;
	let readerUrlAttempted = 0;
	const refreshFullProgress = () => {
		if (mode !== "full" || !cursor.fullProgress) return;
		const counts = metadataProgressCounts(cursor.fullProgress);
		progressTotal = counts.total;
		progressCompleted = counts.completed;
		progressFailed = counts.failed;
	};
	const accountFullOutcome = (
		key: string,
		categoryKey: string,
		page: number,
		outcome: "completed" | "failed",
	) => {
		if (mode !== "full" || !cursor.fullProgress) return;
		if (
			legacyResumePage === `${categoryKey}:${page}` &&
			cursor.fullProgress.accounted[key] === undefined
		)
			return;
		accountMetadataProgress(cursor.fullProgress, key, outcome);
		refreshFullProgress();
	};

	await updateRun(runId, {
		mode,
		status: "running",
		startedAt,
		currentStep:
			mode === "full"
				? "Scrape penuh: membaca daftar komik"
				: "Scrape harian: mencari perubahan terbaru",
	});
	await addRunEvent(
		runId,
		mode === "full" ? "Scrape penuh dimulai" : "Scrape incremental dimulai",
		{
			details: {
				source: source.name,
				baseUrl: source.baseUrl,
				prefix: source.prefix,
			},
		},
	);
	await db
		.insert(sourceScrapeState)
		.values({
			id: crypto.randomUUID(),
			sourceId: source.id,
			lastAttemptAt: startedAt,
			cursorJson: {},
			createdAt: startedAt,
			updatedAt: startedAt,
		})
		.onConflictDoNothing();
	await db
		.update(sourceScrapeState)
		.set({
			lastAttemptAt: startedAt,
			...(mode === "full" && !resuming
				? { cursorJson: cursor as Record<string, unknown> }
				: {}),
			updatedAt: startedAt,
		})
		.where(eq(sourceScrapeState.sourceId, source.id));

	const categories =
		source.key === "shinigami"
			? ["project", "mirror"]
			: source.key === "superkomik"
				? ["manga", "doujinshi", "manhwa"]
				: [undefined];

	try {
		const retriedReaderUrls = await retryPendingReaderUrls(runId, source);
		readerUrlSucceeded += retriedReaderUrls.succeeded;
		readerUrlFailed += retriedReaderUrls.failed;
		readerUrlAttempted += retriedReaderUrls.attempted;
		for (const category of categories) {
			let page = 1;
			let totalPages = 1;
			let categoryDone = false;
			let stopAfterPage = false;
			let categoryHitPageLimit = false;
			let categoryHasReliableUpdateDates = false;
			let pagesInCategory = 0;
			let updateWatermarkReached = false;
			const categoryKey = category ?? "default";
			const hasPendingSeries = [...pendingSeries.values()].some(
				(entry) => entry.categoryKey === categoryKey,
			);
			if (
				mode === "full" &&
				resuming &&
				cursor.completedCategories.includes(categoryKey) &&
				!hasPendingSeries
			)
				continue;
			const watermarkAt =
				mode === "incremental"
					? (cursor.watermarks[categoryKey] ??
						state?.lastSuccessAt?.toISOString() ??
						null)
					: null;
			const bootstrapWindow = mode === "incremental" && !watermarkAt;
			const pageBudget = bootstrapWindow
				? 1
				: await getScrapeIncrementalMaxPages();
			const pendingPage =
				mode === "incremental" || (mode === "full" && resuming)
					? cursor.categories[categoryKey]?.nextPage
					: undefined;
			const interruptedPage =
				mode === "incremental" || (mode === "full" && resuming)
					? cursor.categories[categoryKey]?.inProgressPage
					: undefined;
			if (mode === "full" && resuming)
				page = interruptedPage ?? pendingPage ?? 1;

			do {
				await waitForRunResume(runId);
				await updateRun(runId, {
					currentStep: `${source.name}: membaca ${category ?? "katalog"}, halaman ${page}`,
					progressTotal,
					progressCompleted,
					progressFailed,
				});
				const result = await adapter.listSeries(source, {
					page,
					pageSize: PAGE_SIZE,
					category,
				});
				totalPages = result.totalPages;
				categoryHasReliableUpdateDates ||= hasReliableUpdateDates(result.items);
				if (mode === "full" && page === 1) {
					setMetadataProgressTotal(
						cursor.fullProgress!,
						categoryKey,
						result.totalRecords,
					);
					refreshFullProgress();
					await db
						.update(sourceScrapeState)
						.set({
							cursorJson: cursor as Record<string, unknown>,
							updatedAt: now(),
						})
						.where(eq(sourceScrapeState.sourceId, source.id));
				}
				if (mode === "incremental") progressTotal += result.items.length;
				pagesScanned += 1;
				pagesInCategory += 1;
				await addRunEvent(
					runId,
					`${source.name}: halaman ${page}/${totalPages} memuat ${result.items.length} komik`,
					{
						details: {
							category: category ?? null,
							pageSize: result.pageSize,
							totalRecords: result.totalRecords,
						},
					},
				);

				const detectionMode = metadataDetectionMode(mode, resuming);
				const changedRecords = await changedSeriesForPage(
					source,
					result.items,
					detectionMode,
				);
				const changedIds = new Set(
					changedRecords.map((record) => record.externalId),
				);
				const currentPageIds = new Set(
					result.items.map((record) => record.externalId),
				);
				const pendingForPage =
					mode === "incremental" && page === 1
						? [...pendingSeries.values()]
								.filter((entry) => entry.categoryKey === categoryKey)
								.map((entry) => entry.record)
						: mode === "full" && resuming
							? [...pendingSeries.values()]
									.filter((entry) => entry.categoryKey === categoryKey)
									.map((entry) => entry.record)
							: [];
				const pendingIds = new Set(
					pendingForPage.map((record) => record.externalId),
				);
				const candidates = metadataCandidates({
					mode,
					pageRecords: result.items,
					changedRecords,
					pendingRecords: pendingForPage,
					externalId: (record) => record.externalId,
				});
				const progressKeyByRecord = new Map(
					candidates.map((record, index) => [
						record,
						metadataProgressKey(
							categoryKey,
							page,
							record.externalId,
							record.externalId ? index : result.items.indexOf(record),
						),
					]),
				);
				const unchangedOnPage = result.items.filter(
					(record) =>
						!changedIds.has(record.externalId) &&
						!pendingIds.has(record.externalId),
				).length;
				const pendingOutsidePage = pendingForPage.filter(
					(record) => !currentPageIds.has(record.externalId),
				).length;
				if (mode === "incremental") {
					unchangedSeries += unchangedOnPage;
					progressCompleted += unchangedOnPage;
				}
				if (mode === "incremental") progressTotal += pendingOutsidePage;
				const resumedChangedPage =
					page === interruptedPage &&
					cursor.categories[categoryKey]?.pageHadChanges === true;
				updateWatermarkReached =
					mode === "incremental" &&
					hasReachedUpdateWatermark(result.items, watermarkAt);
				const noChangesWithoutReliableDates =
					changedRecords.length === 0 && !hasReliableUpdateDates(result.items);
				stopAfterPage =
					mode === "incremental" &&
					(!resumedChangedPage || updateWatermarkReached) &&
					(!pendingPage || page >= pendingPage) &&
					(updateWatermarkReached || noChangesWithoutReliableDates);
				if (mode === "incremental")
					for (const record of candidates) {
						pendingSeries.set(
							pendingSeriesKey(categoryKey, record.externalId),
							{ categoryKey, record },
						);
					}
				cursor.categories[categoryKey] = {
					nextPage: page,
					inProgressPage: page,
					pageHadChanges: changedRecords.length > 0 || resumedChangedPage,
				};
				cursor.pendingSeries = [...pendingSeries.values()];
				await db
					.update(sourceScrapeState)
					.set({
						cursorJson: cursor as Record<string, unknown>,
						updatedAt: now(),
					})
					.where(eq(sourceScrapeState.sourceId, source.id));
				let pageMutated = false;

				const batchSize = await getScrapeBatchSize();
				const batchConcurrency = await getScrapeBatchConcurrency();
				const batchCount = Math.ceil(candidates.length / batchSize);
				for (const [batchIndex, batch] of Array.from(
					batches(candidates, batchSize),
				).entries()) {
					try {
						await withConcurrency(batch, batchConcurrency, async (summary) => {
							await waitForRunResume(runId);
							if (!summary.externalId) {
								if (mode === "full") {
									const key = progressKeyByRecord.get(summary);
									if (key) accountFullOutcome(key, categoryKey, page, "failed");
								} else {
									progressFailed += 1;
									progressCompleted += 1;
								}
								await addRunEvent(
									runId,
									`${source.name}: komik tanpa ID dilewati`,
									{ level: "warning" },
								);
								return;
							}

							try {
								await saveSeries(workspaceId, source, summary, {
									needsHydration: true,
									invalidate: false,
								});
								pageMutated = true;

								const detail = await adapter.getSeries(source, summary);
								const merged: SeriesRecord = {
									...summary,
									...detail,
									category: detail.category ?? summary.category,
									latestChapterId:
										detail.latestChapterId ?? summary.latestChapterId,
									latestChapterNumber:
										detail.latestChapterNumber ?? summary.latestChapterNumber,
									latestChapterAt:
										detail.latestChapterAt ?? summary.latestChapterAt,
									sourceUpdatedAt:
										detail.sourceUpdatedAt ?? summary.sourceUpdatedAt,
								};
								const detailLink = await saveSeries(
									workspaceId,
									source,
									merged,
									{ needsHydration: true, invalidate: false },
								);
								const chapterRecords = await adapter.listChapters(
									source,
									merged,
								);
								savedChapters += await saveChapters(
									detailLink.seriesId,
									detailLink.seriesSourceId,
									source,
									chapterRecords,
									{ invalidate: false },
								);
								if (source.key === "superkomik") {
									const readerUrls = await discoverReaderUrls(
										runId,
										source,
										detailLink.seriesSourceId,
										chapterRecords,
										mode === "full",
									);
									readerUrlSucceeded += readerUrls.succeeded;
									readerUrlFailed += readerUrls.failed;
									readerUrlAttempted += readerUrls.attempted;
								}
								const hydratedAt = now();
								await db
									.update(seriesSources)
									.set({
										needsHydration: false,
										lastHydratedAt: hydratedAt,
										updatedAt: hydratedAt,
									})
									.where(eq(seriesSources.id, detailLink.seriesSourceId));
								pendingSeries.delete(
									pendingSeriesKey(categoryKey, summary.externalId),
								);

								processedSeries += 1;
								if (mode === "full") {
									const key = progressKeyByRecord.get(summary);
									if (key)
										accountFullOutcome(key, categoryKey, page, "completed");
								} else progressCompleted += 1;
							} catch (error) {
								if (isRunControlError(error)) throw error;
								pendingSeries.set(
									pendingSeriesKey(categoryKey, summary.externalId),
									{ categoryKey, record: summary },
								);
								if (mode === "full") {
									const key = progressKeyByRecord.get(summary);
									if (key) accountFullOutcome(key, categoryKey, page, "failed");
								} else {
									progressFailed += 1;
									progressCompleted += 1;
								}
								const message =
									error instanceof Error
										? error.message
										: "Kesalahan sumber tidak diketahui";
								await addRunEvent(
									runId,
									`${source.name}: gagal memuat detail ${summary.title}`,
									{
										level: "error",
										details: {
											externalId: summary.externalId,
											error: message,
										},
									},
								);
							}
						});
					} finally {
						cursor.pendingSeries = [...pendingSeries.values()];
						refreshFullProgress();
						await db
							.update(sourceScrapeState)
							.set({
								cursorJson: cursor as Record<string, unknown>,
								updatedAt: now(),
							})
							.where(eq(sourceScrapeState.sourceId, source.id));
						if (pageMutated) {
							await invalidateCache(`${workspaceId}:`);
							pageMutated = false;
						}
					}
					await updateRun(runId, {
						currentStep: `${source.name}: batch ${batchIndex + 1}/${batchCount} selesai`,
						progressTotal,
						progressCompleted,
						progressFailed,
					});
					await addRunEvent(
						runId,
						`${source.name}: batch ${batchIndex + 1}/${batchCount} selesai`,
						{
							details: { category: category ?? null, batchSize: batch.length },
						},
					);
				}
				await updateRun(runId, {
					currentStep: `${source.name}: halaman ${page} selesai, ${candidates.length} komik berubah dari ${result.items.length}`,
					progressTotal,
					progressCompleted,
					progressFailed,
				});

				if (
					mode === "incremental" &&
					!stopAfterPage &&
					pagesInCategory >= pageBudget &&
					page < totalPages
				) {
					hitPageLimit = true;
					categoryHitPageLimit = true;
					await addRunEvent(
						runId,
						`${source.name}: batas incremental ${pageBudget} halaman tercapai; ${bootstrapWindow || !categoryHasReliableUpdateDates ? "jendela dibatasi dan watermark dipertahankan" : "pencarian dilanjutkan pada scrape berikutnya"}`,
						{
							level: "info",
							details: { category: category ?? null, page, totalPages },
						},
					);
				}

				categoryDone =
					stopAfterPage || page >= totalPages || result.items.length === 0;
				const validPendingPage =
					pendingPage && pendingPage > 1 && pendingPage <= totalPages
						? pendingPage
						: undefined;
				const nextPage =
					page === 1 && validPendingPage ? validPendingPage : page + 1;
				// Hanya kategori yang benar-benar selesai (categoryDone) yang boleh
				// memajukan watermark. Jendela terbatas (boundedWindowComplete)
				// sengaja TIDAK menyentuh watermark: halaman di luar jendela belum
				// dipindai, dan memajukannya akan menghilangkan perubahan di sana
				// secara permanen. Cursor nextPage disimpan agar scrape berikut
				// melanjutkan dari halaman yang belum dipindai.
				if (categoryDone) {
					delete cursor.categories[categoryKey];
					cursor.watermarks[categoryKey] = startedAt.toISOString();
				} else
					cursor.categories[categoryKey] = {
						nextPage,
						inProgressPage: undefined,
						pageHadChanges: false,
					};
				if (legacyResumePage === `${categoryKey}:${page}`) {
					legacyResumePage = undefined;
					cursor.fullProgress!.legacyUnaccountedPage = undefined;
				}
				cursor.pendingSeries = [...pendingSeries.values()];
				await db
					.update(sourceScrapeState)
					.set({
						cursorJson: cursor as Record<string, unknown>,
						updatedAt: now(),
					})
					.where(eq(sourceScrapeState.sourceId, source.id));

				if (categoryDone || categoryHitPageLimit) break;
				page = nextPage;
			} while (page <= totalPages);
			if (mode === "full") {
				const hasPendingForCategory = [...pendingSeries.values()].some(
					(entry) => entry.categoryKey === categoryKey,
				);
				if (!hasPendingForCategory) {
					delete cursor.categories[categoryKey];
					if (categoryDone)
						cursor.completedCategories = [
							...new Set([...cursor.completedCategories, categoryKey]),
						];
				}
				cursor.pendingSeries = [...pendingSeries.values()];
				await db
					.update(sourceScrapeState)
					.set({
						cursorJson: cursor as Record<string, unknown>,
						updatedAt: now(),
					})
					.where(eq(sourceScrapeState.sourceId, source.id));
			}

			if (stopAfterPage) {
				await addRunEvent(
					runId,
					`${source.name}: pencarian halaman dihentikan ${updateWatermarkReached ? "setelah mencapai tanggal batas scrape sebelumnya" : "setelah menemukan halaman tanpa perubahan baru"}`,
					{
						details: {
							category: category ?? null,
							page,
							watermarkAt,
							boundary: updateWatermarkReached
								? "source-update-date"
								: "no-new-changes",
						},
					},
				);
			}
		}

		const finishedAt = now();
		const hasFailures = progressFailed > 0 || readerUrlFailed > 0;
		if (!hasFailures && !hitPageLimit) {
			await db
				.update(sourceScrapeState)
				.set({
					lastSuccessAt: finishedAt,
					lastFullAt:
						mode === "full" ? finishedAt : (state?.lastFullAt ?? null),
					updatedAt: finishedAt,
				})
				.where(eq(sourceScrapeState.sourceId, source.id));
		}

		await updateRun(runId, {
			progressTotal: Math.max(progressTotal, progressCompleted),
			progressCompleted,
			progressFailed,
		});
		await addRunEvent(
			runId,
			hasFailures
				? `${source.name}: scrape selesai sebagian`
				: hitPageLimit
					? `${source.name}: batas halaman tercapai; pencarian dilanjutkan pada scrape berikutnya`
					: `${source.name}: scrape selesai`,
			{
				level: hasFailures ? "warning" : "info",
				details: {
					mode,
					processedSeries,
					unchangedSeries,
					savedChapters,
					pagesScanned,
					hitPageLimit,
					progressFailed,
					readerUrlAttempted,
					readerUrlSucceeded,
					readerUrlFailed,
				},
			},
		);
		await finishRun(runId, hasFailures ? "partial" : "completed", {
			summary: {
				source: source.key,
				mode,
				processedSeries,
				unchangedSeries,
				savedChapters,
				pagesScanned,
				hitPageLimit,
				progressFailed,
				readerUrlAttempted,
				readerUrlSucceeded,
				readerUrlFailed,
			},
		});
	} catch (error) {
		if (isRunControlError(error)) return;
		const message =
			error instanceof Error
				? error.message
				: "Kesalahan scrape tidak diketahui";
		await addRunEvent(runId, `${source.name}: scrape gagal`, {
			level: "error",
			details: { error: message },
		});
		await updateRun(runId, {
			progressTotal,
			progressCompleted,
			progressFailed,
		});
		await finishRun(runId, "failed", {
			errorMessage: message,
			summary: { source: source.key, mode },
		});
	} finally {
		clearRetryNotice(runId);
		activeRuns.delete(runId);
	}
}

export async function startMetadataScrapes(
	mode: "full" | "incremental",
	triggeredBy: "manual" | "scheduler" = "manual",
	workspaceId: string = COMIC_WORKSPACE_ID,
) {
	const sourceRows = await db
		.select()
		.from(sources)
		.where(
			and(eq(sources.workspaceId, workspaceId), eq(sources.enabled, true)),
		);
	const runs = [];

	for (const source of sourceRows) {
		const jobKey = `metadata:${workspaceId}:${source.id}`;
		const started = await beginRun({
			workspaceId,
			sourceId: source.id,
			jobKey,
			kind: "metadata",
			mode,
			triggeredBy,
		});
		runs.push(started.run);
		if (started.created) {
			void runForSource(started.run.id, source, mode).catch(async (error) => {
				if (!isRunControlError(error))
					console.error("Metadata worker could not be started", {
						runId: started.run.id,
						error: error instanceof Error ? error.message : String(error),
					});
				activeRuns.delete(started.run.id);
			});
		}
	}
	return runs;
}

export async function resumeMetadataRun(runId: string, workerToken?: string) {
	const rows = await db
		.select()
		.from(scrapeRuns)
		.where(eq(scrapeRuns.id, runId))
		.limit(1);
	const run = rows[0];
	if (run?.kind !== "metadata" || !run.sourceId)
		throw new Error("Metadata run tidak ditemukan");
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
		void runForSource(
			runId,
			sourceRows[0],
			run.mode === "full" ? "full" : "incremental",
			true,
			workerToken,
		).catch(async (error) => {
			if (isRunControlError(error)) return;
			const message =
				error instanceof Error
					? error.message
					: "Kesalahan worker tidak diketahui";
			await addRunEvent(runId, "Worker metadata gagal dijalankan", {
				level: "error",
				details: { error: message },
			});
			activeRuns.delete(runId);
		});
	}
	return (
		await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId)).limit(1)
	)[0];
}

export async function retryMetadataRun(runId: string) {
	const rows = await db
		.select()
		.from(scrapeRuns)
		.where(eq(scrapeRuns.id, runId))
		.limit(1);
	const run = rows[0];
	if (run?.kind !== "metadata" || !run.sourceId)
		throw new Error("Metadata run tidak ditemukan");
	if (!["partial", "failed", "cancelled"].includes(run.status)) {
		throw new Error("Run ini belum dapat dicoba ulang");
	}
	const sourceRows = await db
		.select()
		.from(sources)
		.where(eq(sources.id, run.sourceId))
		.limit(1);
	if (!sourceRows[0]?.enabled) throw new Error("Sumber scrape tidak aktif");
	const workspaceId = run.workspaceId || COMIC_WORKSPACE_ID;
	const started = await beginRun({
		workspaceId,
		sourceId: sourceRows[0].id,
		jobKey: `metadata:${workspaceId}:${sourceRows[0].id}`,
		kind: "metadata",
		mode: run.mode === "full" ? "full" : "incremental",
		triggeredBy: "manual",
	});
	if (started.created) {
		void runForSource(
			started.run.id,
			sourceRows[0],
			run.mode === "full" ? "full" : "incremental",
		).catch(async (error) => {
			if (isRunControlError(error)) return;
			console.error("Metadata retry worker could not be started", {
				runId: started.run.id,
				error: error instanceof Error ? error.message : String(error),
			});
			activeRuns.delete(started.run.id);
		});
	}
	return started.run;
}

export async function runScheduledScrapeForToday(
	workspaceId: string = COMIC_WORKSPACE_ID,
	timeZone = "Asia/Jakarta",
) {
	const today = new Intl.DateTimeFormat("sv-SE", {
		timeZone,
	}).format(new Date());
	const sourceRows = await db
		.select()
		.from(sources)
		.where(
			and(eq(sources.workspaceId, workspaceId), eq(sources.enabled, true)),
		);

	const due = [];
	for (const source of sourceRows) {
		const state = await db
			.select()
			.from(sourceScrapeState)
			.where(eq(sourceScrapeState.sourceId, source.id))
			.limit(1);
		if (state[0]?.lastAutoScrapeDate === today) continue;
		due.push(source);
	}

	if (due.length === 0) return [];
	const runs = [];
	for (const source of due) {
		const started = await beginRun({
			workspaceId,
			sourceId: source.id,
			jobKey: `metadata:${workspaceId}:${source.id}`,
			kind: "metadata",
			mode: "incremental",
			triggeredBy: "scheduler",
		});
		runs.push(started.run);
		if (started.created) {
			void runForSource(started.run.id, source, "incremental").catch(
				async (error) => {
					if (isRunControlError(error)) return;
					console.error("Scheduled metadata worker could not be started", {
						runId: started.run.id,
						error: error instanceof Error ? error.message : String(error),
					});
					activeRuns.delete(started.run.id);
				},
			);
		}
		await db
			.update(sourceScrapeState)
			.set({ lastAutoScrapeDate: today, updatedAt: now() })
			.where(eq(sourceScrapeState.sourceId, source.id));
	}
	return runs;
}
