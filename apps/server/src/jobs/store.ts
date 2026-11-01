import {
	chapterPages,
	chapterSources,
	chapters,
	mediaAssets,
	series,
	seriesAliases,
	seriesSources,
} from "@SyMi/db/schema/index";
import { and, eq, inArray, sql } from "drizzle-orm";
import { invalidateCache } from "../cache/index";
import { db } from "../services";
import type {
	ChapterRecord,
	SeriesRecord,
	SourceConfig,
} from "../sources/types";

const CHAPTER_PAGE_WRITE_BATCH_SIZE = 100;

let catalogWriteTail = Promise.resolve();

export function withCatalogWriteLock<T>(action: () => Promise<T>): Promise<T> {
	const previous = catalogWriteTail;
	let release!: () => void;
	catalogWriteTail = new Promise<void>((resolve) => {
		release = resolve;
	});
	return previous.then(action).finally(release);
}

const now = () => new Date();

export function normalizeTitle(value: string) {
	return value
		.normalize("NFKD")
		.replace(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase("id-ID")
		.replace(/&/g, " and ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function normalizeChapterNumber(value: string) {
	const clean = value
		.trim()
		.replace(/^(chapter|ch\.?|episode|ep\.?)\s*/i, "")
		.replace(",", ".");
	const numeric = Number(clean);
	return Number.isFinite(numeric)
		? String(numeric)
		: clean.toLocaleLowerCase("id-ID");
}

function chapterSortNumber(value: string) {
	const numeric = Number(
		value
			.trim()
			.replace(/^(chapter|ch\.?|episode|ep\.?)\s*/i, "")
			.replace(",", "."),
	);
	return Number.isFinite(numeric) ? numeric : null;
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

function mergeNames(existing: unknown, values: string[] | undefined): string[] {
	const previous = Array.isArray(existing)
		? existing.filter((item): item is string => typeof item === "string")
		: [];
	return [
		...new Set(
			[...previous, ...(values ?? [])]
				.map((value) => value.trim())
				.filter(Boolean),
		),
	];
}

function rawObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

const VOLATILE_AUTH_QUERY_KEYS = new Set([
	"token",
	"access_token",
	"expires",
	"expires_at",
	"signature",
	"sig",
	"auth_key",
	"policy",
	"key-pair-id",
	"hdnts",
	"hdnea",
]);

function isVolatileAuthQueryKey(key: string) {
	const normalized = key.toLowerCase();
	return (
		VOLATILE_AUTH_QUERY_KEYS.has(normalized) ||
		normalized.startsWith("x-amz-") ||
		normalized.startsWith("x-goog-")
	);
}

export function chapterPageContentIdentity(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return `invalid:${value}`;
	}
	url.hash = "";
	const stableParams = [...url.searchParams.entries()]
		.filter(([key]) => !isVolatileAuthQueryKey(key))
		.sort(([leftKey, leftValue], [rightKey, rightValue]) =>
			leftKey === rightKey
				? leftValue.localeCompare(rightValue)
				: leftKey.localeCompare(rightKey),
		);
	url.search = "";
	for (const [key, value] of stableParams) url.searchParams.append(key, value);
	return url.toString();
}

export function normalizeChapterPageUrls(urls: string[]) {
	if (!Array.isArray(urls))
		throw new Error("Sumber mengembalikan daftar halaman yang tidak valid");
	if (urls.length === 0)
		throw new Error("Sumber tidak mengembalikan halaman gambar");

	return urls.map((url) => {
		try {
			const parsed = new URL(url);
			if (parsed.protocol === "http:" || parsed.protocol === "https:")
				return parsed.toString();
		} catch {
			// Reject the complete discovery before any snapshot changes are written.
		}
		throw new Error("Sumber mengembalikan URL halaman yang tidak valid");
	});
}

async function refreshSeriesSearchVector(seriesId: string) {
	await db.execute(
		sql`UPDATE series SET search_vector = to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(alternative_title, '') || ' ' || coalesce(description, '')) WHERE id = ${seriesId}`,
	);
}

async function getOrCreateCanonicalSeries(
	workspaceId: string,
	record: SeriesRecord,
	source: SourceConfig,
) {
	const knownSource = await db
		.select({ seriesId: seriesSources.seriesId })
		.from(seriesSources)
		.where(
			and(
				eq(seriesSources.sourceId, source.id),
				eq(seriesSources.externalId, record.externalId),
			),
		)
		.limit(1);
	if (knownSource[0]) return knownSource[0].seriesId;

	const aliases = [
		...new Set(
			[record.title, record.alternativeTitle, ...(record.aliases ?? [])]
				.filter((value): value is string => Boolean(value?.trim()))
				.map((value) => normalizeTitle(value))
				.filter(Boolean),
		),
	];

	if (aliases.length > 0) {
		const aliasMatch = await db
			.select({ seriesId: seriesAliases.seriesId })
			.from(seriesAliases)
			.where(
				and(
					eq(seriesAliases.workspaceId, workspaceId),
					inArray(seriesAliases.normalizedAlias, aliases),
				),
			)
			.limit(1);
		if (aliasMatch[0]) return aliasMatch[0].seriesId;
	}

	const normalizedTitle =
		normalizeTitle(record.title) || normalizeTitle(record.externalId);
	const titleMatch = await db
		.select({ id: series.id })
		.from(series)
		.where(
			and(
				eq(series.workspaceId, workspaceId),
				eq(series.normalizedTitle, normalizedTitle),
			),
		)
		.limit(1);
	if (titleMatch[0]) return titleMatch[0].id;

	const id = crypto.randomUUID();
	const timestamp = now();
	await db
		.insert(series)
		.values({
			id,
			workspaceId,
			title: record.title,
			normalizedTitle,
			alternativeTitle: record.alternativeTitle ?? null,
			description: record.description ?? null,
			coverImageUrl: record.coverImageUrl ?? null,
			status: record.status ?? null,
			releaseYear: record.releaseYear ?? null,
			authorsJson: record.authors ?? [],
			artistsJson: record.artists ?? [],
			genresJson: record.genres ?? [],
			formatsJson: record.formats ?? [],
			comicType: record.comicType ?? null,
			countryId: record.countryId ?? null,
			viewCount: record.viewCount ?? null,
			rating: record.rating ?? null,
			bookmarkCount: record.bookmarkCount ?? null,
			popularityRank: record.popularityRank ?? null,
			isFeatured: record.isFeatured ?? null,
			isRecommended: record.isRecommended ?? null,
			latestChapterNumber: record.latestChapterNumber ?? null,
			latestChapterAt: toDate(record.latestChapterAt),
			sourceUpdatedAt: toDate(record.sourceUpdatedAt),
			createdAt: timestamp,
			updatedAt: timestamp,
		})
		.onConflictDoNothing();

	const created = await db
		.select({ id: series.id })
		.from(series)
		.where(
			and(
				eq(series.workspaceId, workspaceId),
				eq(series.normalizedTitle, normalizedTitle),
			),
		)
		.limit(1);
	return created[0]?.id ?? id;
}

export function saveSeries(
	workspaceId: string,
	source: SourceConfig,
	record: SeriesRecord,
	options: { needsHydration?: boolean; invalidate?: boolean } = {},
) {
	return withCatalogWriteLock(async () => {
		const timestamp = now();
		const seriesId = await getOrCreateCanonicalSeries(
			workspaceId,
			record,
			source,
		);
		const existingSeries = await db
			.select()
			.from(series)
			.where(eq(series.id, seriesId))
			.limit(1);
		const canonical = existingSeries[0];
		const viewCount =
			Math.max(canonical?.viewCount ?? 0, record.viewCount ?? 0) || null;

		await db
			.update(series)
			.set({
				title: canonical?.title || record.title,
				alternativeTitle:
					record.alternativeTitle ?? canonical?.alternativeTitle ?? null,
				description: record.description ?? canonical?.description ?? null,
				coverImageUrl: record.coverImageUrl ?? canonical?.coverImageUrl ?? null,
				status: record.status ?? canonical?.status ?? null,
				releaseYear: record.releaseYear ?? canonical?.releaseYear ?? null,
				authorsJson: mergeNames(canonical?.authorsJson, record.authors),
				artistsJson: mergeNames(canonical?.artistsJson, record.artists),
				genresJson: mergeNames(canonical?.genresJson, record.genres),
				formatsJson: mergeNames(canonical?.formatsJson, record.formats),
				comicType: record.comicType ?? canonical?.comicType ?? null,
				countryId: record.countryId ?? canonical?.countryId ?? null,
				viewCount,
				rating: record.rating ?? canonical?.rating ?? null,
				bookmarkCount:
					Math.max(canonical?.bookmarkCount ?? 0, record.bookmarkCount ?? 0) ||
					null,
				popularityRank:
					record.popularityRank ?? canonical?.popularityRank ?? null,
				isFeatured: record.isFeatured ?? canonical?.isFeatured ?? null,
				isRecommended: record.isRecommended ?? canonical?.isRecommended ?? null,
				latestChapterNumber:
					record.latestChapterNumber ?? canonical?.latestChapterNumber ?? null,
				latestChapterAt:
					toDate(record.latestChapterAt) ?? canonical?.latestChapterAt ?? null,
				sourceUpdatedAt:
					toDate(record.sourceUpdatedAt) ?? canonical?.sourceUpdatedAt ?? null,
				updatedAt: timestamp,
			})
			.where(eq(series.id, seriesId));
		await refreshSeriesSearchVector(seriesId);

		const sourceRow = await db
			.select({ id: seriesSources.id })
			.from(seriesSources)
			.where(
				and(
					eq(seriesSources.sourceId, source.id),
					eq(seriesSources.externalId, record.externalId),
				),
			)
			.limit(1);
		const seriesSourceId = sourceRow[0]?.id ?? crypto.randomUUID();
		const sourceValues = {
			seriesId,
			sourceId: source.id,
			externalId: record.externalId,
			category: record.category ?? null,
			slug: record.slug ?? null,
			sourceUrl: record.sourceUrl ?? null,
			bannerUrl: record.bannerImageUrl ?? null,
			title: record.title,
			alternativeTitle: record.alternativeTitle ?? null,
			sourceUpdatedAt: toDate(record.sourceUpdatedAt),
			rawPayload: rawObject(record.raw),
			lastScrapedAt: timestamp,
			needsHydration: options.needsHydration ?? true,
			updatedAt: timestamp,
		};

		if (sourceRow[0]) {
			await db
				.update(seriesSources)
				.set(sourceValues)
				.where(eq(seriesSources.id, seriesSourceId));
		} else {
			await db
				.insert(seriesSources)
				.values({
					id: seriesSourceId,
					...sourceValues,
					createdAt: timestamp,
				})
				.onConflictDoNothing();
		}

		const aliasRows = [
			...new Set(
				[record.title, record.alternativeTitle, ...(record.aliases ?? [])]
					.filter((value): value is string => Boolean(value?.trim()))
					.map((alias) => ({ alias, normalizedAlias: normalizeTitle(alias) }))
					.filter((alias) => alias.normalizedAlias),
			),
		];
		for (const alias of aliasRows) {
			await db
				.insert(seriesAliases)
				.values({
					id: crypto.randomUUID(),
					workspaceId,
					seriesId,
					alias: alias.alias,
					normalizedAlias: alias.normalizedAlias,
					createdAt: timestamp,
					updatedAt: timestamp,
				})
				.onConflictDoNothing();
		}

		const linkedSeriesSource = await db
			.select({ id: seriesSources.id })
			.from(seriesSources)
			.where(
				and(
					eq(seriesSources.sourceId, source.id),
					eq(seriesSources.externalId, record.externalId),
				),
			)
			.limit(1);

		if (options.invalidate !== false) await invalidateCache(`${workspaceId}:`);

		return {
			seriesId,
			seriesSourceId: linkedSeriesSource[0]?.id ?? seriesSourceId,
		};
	});
}

export function shouldInvalidateReaderUrlDiscovery(
	existingSourceUrl: string | null,
	nextSourceUrl: string | null | undefined,
) {
	return nextSourceUrl != null && nextSourceUrl !== existingSourceUrl;
}

export function saveChapters(
	seriesId: string,
	seriesSourceId: string,
	source: SourceConfig,
	records: ChapterRecord[],
	options: { invalidate?: boolean } = {},
) {
	return withCatalogWriteLock(async () => {
		const timestamp = now();
		let saved = 0;

		for (const record of records) {
			if (!record.externalId) continue;
			const normalizedNumber = normalizeChapterNumber(record.number);
			const canonicalMatch = await db
				.select({ id: chapters.id, viewCount: chapters.viewCount })
				.from(chapters)
				.where(
					and(
						eq(chapters.seriesId, seriesId),
						eq(chapters.normalizedNumber, normalizedNumber),
					),
				)
				.limit(1);
			let chapterId: string;

			if (canonicalMatch[0]) {
				chapterId = canonicalMatch[0].id;
				await db
					.update(chapters)
					.set({
						numberText: record.number,
						sortNumber: chapterSortNumber(record.number),
						title: record.title ?? null,
						publishedAt: toDate(record.publishedAt),
						viewCount:
							Math.max(
								canonicalMatch[0].viewCount ?? 0,
								record.viewCount ?? 0,
							) || null,
						updatedAt: timestamp,
					})
					.where(eq(chapters.id, chapterId));
			} else {
				const candidateId = crypto.randomUUID();
				await db
					.insert(chapters)
					.values({
						id: candidateId,
						seriesId,
						normalizedNumber,
						numberText: record.number,
						sortNumber: chapterSortNumber(record.number),
						title: record.title ?? null,
						publishedAt: toDate(record.publishedAt),
						viewCount: record.viewCount ?? null,
						createdAt: timestamp,
						updatedAt: timestamp,
					})
					.onConflictDoNothing();
				const resolved = await db
					.select({ id: chapters.id })
					.from(chapters)
					.where(
						and(
							eq(chapters.seriesId, seriesId),
							eq(chapters.normalizedNumber, normalizedNumber),
						),
					)
					.limit(1);
				if (!resolved[0])
					throw new Error(`Tidak dapat menyimpan chapter ${record.number}`);
				chapterId = resolved[0].id;
			}

			const sourceChapter = await db
				.select({
					id: chapterSources.id,
					sourceUrl: chapterSources.sourceUrl,
				})
				.from(chapterSources)
				.where(
					and(
						eq(chapterSources.sourceId, source.id),
						eq(chapterSources.externalId, record.externalId),
					),
				)
				.limit(1);
			const chapterSourceId = sourceChapter[0]?.id ?? crypto.randomUUID();
			const sourceValues = {
				chapterId,
				seriesSourceId,
				sourceId: source.id,
				externalId: record.externalId,
				slug: record.slug ?? null,
				sourceUrl: record.sourceUrl ?? null,
				title: record.title ?? null,
				thumbnailUrl: record.thumbnailUrl ?? null,
				publishedAt: toDate(record.publishedAt),
				viewCount: record.viewCount ?? null,
				rawPayload: rawObject(record.raw),
				lastScrapedAt: timestamp,
				updatedAt: timestamp,
			};

			if (sourceChapter[0]) {
				const invalidateReaderUrls = shouldInvalidateReaderUrlDiscovery(
					sourceChapter[0].sourceUrl,
					record.sourceUrl,
				);
				await db
					.update(chapterSources)
					.set({
						...sourceValues,
						...(invalidateReaderUrls
							? { readerUrlCount: 0, readerUrlsScrapedAt: null }
							: {}),
					})
					.where(eq(chapterSources.id, chapterSourceId));
			} else {
				await db
					.insert(chapterSources)
					.values({
						id: chapterSourceId,
						...sourceValues,
						createdAt: timestamp,
					})
					.onConflictDoNothing();
			}
			saved += 1;
		}

		if (saved > 0 && options.invalidate !== false)
			await invalidateCache(`${source.workspaceId ?? "comic"}:`);

		return saved;
	});
}

type ExistingChapterPage = {
	id: string;
	pageIndex: number;
	externalUrl: string;
	isActive: boolean;
};

type ChapterPageWritePlan = {
	updates: Array<{
		id: string;
		previousPageIndex: number;
		pageIndex: number;
		externalUrl: string;
		resetDownloadState: boolean;
	}>;
	inserts: Array<{ pageIndex: number; externalUrl: string }>;
	tombstones: Array<{
		id: string;
		previousPageIndex: number;
		pageIndex: number;
	}>;
	restores: Array<{ id: string; pageIndex: number }>;
};

function planChapterPageUrlWrites(
	existingPages: ExistingChapterPage[],
	urls: string[],
): ChapterPageWritePlan {
	const updates: ChapterPageWritePlan["updates"] = [];
	const inserts: ChapterPageWritePlan["inserts"] = [];
	const restores: ChapterPageWritePlan["restores"] = [];
	const unused = new Set(existingPages.map((page) => page.id));
	const matches = new Map<number, ExistingChapterPage>();
	const identity = new Map(
		existingPages.map((page) => [
			page.id,
			chapterPageContentIdentity(page.externalUrl),
		]),
	);
	const candidatesFor = (url: string, pageIndex: number) => {
		const urlIdentity = chapterPageContentIdentity(url);
		return existingPages
			.filter(
				(page) => unused.has(page.id) && identity.get(page.id) === urlIdentity,
			)
			.sort((left, right) => {
				const score = (page: ExistingChapterPage) =>
					(page.externalUrl === url ? 2 : 0) +
					(page.pageIndex === pageIndex ? 1 : 0) +
					(page.isActive ? 0.25 : 0);
				return score(right) - score(left) || left.pageIndex - right.pageIndex;
			});
	};

	for (const [pageIndex, externalUrl] of urls.entries()) {
		const page = candidatesFor(externalUrl, pageIndex)[0];
		if (!page) continue;
		matches.set(pageIndex, page);
		unused.delete(page.id);
	}

	for (const [pageIndex] of urls.entries()) {
		if (matches.has(pageIndex)) continue;
		const page = existingPages.find(
			(candidate) =>
				candidate.pageIndex === pageIndex && unused.has(candidate.id),
		);
		if (!page) continue;
		matches.set(pageIndex, page);
		unused.delete(page.id);
	}

	for (const [pageIndex, externalUrl] of urls.entries()) {
		const page = matches.get(pageIndex);
		if (!page) {
			inserts.push({ pageIndex, externalUrl });
			continue;
		}
		const resetDownloadState =
			identity.get(page.id) !== chapterPageContentIdentity(externalUrl);
		if (
			page.pageIndex !== pageIndex ||
			page.externalUrl !== externalUrl ||
			!page.isActive
		) {
			updates.push({
				id: page.id,
				previousPageIndex: page.pageIndex,
				pageIndex,
				externalUrl,
				resetDownloadState,
			});
		} else {
			restores.push({ id: page.id, pageIndex });
		}
	}

	const tombstones = existingPages
		.filter((page) => unused.has(page.id))
		.sort((left, right) => left.pageIndex - right.pageIndex)
		.map((page, index) => ({
			id: page.id,
			previousPageIndex: page.pageIndex,
			pageIndex: urls.length + index,
		}));

	return { updates, inserts, tombstones, restores };
}

export async function saveChapterPageUrls(
	chapterSourceId: string,
	urls: string[],
) {
	const normalizedUrls = normalizeChapterPageUrls(urls);
	const timestamp = now();
	const existingByIndex = await db
		.select({
			id: chapterPages.id,
			pageIndex: chapterPages.pageIndex,
			externalUrl: chapterPages.externalUrl,
			isActive: chapterPages.isActive,
		})
		.from(chapterPages)
		.where(eq(chapterPages.chapterSourceId, chapterSourceId));
	const plan = planChapterPageUrlWrites(existingByIndex, normalizedUrls);
	const requiresReindex =
		plan.updates.some(
			(update) => update.pageIndex !== update.previousPageIndex,
		) ||
		plan.tombstones.some(
			(tombstone) => tombstone.pageIndex !== tombstone.previousPageIndex,
		) ||
		plan.inserts.some((insert) =>
			existingByIndex.some((page) => page.pageIndex === insert.pageIndex),
		);
	await db.transaction(async (tx) => {
		if (requiresReindex) {
			const minIndex = Math.min(
				0,
				...existingByIndex.map((page) => page.pageIndex),
			);
			for (const [index, page] of existingByIndex.entries()) {
				await tx
					.update(chapterPages)
					.set({ pageIndex: minIndex - index - 1 })
					.where(eq(chapterPages.id, page.id));
			}
		}

		for (const update of plan.updates) {
			await tx
				.update(chapterPages)
				.set(
					update.resetDownloadState
						? {
								pageIndex: update.pageIndex,
								externalUrl: update.externalUrl,
								blobSha256: null,
								isActive: true,
								downloadStatus: "remote",
								downloadAttempts: 0,
								lastError: null,
								downloadedAt: null,
								updatedAt: timestamp,
							}
						: {
								pageIndex: update.pageIndex,
								externalUrl: update.externalUrl,
								isActive: true,
								updatedAt: timestamp,
							},
				)
				.where(eq(chapterPages.id, update.id));
		}

		for (const tombstone of plan.tombstones) {
			await tx
				.update(chapterPages)
				.set({
					pageIndex: tombstone.pageIndex,
					isActive: false,
					updatedAt: timestamp,
				})
				.where(eq(chapterPages.id, tombstone.id));
		}
		if (requiresReindex) {
			for (const restore of plan.restores) {
				await tx
					.update(chapterPages)
					.set({ pageIndex: restore.pageIndex })
					.where(eq(chapterPages.id, restore.id));
			}
		}

		for (
			let offset = 0;
			offset < plan.inserts.length;
			offset += CHAPTER_PAGE_WRITE_BATCH_SIZE
		) {
			const batch = plan.inserts
				.slice(offset, offset + CHAPTER_PAGE_WRITE_BATCH_SIZE)
				.map(({ pageIndex, externalUrl }) => ({
					id: crypto.randomUUID(),
					chapterSourceId,
					pageIndex,
					externalUrl,
					isActive: true,
					downloadStatus: "remote",
					downloadAttempts: 0,
					createdAt: timestamp,
					updatedAt: timestamp,
				}));
			await tx.insert(chapterPages).values(batch).onConflictDoNothing();
		}
	});
	await syncChapterPageMediaInventory(chapterSourceId);
}

/**
 * Keep one `media_assets` row per active chapter page so the admin media
 * lane and the image worker share the same inventory identity.
 */
export async function syncChapterPageMediaInventory(chapterSourceId: string) {
	const link = await db
		.select({ sourceId: chapterSources.sourceId })
		.from(chapterSources)
		.where(eq(chapterSources.id, chapterSourceId))
		.limit(1);
	const sourceId = link[0]?.sourceId;
	if (!sourceId) return 0;
	const pages = await db
		.select()
		.from(chapterPages)
		.where(
			and(
				eq(chapterPages.chapterSourceId, chapterSourceId),
				eq(chapterPages.isActive, true),
			),
		);
	const timestamp = now();
	for (const page of pages) {
		await db
			.insert(mediaAssets)
			.values({
				id: crypto.randomUUID(),
				assetType: "comic_page",
				ownerType: "chapter_page",
				ownerId: page.id,
				sourceId,
				pageIndex: page.pageIndex,
				externalUrl: page.externalUrl,
				blobSha256: page.blobSha256,
				downloadStatus: page.downloadStatus,
				integrityStatus: "unchecked",
				sha256: page.blobSha256,
				downloadAttempts: page.downloadAttempts,
				lastError: page.lastError,
				downloadedAt: page.downloadedAt,
				createdAt: timestamp,
				updatedAt: timestamp,
			})
			.onConflictDoNothing();
	}
	return pages.length;
}

export async function updateMediaAssetStatus(
	id: string,
	values: Partial<typeof mediaAssets.$inferInsert>,
) {
	await db
		.update(mediaAssets)
		.set({ ...values, updatedAt: now() })
		.where(eq(mediaAssets.id, id));
}

export async function updatePageMediaAssetStatus(
	pageId: string,
	values: Partial<typeof mediaAssets.$inferInsert>,
) {
	const rows = await db
		.select({ id: mediaAssets.id })
		.from(mediaAssets)
		.where(
			and(
				eq(mediaAssets.assetType, "comic_page"),
				eq(mediaAssets.ownerType, "chapter_page"),
				eq(mediaAssets.ownerId, pageId),
			),
		);
	for (const row of rows) await updateMediaAssetStatus(row.id, values);
}
