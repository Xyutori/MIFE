/**
 * Shared comic-catalog read queries, ported from XyMI
 * `apps/server/src/routes/mife.ts` (+ `super-komik.ts` read endpoints).
 *
 * ## Image-URL decision (documented choice)
 * The S3 bucket is private, so object keys are NEVER exposed as direct URLs.
 * All stored bytes are served through same-origin proxy endpoints that stream
 * via `getObjectBytes`:
 * - `/api/v1/images/:id` (comic chapter pages),
 * - `/api/v1/super-komik/media/*` (super-komik covers/banners/thumbnails/pages).
 * JSON payloads keep the stored remote `coverImageUrl` untouched (same as XyMI
 * library items). Assets with no blob yet are served via 302 redirect to the
 * stored https URL (allowlisted by `safeExternalUrl`) instead of server-side
 * proxying — XyMI proxied source bytes via `fetchSource`, but MIFE has no
 * source allowlist lane yet, so redirecting avoids new SSRF surface.
 * Default is therefore SAFE for a private bucket: no signed URLs, no key leak.
 *
 * ## Search contract
 * Non-empty queries match `search_vector @@ plainto_tsquery('simple', q)` and
 * fall back to `ILIKE %q%` on the title (plus alias prefix match) so freshly
 * migrated rows without a backfilled vector still match. Empty queries skip
 * FTS entirely (plain filtered list).
 *
 * ## Postgres deviations from XyMI (SQLite)
 * - `julianday(...)` recency ordering -> `coalesce(latest_chapter_at,
 *   source_updated_at, updated_at)` DESC (native timestamptz ordering).
 * - `instr(lower(title), q)` substring search -> `ILIKE %q%`.
 * - `json_extract`/`json_valid` on TEXT JSON -> jsonb columns are already
 *   parsed objects; `parseJsonList` accepts both shapes.
 * - `total` in library responses counts matching rows (XyMI counted only rows
 *   with an http(s) cover — kept shape, fixed semantics).
 *
 * ## Wire projection contract
 * List/detail mappers select only columns consumed by the web frontend
 * (`apps/web/src/lib/api.ts` + `MangaCard`/`HeroCarousel`/detail/admin panel).
 * Full-row spreads are banned: `searchVector`, `workspaceId`,
 * `normalizedTitle` (except for slug derivation), `releaseYear`,
 * `sourceUpdatedAt`, `createdAt`, and raw `rawPayload` json are never sent.
 */

import type { Database } from "@SyMi/db";
import {
	animeSeriesGenres,
	chapterPages,
	chapterSources,
	chapters,
	imageBlobs,
	mediaAssets,
	series,
	seriesAliases,
	seriesGenres,
	seriesSources,
	sources,
	userPreferences,
	workspaces,
} from "@SyMi/db/schema/index";
import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";

export const COMIC_WORKSPACE_ID = "comic";
export const SUPERKOMIK_WORKSPACE_ID = "superkomik";
export const SUPERKOMIK_SOURCE_KEY = "superkomik";

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

/** Normalize free-form chapter input (`chapter-12`, `ch 12,5`, `Ep 3`) to the
 *  stored `normalizedNumber` form. Mirrors `jobs/store.ts`. */
export function normalizeChapterNumber(value: string) {
	const clean = value
		.trim()
		.replace(/^(chapter|ch\.?|episode|ep\.?)\s*/i, "")
		.replace(",", ".");
	const numeric = Number(clean);
	return Number.isFinite(numeric)
		? String(numeric)
		: clean.toLocaleLowerCase("id-ID");
}

/** Accept XyMI TEXT-encoded JSON as well as MIFE jsonb arrays. */
export function parseJsonList(value: unknown): string[] {
	if (Array.isArray(value))
		return value.filter((item): item is string => typeof item === "string");
	if (typeof value === "string") {
		try {
			const parsed: unknown = JSON.parse(value);
			return Array.isArray(parsed)
				? parsed.filter((item): item is string => typeof item === "string")
				: [];
		} catch {
			return [];
		}
	}
	return [];
}

function parseJsonValue(value: unknown) {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return {};
	}
}

export function safeExternalUrl(value: string | null | undefined) {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.toString()
			: null;
	} catch {
		return null;
	}
}

function toIso(value: Date | string | null | undefined): string | null {
	if (!value) return null;
	if (typeof value === "string") return value;
	return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function seriesSlug(normalizedTitle: string) {
	return normalizedTitle.replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// Series projections (only frontend-consumed columns hit the wire)
// ---------------------------------------------------------------------------

const seriesCardSelection = {
	id: series.id,
	title: series.title,
	normalizedTitle: series.normalizedTitle,
	coverImageUrl: series.coverImageUrl,
	updatedAt: series.updatedAt,
	latestChapterNumber: series.latestChapterNumber,
	latestChapterAt: series.latestChapterAt,
	isVisible: series.isVisible,
	comicType: series.comicType,
	countryId: series.countryId,
};

const seriesDetailSelection = {
	...seriesCardSelection,
	alternativeTitle: series.alternativeTitle,
	description: series.description,
	status: series.status,
	authorsJson: series.authorsJson,
	artistsJson: series.artistsJson,
	genresJson: series.genresJson,
	formatsJson: series.formatsJson,
	viewCount: series.viewCount,
	rating: series.rating,
	bookmarkCount: series.bookmarkCount,
	popularityRank: series.popularityRank,
	isFeatured: series.isFeatured,
	isRecommended: series.isRecommended,
};

export type SeriesCardRow = {
	id: string;
	title: string;
	normalizedTitle: string;
	coverImageUrl: string | null;
	updatedAt: Date;
	latestChapterNumber: string | null;
	latestChapterAt: Date | null;
	isVisible: boolean;
	comicType: string | null;
	countryId: string | null;
};

export type SeriesDetailRow = SeriesCardRow & {
	alternativeTitle: string | null;
	description: string | null;
	status: string | null;
	authorsJson: unknown;
	artistsJson: unknown;
	genresJson: unknown;
	formatsJson: unknown;
	viewCount: number | null;
	rating: number | null;
	bookmarkCount: number | null;
	popularityRank: number | null;
	isFeatured: boolean | null;
	isRecommended: boolean | null;
};

export type CatalogChapter = {
	id: string;
	numberText: string;
	createdAt: string | null;
};

export type CatalogSource = {
	key: string;
	name: string;
};

/** Public card shape: `Series` (api.ts) + admin panel extras
 * (`latestChapterAt`, `isVisible`, `sources`). */
export function seriesCardResponse(
	row: SeriesCardRow,
	extra: { latestChapters?: CatalogChapter[]; sources?: CatalogSource[] } = {},
) {
	return {
		id: row.id,
		slug: seriesSlug(row.normalizedTitle),
		title: row.title,
		coverImageUrl: row.coverImageUrl,
		updatedAt: row.updatedAt.toISOString(),
		latestChapterNumber: row.latestChapterNumber,
		latestChapterAt: toIso(row.latestChapterAt),
		isVisible: row.isVisible,
		latestChapters: extra.latestChapters ?? [],
		sources: extra.sources ?? [],
		comicType: row.comicType,
		countryId: row.countryId,
	};
}

export type HeroFeatureType = "new" | "views" | "chapters";

export function seriesHeroResponse(
	row: SeriesDetailRow,
	extra: {
		latestChapters?: CatalogChapter[];
		featureType: HeroFeatureType;
		featureLabel: string;
		chapterCount?: number | null;
	},
) {
	return {
		...seriesCardResponse(row, { latestChapters: extra.latestChapters }),
		description: row.description,
		viewCount: row.viewCount,
		rating: row.rating,
		featureType: extra.featureType,
		featureLabel: extra.featureLabel,
		chapterCount: extra.chapterCount ?? null,
	};
}

const COMIC_COUNTRY_ALIASES: Record<string, string[]> = {
	jp: ["jp", "jpn", "japan", "japanese", "jepang", "manga", "doujinshi"],
	cn: ["cn", "chn", "china", "chinese", "tiongkok", "cina", "manhua"],
	kr: ["kr", "kor", "korea", "korean", "south korea", "manhwa"],
	id: ["id", "idn", "indonesia", "indonesian", "lokal"],
};

const COMIC_TYPE_ALIASES: Record<string, string[]> = {
	manga: ["manga", "doujinshi"],
	manhwa: ["manhwa"],
	manhua: ["manhua"],
	webtoon: ["webtoon"],
};

export type SeriesListOptions = {
	workspaceId: string;
	page: number;
	pageSize: number;
	q?: string;
	genre?: string;
	status?: string;
	source?: string;
	country?: string;
	type?: string;
	sort?: "recent" | "title";
	includeHidden?: boolean;
};

function countryFilter(column: "country" | "type", value: string) {
	const aliases =
		column === "country"
			? COMIC_COUNTRY_ALIASES[value]
			: COMIC_TYPE_ALIASES[value];
	if (!aliases || aliases.length === 0) return null;
	const field = column === "country" ? series.countryId : series.comicType;
	const conds = aliases.map((alias) =>
		eq(sql`lower(${field})`, alias.toLowerCase()),
	);
	const cond = or(...conds);
	return cond ?? null;
}

function buildSeriesFilters(db: Database, opts: SeriesListOptions) {
	const search = normalizeTitle((opts.q ?? "").slice(0, 120));
	const filters: SQL[] = [eq(series.workspaceId, opts.workspaceId)];
	if (!opts.includeHidden) filters.push(eq(series.isVisible, true));
	if (search) {
		const searchCond = or(
			sql`${series.searchVector} @@ plainto_tsquery('simple', ${search})`,
			ilike(series.title, `%${search}%`),
			inArray(
				series.id,
				db
					.select({ seriesId: seriesAliases.seriesId })
					.from(seriesAliases)
					.where(
						and(
							eq(seriesAliases.workspaceId, opts.workspaceId),
							ilike(seriesAliases.alias, `${search}%`),
						),
					),
			),
		);
		if (searchCond) filters.push(searchCond);
	}
	if (opts.genre) {
		const keys = opts.genre
			.split(",")
			.map((key) => key.trim().toLowerCase())
			.filter((key) => key.length > 0);
		if (keys.length > 0) {
			filters.push(
				inArray(
					series.id,
					db
						.select({ seriesId: seriesGenres.seriesId })
						.from(seriesGenres)
						.where(inArray(seriesGenres.genreKey, keys)),
				),
			);
		}
	}
	if (opts.status)
		filters.push(eq(sql`lower(${series.status})`, opts.status.toLowerCase()));
	if (opts.source) {
		filters.push(
			inArray(
				series.id,
				db
					.select({ seriesId: seriesSources.seriesId })
					.from(seriesSources)
					.innerJoin(sources, eq(seriesSources.sourceId, sources.id))
					.where(
						and(
							eq(sources.workspaceId, opts.workspaceId),
							eq(sources.key, opts.source),
						),
					),
			),
		);
	}
	const country = countryFilter("country", (opts.country ?? "").toLowerCase());
	if (country) filters.push(country);
	const type = countryFilter("type", (opts.type ?? "").toLowerCase());
	if (type) filters.push(type);
	return and(...filters);
}

function seriesSortOrder(sort: SeriesListOptions["sort"]) {
	const recency = sql`coalesce(${series.latestChapterAt}, ${series.sourceUpdatedAt}, ${series.updatedAt})`;
	return sort === "title"
		? [asc(sql`lower(${series.title})`), desc(recency), asc(series.id)]
		: [desc(recency), asc(sql`lower(${series.title})`), asc(series.id)];
}

export async function listSeries(db: Database, opts: SeriesListOptions) {
	const where = buildSeriesFilters(db, opts);
	const rowsQuery = db
		.select(seriesCardSelection)
		.from(series)
		.where(where)
		.orderBy(...seriesSortOrder(opts.sort))
		.limit(opts.pageSize + 1)
		.offset((opts.page - 1) * opts.pageSize);
	const totalsQuery = db.select({ total: count() }).from(series).where(where);
	const [rows, totals] = await Promise.all([rowsQuery, totalsQuery]);
	const hasMore = rows.length > opts.pageSize;
	const pageRows = hasMore ? rows.slice(0, opts.pageSize) : rows;
	const ids = pageRows.map((row) => row.id);

	const latestChapterRows = ids.length
		? await db
				.select({
					seriesId: chapters.seriesId,
					id: chapters.id,
					numberText: chapters.numberText,
					createdAt: chapters.createdAt,
					updatedAt: chapters.updatedAt,
					position:
						sql<number>`row_number() over (partition by ${chapters.seriesId} order by ${chapters.sortNumber} desc nulls last, ${chapters.publishedAt} desc nulls last, ${chapters.updatedAt} desc)`.as(
							"position",
						),
				})
				.from(chapters)
				.where(inArray(chapters.seriesId, ids))
				.then((ranked) =>
					ranked
						.filter((row) => row.position <= 2)
						.sort((left, right) => left.position - right.position),
				)
		: [];
	const links = ids.length
		? await db
				.select({
					seriesId: seriesSources.seriesId,
					sourceKey: sources.key,
					sourceName: sources.name,
				})
				.from(seriesSources)
				.innerJoin(sources, eq(seriesSources.sourceId, sources.id))
				.where(inArray(seriesSources.seriesId, ids))
		: [];
	const latestMap = new Map<string, CatalogChapter[]>();
	for (const chapter of latestChapterRows) {
		const list = latestMap.get(chapter.seriesId) ?? [];
		list.push({
			id: chapter.id,
			numberText: chapter.numberText,
			createdAt: toIso(chapter.createdAt ?? chapter.updatedAt),
		});
		latestMap.set(chapter.seriesId, list);
	}
	const sourceMap = new Map<string, CatalogSource[]>();
	for (const link of links) {
		const list = sourceMap.get(link.seriesId) ?? [];
		list.push({ key: link.sourceKey, name: link.sourceName });
		sourceMap.set(link.seriesId, list);
	}
	return {
		items: pageRows.map((row) =>
			seriesCardResponse(row, {
				latestChapters: latestMap.get(row.id) ?? [],
				sources: sourceMap.get(row.id) ?? [],
			}),
		),
		page: opts.page,
		pageSize: opts.pageSize,
		total: totals[0]?.total ?? 0,
		hasMore,
	};
}

export async function visibleSeriesForRoute(
	db: Database,
	workspaceId: string,
	identifier: string,
) {
	const normalizedSlug = normalizeTitle(identifier.replace(/-/g, " "));
	const rows = await db
		.select(seriesDetailSelection)
		.from(series)
		.where(
			and(
				eq(series.workspaceId, workspaceId),
				eq(series.isVisible, true),
				or(
					eq(series.id, identifier),
					eq(series.normalizedTitle, normalizedSlug),
				),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

export type ChapterPageOptions = {
	page: number;
	pageSize: number;
	search?: string;
	sort?: "recent" | "oldest";
};

export type ChapterListItem = {
	chapter: {
		id: string;
		numberText: string;
		normalizedNumber: string;
		title: string | null;
		publishedAt: string | null;
		createdAt: string;
		sortNumber: number | null;
	};
	sources: Array<{
		key: string;
		thumbnailUrl: string | null;
		updatedAt: string;
	}>;
};

export async function getChapterPage(
	db: Database,
	seriesId: string,
	opts: ChapterPageOptions,
): Promise<{
	items: ChapterListItem[];
	page: number;
	pageSize: number;
	total: number;
	hasMore: boolean;
}> {
	const chapterSearch = (opts.search ?? "").trim().toLocaleLowerCase("id-ID");
	const filters = [eq(chapters.seriesId, seriesId)];
	if (chapterSearch)
		filters.push(ilike(chapters.numberText, `${chapterSearch}%`));
	const where = and(...filters);
	const rowsQuery = db
		.select({
			id: chapters.id,
			numberText: chapters.numberText,
			normalizedNumber: chapters.normalizedNumber,
			title: chapters.title,
			publishedAt: chapters.publishedAt,
			createdAt: chapters.createdAt,
			sortNumber: chapters.sortNumber,
		})
		.from(chapters)
		.where(where)
		.orderBy(
			...(opts.sort === "oldest"
				? [
						asc(chapters.sortNumber),
						asc(chapters.publishedAt),
						asc(chapters.updatedAt),
					]
				: [
						desc(chapters.sortNumber),
						desc(chapters.publishedAt),
						desc(chapters.updatedAt),
					]),
		)
		.limit(opts.pageSize + 1)
		.offset((opts.page - 1) * opts.pageSize);
	const totalsQuery = db.select({ count: count() }).from(chapters).where(where);
	const [heads, totals] = await Promise.all([rowsQuery, totalsQuery]);
	const hasMore = heads.length > opts.pageSize;
	const pageHeads = hasMore ? heads.slice(0, opts.pageSize) : heads;
	const chapterIds = pageHeads.map((chapter) => chapter.id);
	const sourceRows = chapterIds.length
		? await db
				.select({
					chapterId: chapterSources.chapterId,
					sourceKey: sources.key,
					thumbnailUrl: chapterSources.thumbnailUrl,
					updatedAt: chapterSources.updatedAt,
				})
				.from(chapterSources)
				.innerJoin(sources, eq(chapterSources.sourceId, sources.id))
				.where(inArray(chapterSources.chapterId, chapterIds))
		: [];
	const sourceMap = new Map<
		string,
		Array<{ key: string; thumbnailUrl: string | null; updatedAt: string }>
	>();
	for (const row of sourceRows) {
		const list = sourceMap.get(row.chapterId) ?? [];
		list.push({
			key: row.sourceKey,
			thumbnailUrl: row.thumbnailUrl,
			updatedAt: row.updatedAt.toISOString(),
		});
		sourceMap.set(row.chapterId, list);
	}
	return {
		items: pageHeads.map((chapter) => ({
			chapter: {
				id: chapter.id,
				numberText: chapter.numberText,
				normalizedNumber: chapter.normalizedNumber,
				title: chapter.title,
				publishedAt: toIso(chapter.publishedAt),
				createdAt: chapter.createdAt.toISOString(),
				sortNumber: chapter.sortNumber,
			},
			sources: sourceMap.get(chapter.id) ?? [],
		})),
		page: opts.page,
		pageSize: opts.pageSize,
		total: totals[0]?.count ?? 0,
		hasMore,
	};
}

/** Chapter page for a visible series identifier (id or slug); null when the
 *  series is missing/hidden. Thin wrapper so routes stay logic-free. */
export async function getVisibleChapterPage(
	db: Database,
	workspaceId: string,
	identifier: string,
	opts: ChapterPageOptions,
) {
	const row = await visibleSeriesForRoute(db, workspaceId, identifier);
	if (!row) return null;
	return getChapterPage(db, row.id, opts);
}

export async function getSeriesDetail(
	db: Database,
	workspaceId: string,
	identifier: string,
) {
	const row = await visibleSeriesForRoute(db, workspaceId, identifier);
	if (!row) return null;
	const [providerRows, chapterPage] = await Promise.all([
		db
			.select({
				id: seriesSources.id,
				sourceKey: sources.key,
				sourceName: sources.name,
				externalId: seriesSources.externalId,
				slug: seriesSources.slug,
				title: seriesSources.title,
			})
			.from(seriesSources)
			.innerJoin(sources, eq(seriesSources.sourceId, sources.id))
			.where(eq(seriesSources.seriesId, row.id)),
		getChapterPage(db, row.id, { page: 1, pageSize: 30 }),
	]);
	return {
		id: row.id,
		slug: seriesSlug(row.normalizedTitle),
		title: row.title,
		description: row.description,
		coverImageUrl: row.coverImageUrl,
		status: row.status,
		countryId: row.countryId,
		alternativeTitle: row.alternativeTitle,
		authors: parseJsonList(row.authorsJson),
		artists: parseJsonList(row.artistsJson),
		genres: parseJsonList(row.genresJson),
		formats: parseJsonList(row.formatsJson),
		comicType: row.comicType,
		viewCount: row.viewCount,
		rating: row.rating,
		bookmarkCount: row.bookmarkCount,
		popularityRank: row.popularityRank,
		isFeatured: row.isFeatured,
		isRecommended: row.isRecommended,
		updatedAt: row.updatedAt.toISOString(),
		sources: providerRows.map((link) => ({
			id: link.id,
			key: link.sourceKey,
			name: link.sourceName,
			externalId: link.externalId,
			slug: link.slug,
			title: link.title,
		})),
		chapters: chapterPage.items,
		chapterPagination: {
			total: chapterPage.total,
			hasMore: chapterPage.hasMore,
			pageSize: chapterPage.pageSize,
		},
	};
}

export type ChapterDetail = {
	id: string;
	numberText: string;
	normalizedNumber: string;
	title: string | null;
	seriesId: string;
	seriesTitle: string;
	seriesSlug: string;
	previousChapterId: string | null;
	previousChapterNumber: string | null;
	nextChapterId: string | null;
	nextChapterNumber: string | null;
	chapterCount: number;
	sources: Array<{ key: string; name: string; hasThumbnail: boolean }>;
};

export async function getChapterDetail(
	db: Database,
	workspaceId: string,
	chapterId: string,
): Promise<ChapterDetail | null> {
	const rows = await db
		.select({
			id: chapters.id,
			numberText: chapters.numberText,
			normalizedNumber: chapters.normalizedNumber,
			title: chapters.title,
			seriesId: series.id,
			seriesTitle: series.title,
			seriesNormalizedTitle: series.normalizedTitle,
		})
		.from(chapters)
		.innerJoin(series, eq(chapters.seriesId, series.id))
		.where(
			and(
				eq(chapters.id, chapterId),
				eq(series.workspaceId, workspaceId),
				eq(series.isVisible, true),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	const [links, siblings] = await Promise.all([
		db
			.select({
				sourceKey: sources.key,
				sourceName: sources.name,
				thumbnailUrl: chapterSources.thumbnailUrl,
			})
			.from(chapterSources)
			.innerJoin(sources, eq(chapterSources.sourceId, sources.id))
			.where(eq(chapterSources.chapterId, chapterId)),
		db
			.select({ id: chapters.id, normalizedNumber: chapters.normalizedNumber })
			.from(chapters)
			.where(eq(chapters.seriesId, row.seriesId))
			.orderBy(
				desc(chapters.sortNumber),
				desc(chapters.publishedAt),
				desc(chapters.updatedAt),
			),
	]);
	const index = siblings.findIndex((chapter) => chapter.id === chapterId);
	return {
		id: row.id,
		numberText: row.numberText,
		normalizedNumber: row.normalizedNumber,
		title: row.title,
		seriesId: row.seriesId,
		seriesTitle: row.seriesTitle,
		seriesSlug: seriesSlug(row.seriesNormalizedTitle),
		previousChapterId: siblings[index + 1]?.id ?? null,
		previousChapterNumber: siblings[index + 1]?.normalizedNumber ?? null,
		nextChapterId: index > 0 ? (siblings[index - 1]?.id ?? null) : null,
		nextChapterNumber:
			index > 0 ? (siblings[index - 1]?.normalizedNumber ?? null) : null,
		chapterCount: siblings.length,
		sources: links.map((link) => ({
			key: link.sourceKey,
			name: link.sourceName,
			hasThumbnail: Boolean(link.thumbnailUrl),
		})),
	};
}

export type ChapterPagesResult =
	| { error: "not-found" }
	| { error: "source-unavailable"; availableSources: string[] }
	| {
			source: string;
			availableSources: string[];
			partial?: boolean;
			pages: Array<{
				id: string;
				index: number;
				url: string;
				local: boolean;
				fallbackUrl?: string;
			}>;
	  };

/** Reader pages for the best-covered chapter source (XyMI "local" preference).
 *  A requested source that the chapter has no link for yields
 *  `source-unavailable` (caller maps to 400) instead of a generic 404. */
export async function getChapterPages(
	db: Database,
	workspaceId: string,
	chapterId: string,
	requestedSource?: string,
): Promise<ChapterPagesResult> {
	const links = await db
		.select({ chapterSourceId: chapterSources.id, sourceKey: sources.key })
		.from(chapterSources)
		.innerJoin(sources, eq(chapterSources.sourceId, sources.id))
		.where(
			and(
				eq(chapterSources.chapterId, chapterId),
				eq(sources.workspaceId, workspaceId),
			),
		);
	if (links.length === 0) return { error: "not-found" };
	const availableSources = [...new Set(links.map((link) => link.sourceKey))];
	const first = links[0];
	if (!first) return { error: "not-found" };
	let selected = first;
	if (requestedSource) {
		const match = links.find((link) => link.sourceKey === requestedSource);
		if (!match) return { error: "source-unavailable", availableSources };
		selected = match;
	} else {
		// Prefer the source with the most stored blobs, like XyMI's coverage pick.
		const coverage = await db
			.select({
				chapterSourceId: chapterPages.chapterSourceId,
				storedCount: sql<number>`count(${chapterPages.blobSha256})`.as(
					"stored_count",
				),
				totalCount: count().as("total_count"),
			})
			.from(chapterPages)
			.where(
				and(
					eq(chapterPages.isActive, true),
					inArray(
						chapterPages.chapterSourceId,
						links.map((link) => link.chapterSourceId),
					),
				),
			)
			.groupBy(chapterPages.chapterSourceId);
		const best = coverage.sort(
			(left, right) => right.storedCount - left.storedCount,
		)[0];
		if (best)
			selected =
				links.find((link) => link.chapterSourceId === best.chapterSourceId) ??
				selected;
	}
	const pages = await db
		.select({
			id: chapterPages.id,
			pageIndex: chapterPages.pageIndex,
			blobSha256: chapterPages.blobSha256,
			updatedAt: chapterPages.updatedAt,
		})
		.from(chapterPages)
		.where(
			and(
				eq(chapterPages.chapterSourceId, selected.chapterSourceId),
				eq(chapterPages.isActive, true),
			),
		)
		.orderBy(asc(chapterPages.pageIndex));
	const mapped = pages.map((page) => {
		const local = Boolean(page.blobSha256);
		return {
			id: page.id,
			index: page.pageIndex,
			url: local
				? `/api/v1/images/${page.id}?v=${encodeURIComponent(page.blobSha256 ?? page.updatedAt.toISOString())}`
				: `/api/v1/images/source/${page.id}?v=${encodeURIComponent(page.updatedAt.toISOString())}`,
			local,
			...(local
				? {
						fallbackUrl: `/api/v1/images/source/${page.id}?v=${encodeURIComponent(page.updatedAt.toISOString())}`,
					}
				: {}),
		};
	});
	const allLocal = pages.length > 0 && pages.every((page) => page.blobSha256);
	return {
		source: allLocal ? "minio" : selected.sourceKey,
		availableSources,
		...(allLocal ? {} : { partial: pages.some((page) => !page.blobSha256) }),
		pages: mapped,
	};
}

// ---------------------------------------------------------------------------
// Route-level reads moved out of `routes/comic.ts` (thin handlers)
// ---------------------------------------------------------------------------

export async function listWorkspaces(db: Database) {
	return db
		.select({
			id: workspaces.id,
			slug: workspaces.slug,
			name: workspaces.name,
			enabled: workspaces.enabled,
		})
		.from(workspaces);
}

export async function listComicSources(db: Database) {
	return db
		.select({
			id: sources.id,
			key: sources.key,
			name: sources.name,
			baseUrl: sources.baseUrl,
			prefix: sources.prefix,
			requestDelayMs: sources.requestDelayMs,
			enabled: sources.enabled,
		})
		.from(sources)
		.where(eq(sources.workspaceId, COMIC_WORKSPACE_ID));
}

export async function getComicImageSourceOptions(db: Database) {
	const rows = await db
		.select({ key: sources.key, name: sources.name })
		.from(sources)
		.where(eq(sources.workspaceId, COMIC_WORKSPACE_ID))
		.orderBy(asc(sources.name), asc(sources.key));
	return [
		{ key: "local", name: "MIFE" },
		...rows.filter((row) => row.key !== "local"),
	];
}

export async function readUserPrefs(
	db: Database,
	userId: string | null,
	keys: string[],
) {
	if (!userId || keys.length === 0) return {};
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
		rows.map((row) => [row.key, parseJsonValue(row.value)]),
	) as Record<string, unknown>;
}

export async function listGenreKeys(
	db: Database,
	workspace: string | undefined,
) {
	const rows =
		workspace === "anime"
			? await db
					.selectDistinct({ key: animeSeriesGenres.genreKey })
					.from(animeSeriesGenres)
					.orderBy(animeSeriesGenres.genreKey)
			: await db
					.selectDistinct({ key: seriesGenres.genreKey })
					.from(seriesGenres)
					.orderBy(seriesGenres.genreKey);
	return { genres: rows.map((row) => row.key) };
}

export async function getHeroItems(db: Database, workspaceId: string) {
	const visible = and(
		eq(series.workspaceId, workspaceId),
		eq(series.isVisible, true),
	);
	const [recentRows, mostViewed, chapterTotals] = await Promise.all([
		db
			.select(seriesDetailSelection)
			.from(series)
			.where(visible)
			.orderBy(desc(series.createdAt), desc(series.latestChapterAt))
			.limit(3),
		db
			.select(seriesDetailSelection)
			.from(series)
			.where(visible)
			.orderBy(desc(series.viewCount), desc(series.latestChapterAt))
			.limit(2),
		db
			.select({ seriesId: chapters.seriesId, total: count() })
			.from(chapters)
			.innerJoin(series, eq(chapters.seriesId, series.id))
			.where(visible)
			.groupBy(chapters.seriesId)
			.orderBy(desc(count()))
			.limit(1),
	]);
	const featured: Array<{
		row: (typeof recentRows)[number];
		featureType: HeroFeatureType;
		featureLabel: string;
		chapterCount?: number;
	}> = [];
	for (const row of recentRows)
		featured.push({
			row,
			featureType: "new",
			featureLabel: "Rilis terbaru",
		});
	for (const row of mostViewed) {
		const existing = featured.find((item) => item.row.id === row.id);
		if (existing) existing.featureLabel += " · Views terbanyak";
		else
			featured.push({
				row,
				featureType: "views",
				featureLabel: "Views terbanyak",
			});
	}
	const top = chapterTotals[0];
	if (top) {
		const rows = await db
			.select(seriesDetailSelection)
			.from(series)
			.where(eq(series.id, top.seriesId))
			.limit(1);
		const row = rows[0];
		if (row) {
			const existing = featured.find((item) => item.row.id === row.id);
			if (existing) {
				existing.featureLabel += " · Chapter terbanyak";
				existing.chapterCount = top.total;
			} else
				featured.push({
					row,
					featureType: "chapters",
					featureLabel: "Chapter terbanyak",
					chapterCount: top.total,
				});
		}
	}
	const ids = featured.map((item) => item.row.id);
	const chapterRows = ids.length
		? await db
				.select({
					seriesId: chapters.seriesId,
					id: chapters.id,
					numberText: chapters.numberText,
					createdAt: chapters.createdAt,
					updatedAt: chapters.updatedAt,
				})
				.from(chapters)
				.where(inArray(chapters.seriesId, ids))
				.orderBy(desc(chapters.sortNumber))
		: [];
	const latestBySeries = new Map<string, CatalogChapter>();
	for (const chapter of chapterRows)
		if (!latestBySeries.has(chapter.seriesId))
			latestBySeries.set(chapter.seriesId, {
				id: chapter.id,
				numberText: chapter.numberText,
				createdAt: toIso(chapter.createdAt ?? chapter.updatedAt),
			});
	return {
		items: featured.map((item) => {
			const latest = latestBySeries.get(item.row.id);
			return seriesHeroResponse(item.row, {
				latestChapters: latest ? [latest] : [],
				featureType: item.featureType,
				featureLabel: item.featureLabel,
				chapterCount: item.chapterCount ?? null,
			});
		}),
	};
}

export async function getSeriesCoverBlob(db: Database, seriesId: string) {
	const assets = await db
		.select({
			objectKey: imageBlobs.objectKey,
			contentType: imageBlobs.contentType,
		})
		.from(mediaAssets)
		.leftJoin(imageBlobs, eq(mediaAssets.blobSha256, imageBlobs.sha256))
		.where(
			and(
				eq(mediaAssets.assetType, "comic_cover"),
				eq(mediaAssets.ownerType, "series"),
				eq(mediaAssets.ownerId, seriesId),
			),
		)
		.limit(1);
	const blob = assets[0];
	if (!blob?.objectKey || !blob?.contentType) return null;
	return { objectKey: blob.objectKey, contentType: blob.contentType };
}

/** Chapter id lookup for `/chapters/by-slug/:seriesSlug/:chapterSlug`.
 *  The slug's `chapter-` prefix is stripped, then the remainder is normalized
 *  (comma decimals, `ch`/`ep` prefixes) before matching `normalizedNumber`. */
export async function findChapterIdBySlug(
	db: Database,
	workspaceId: string,
	seriesSlugParam: string,
	chapterSlug: string,
) {
	const normalizedSeriesSlug = normalizeTitle(
		seriesSlugParam.replace(/-/g, " "),
	);
	const chapterNumber = normalizeChapterNumber(
		chapterSlug.replace(/^chapter-/i, ""),
	);
	const matches = await db
		.select({ id: chapters.id })
		.from(chapters)
		.innerJoin(series, eq(chapters.seriesId, series.id))
		.where(
			and(
				eq(series.workspaceId, workspaceId),
				eq(series.isVisible, true),
				eq(series.normalizedTitle, normalizedSeriesSlug),
				eq(chapters.normalizedNumber, chapterNumber),
			),
		)
		.limit(1);
	return matches[0]?.id ?? null;
}

export async function getChapterThumbnailUrl(
	db: Database,
	workspaceId: string,
	chapterId: string,
) {
	const rows = await db
		.select({ thumbnailUrl: chapterSources.thumbnailUrl })
		.from(chapterSources)
		.innerJoin(sources, eq(chapterSources.sourceId, sources.id))
		.where(
			and(
				eq(chapterSources.chapterId, chapterId),
				eq(sources.workspaceId, workspaceId),
			),
		);
	return rows.find((row) => row.thumbnailUrl)?.thumbnailUrl ?? null;
}

/** Visible series id owning a chapter; null when the chapter is missing or
 *  outside a visible series (caller maps to 404). */
export async function getVisibleChapterSeriesId(
	db: Database,
	workspaceId: string,
	chapterId: string,
) {
	const rows = await db
		.select({ id: series.id })
		.from(chapters)
		.innerJoin(series, eq(chapters.seriesId, series.id))
		.where(
			and(
				eq(chapters.id, chapterId),
				eq(series.workspaceId, workspaceId),
				eq(series.isVisible, true),
			),
		)
		.limit(1);
	return rows[0]?.id ?? null;
}

export async function getSourcePageExternalUrl(db: Database, pageId: string) {
	const rows = await db
		.select({ externalUrl: chapterPages.externalUrl })
		.from(chapterPages)
		.where(and(eq(chapterPages.id, pageId), eq(chapterPages.isActive, true)))
		.limit(1);
	return rows[0]?.externalUrl ?? null;
}

export async function getStoredPageBlob(db: Database, pageId: string) {
	const rows = await db
		.select({
			objectKey: imageBlobs.objectKey,
			contentType: imageBlobs.contentType,
		})
		.from(chapterPages)
		.leftJoin(imageBlobs, eq(chapterPages.blobSha256, imageBlobs.sha256))
		.where(and(eq(chapterPages.id, pageId), eq(chapterPages.isActive, true)))
		.limit(1);
	const blob = rows[0];
	if (!blob?.objectKey || !blob?.contentType) return null;
	return { objectKey: blob.objectKey, contentType: blob.contentType };
}

// ---------------------------------------------------------------------------
// Super Komik reads (response shapes preserved, queries projected)
// ---------------------------------------------------------------------------

export async function listSuperKomikCatalog(
	db: Database,
	opts: { page: number; pageSize: number; q?: string },
) {
	const listOpts: SeriesListOptions = {
		workspaceId: SUPERKOMIK_WORKSPACE_ID,
		page: opts.page,
		pageSize: opts.pageSize,
		q: opts.q,
		source: SUPERKOMIK_SOURCE_KEY,
		sort: "recent",
	};
	const where = buildSeriesFilters(db, listOpts);
	const rowsQuery = db
		.select(seriesDetailSelection)
		.from(series)
		.where(where)
		.orderBy(...seriesSortOrder("recent"))
		.limit(opts.pageSize + 1)
		.offset((opts.page - 1) * opts.pageSize);
	const totalsQuery = db.select({ total: count() }).from(series).where(where);
	const [rows, totals] = await Promise.all([rowsQuery, totalsQuery]);
	const hasMore = rows.length > opts.pageSize;
	const pageRows = hasMore ? rows.slice(0, opts.pageSize) : rows;
	const total = totals[0]?.total ?? 0;
	return {
		items: pageRows.map((row) => ({
			id: row.id,
			title: row.title,
			alternativeTitle: row.alternativeTitle,
			description: row.description,
			coverImageUrl: row.coverImageUrl,
			status: row.status,
			latestChapterNumber: row.latestChapterNumber,
			latestChapterAt: toIso(row.latestChapterAt),
			authors: parseJsonList(row.authorsJson),
			artists: parseJsonList(row.artistsJson),
			genres: parseJsonList(row.genresJson),
			formats: parseJsonList(row.formatsJson),
			rating: row.rating,
			viewCount: row.viewCount,
		})),
		page: opts.page,
		pageSize: opts.pageSize,
		total,
		totalRecords: total,
		totalPages: Math.ceil(total / opts.pageSize),
		hasMore,
	};
}

export async function getSuperKomikSeriesPage(
	db: Database,
	seriesId: string,
	opts: { page: number; pageSize: number },
) {
	const row = await visibleSeriesForRoute(
		db,
		SUPERKOMIK_WORKSPACE_ID,
		seriesId,
	);
	if (!row) return null;
	const chapterPage = await getChapterPage(db, row.id, {
		page: opts.page,
		pageSize: opts.pageSize,
		sort: "recent",
	});
	const chapterIds = chapterPage.items.map((item) => item.chapter.id);
	const thumbRows = chapterIds.length
		? await db
				.select({
					chapterId: chapterSources.chapterId,
					thumbnailUrl: chapterSources.thumbnailUrl,
				})
				.from(chapterSources)
				.innerJoin(sources, eq(chapterSources.sourceId, sources.id))
				.where(
					and(
						inArray(chapterSources.chapterId, chapterIds),
						eq(sources.workspaceId, SUPERKOMIK_WORKSPACE_ID),
						eq(sources.key, SUPERKOMIK_SOURCE_KEY),
					),
				)
		: [];
	const thumbByChapter = new Map(
		thumbRows
			.filter((thumb) => thumb.thumbnailUrl)
			.map((thumb) => [thumb.chapterId, thumb.thumbnailUrl as string]),
	);
	const bannerRows = await db
		.select({ bannerUrl: seriesSources.bannerUrl })
		.from(seriesSources)
		.innerJoin(sources, eq(seriesSources.sourceId, sources.id))
		.where(
			and(
				eq(seriesSources.seriesId, row.id),
				eq(sources.workspaceId, SUPERKOMIK_WORKSPACE_ID),
				eq(sources.key, SUPERKOMIK_SOURCE_KEY),
			),
		)
		.limit(1);
	return {
		series: {
			id: row.id,
			title: row.title,
			alternativeTitle: row.alternativeTitle,
			description: row.description,
			coverImageUrl: row.coverImageUrl,
			bannerUrl: bannerRows[0]?.bannerUrl ?? null,
			status: row.status,
			authors: parseJsonList(row.authorsJson),
			artists: parseJsonList(row.artistsJson),
			genres: parseJsonList(row.genresJson),
			formats: parseJsonList(row.formatsJson),
			rating: row.rating,
			viewCount: row.viewCount,
		},
		chapters: chapterPage.items.map((item) => ({
			id: item.chapter.id,
			numberText: item.chapter.numberText,
			title: item.chapter.title,
			publishedAt: item.chapter.publishedAt,
			thumbnailUrl: thumbByChapter.get(item.chapter.id) ?? null,
		})),
		page: chapterPage.page,
		pageSize: chapterPage.pageSize,
		totalChapters: chapterPage.total,
		totalPages: Math.ceil(chapterPage.total / chapterPage.pageSize),
		hasMore: chapterPage.hasMore,
	};
}

export async function getSuperKomikChapterWithPages(
	db: Database,
	chapterId: string,
) {
	const detail = await getChapterDetail(db, SUPERKOMIK_WORKSPACE_ID, chapterId);
	if (!detail) return null;
	const pages = await db
		.select({ id: chapterPages.id, pageIndex: chapterPages.pageIndex })
		.from(chapterPages)
		.innerJoin(
			chapterSources,
			eq(chapterPages.chapterSourceId, chapterSources.id),
		)
		.innerJoin(sources, eq(chapterSources.sourceId, sources.id))
		.where(
			and(
				eq(chapterSources.chapterId, chapterId),
				eq(chapterPages.isActive, true),
				eq(sources.workspaceId, SUPERKOMIK_WORKSPACE_ID),
				eq(sources.key, SUPERKOMIK_SOURCE_KEY),
			),
		)
		.orderBy(asc(chapterPages.pageIndex));
	return {
		series: { id: detail.seriesId, title: detail.seriesTitle },
		chapter: {
			id: detail.id,
			numberText: detail.numberText,
			title: detail.title,
		},
		previousChapterId: detail.previousChapterId,
		nextChapterId: detail.nextChapterId,
		pages: pages.map((page) => ({
			id: page.id,
			pageIndex: page.pageIndex,
			url: `/api/v1/super-komik/media/pages/${page.id}`,
		})),
	};
}

export type SuperKomikMediaAsset = {
	blob: { objectKey: string; contentType: string } | null;
	fallbackUrl: string | null;
};

export async function getSuperKomikCoverAsset(
	db: Database,
	seriesId: string,
): Promise<SuperKomikMediaAsset | null> {
	const rows = await db
		.select({
			coverImageUrl: series.coverImageUrl,
			externalUrl: mediaAssets.externalUrl,
			objectKey: imageBlobs.objectKey,
			contentType: imageBlobs.contentType,
		})
		.from(series)
		.innerJoin(seriesSources, eq(seriesSources.seriesId, series.id))
		.innerJoin(sources, eq(seriesSources.sourceId, sources.id))
		.leftJoin(
			mediaAssets,
			and(
				eq(mediaAssets.assetType, "comic_cover"),
				eq(mediaAssets.ownerType, "series"),
				eq(mediaAssets.ownerId, series.id),
			),
		)
		.leftJoin(imageBlobs, eq(mediaAssets.blobSha256, imageBlobs.sha256))
		.where(
			and(
				eq(series.id, seriesId),
				eq(series.workspaceId, SUPERKOMIK_WORKSPACE_ID),
				eq(sources.workspaceId, SUPERKOMIK_WORKSPACE_ID),
				eq(sources.key, SUPERKOMIK_SOURCE_KEY),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return {
		blob:
			row.objectKey && row.contentType
				? { objectKey: row.objectKey, contentType: row.contentType }
				: null,
		fallbackUrl: row.externalUrl ?? row.coverImageUrl,
	};
}

export async function getSuperKomikBannerAsset(
	db: Database,
	seriesId: string,
): Promise<SuperKomikMediaAsset | null> {
	const rows = await db
		.select({
			bannerUrl: seriesSources.bannerUrl,
			externalUrl: mediaAssets.externalUrl,
			objectKey: imageBlobs.objectKey,
			contentType: imageBlobs.contentType,
		})
		.from(series)
		.innerJoin(seriesSources, eq(seriesSources.seriesId, series.id))
		.innerJoin(sources, eq(seriesSources.sourceId, sources.id))
		.leftJoin(
			mediaAssets,
			and(
				eq(mediaAssets.assetType, "comic_banner"),
				eq(mediaAssets.ownerType, "series_source"),
				eq(mediaAssets.ownerId, seriesSources.id),
			),
		)
		.leftJoin(imageBlobs, eq(mediaAssets.blobSha256, imageBlobs.sha256))
		.where(
			and(
				eq(series.id, seriesId),
				eq(series.workspaceId, SUPERKOMIK_WORKSPACE_ID),
				eq(sources.workspaceId, SUPERKOMIK_WORKSPACE_ID),
				eq(sources.key, SUPERKOMIK_SOURCE_KEY),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return {
		blob:
			row.objectKey && row.contentType
				? { objectKey: row.objectKey, contentType: row.contentType }
				: null,
		fallbackUrl: row.externalUrl ?? row.bannerUrl,
	};
}

export async function getSuperKomikChapterSourceThumbnail(
	db: Database,
	chapterSourceId: string,
) {
	const rows = await db
		.select({ thumbnailUrl: chapterSources.thumbnailUrl })
		.from(chapterSources)
		.innerJoin(chapters, eq(chapterSources.chapterId, chapters.id))
		.innerJoin(series, eq(chapters.seriesId, series.id))
		.innerJoin(sources, eq(chapterSources.sourceId, sources.id))
		.where(
			and(
				eq(chapterSources.id, chapterSourceId),
				eq(series.workspaceId, SUPERKOMIK_WORKSPACE_ID),
				eq(sources.workspaceId, SUPERKOMIK_WORKSPACE_ID),
				eq(sources.key, SUPERKOMIK_SOURCE_KEY),
			),
		)
		.limit(1);
	return rows[0]?.thumbnailUrl ?? null;
}

export async function getSuperKomikPageAsset(
	db: Database,
	pageId: string,
): Promise<SuperKomikMediaAsset | null> {
	const rows = await db
		.select({
			externalUrl: chapterPages.externalUrl,
			objectKey: imageBlobs.objectKey,
			contentType: imageBlobs.contentType,
		})
		.from(chapterPages)
		.innerJoin(
			chapterSources,
			eq(chapterPages.chapterSourceId, chapterSources.id),
		)
		.innerJoin(chapters, eq(chapterSources.chapterId, chapters.id))
		.innerJoin(series, eq(chapters.seriesId, series.id))
		.innerJoin(sources, eq(chapterSources.sourceId, sources.id))
		.leftJoin(imageBlobs, eq(chapterPages.blobSha256, imageBlobs.sha256))
		.where(
			and(
				eq(chapterPages.id, pageId),
				eq(chapterPages.isActive, true),
				eq(series.workspaceId, SUPERKOMIK_WORKSPACE_ID),
				eq(sources.workspaceId, SUPERKOMIK_WORKSPACE_ID),
				eq(sources.key, SUPERKOMIK_SOURCE_KEY),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return {
		blob:
			row.objectKey && row.contentType
				? { objectKey: row.objectKey, contentType: row.contentType }
				: null,
		fallbackUrl: row.externalUrl,
	};
}
