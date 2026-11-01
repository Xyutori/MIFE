/**
 * Shared anime-catalog read queries, ported from XyMI
 * `apps/server/src/routes/anime.ts` (read endpoints only).
 *
 * Image handling follows the same decision as `series.ts`: stored blobs are
 * served through the same-origin proxy
 * `/api/v1/anime/library/:id/thumbnail`; rows without a blob fall back to a
 * 302 redirect at the stored https URL. Episode playback links are returned
 * exactly as stored in `anime_episode_sources` (no live source refresh —
 * scraper/media jobs belong to another lane).
 */

import type { Database } from "@SyMi/db";
import {
	animeEpisodeSources,
	animeEpisodes,
	animeSeries,
	animeSeriesGenres,
	animeSources,
	animeThumbnails,
	imageBlobs,
	sources,
	userPreferences,
} from "@SyMi/db/schema/index";
import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	ne,
	type SQL,
	sql,
} from "drizzle-orm";

export function normalizeAnimeSearch(value: string) {
	return value
		.normalize("NFKD")
		.replace(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase("id-ID")
		.replace(/&/g, " and ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function parseJson(value: unknown) {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return {};
	}
}

type AnimeRow = Omit<
	typeof animeSeries.$inferSelect,
	"searchVector" | "metadataJson"
>;

/**
 * Tight card/detail projection: every column the web anime UI reads
 * (`AnimeListItem` / `AnimeDetail` / `AnimeEpisode`).
 * `search_vector` and `metadata_json` are never selected — no web view
 * consumes them, so they stay out of the wire payload entirely.
 */
export const animeCardColumns = {
	id: animeSeries.id,
	normalizedTitle: animeSeries.normalizedTitle,
	title: animeSeries.title,
	alternativeTitle: animeSeries.alternativeTitle,
	synopsis: animeSeries.synopsis,
	status: animeSeries.status,
	releaseYear: animeSeries.releaseYear,
	score: animeSeries.score,
	episodeCount: animeSeries.episodeCount,
	animeType: animeSeries.animeType,
	studio: animeSeries.studio,
	genresJson: animeSeries.genresJson,
	isVisible: animeSeries.isVisible,
	latestEpisodeNumber: animeSeries.latestEpisodeNumber,
	latestEpisodeAt: animeSeries.latestEpisodeAt,
	localViewCount: animeSeries.localViewCount,
	createdAt: animeSeries.createdAt,
	updatedAt: animeSeries.updatedAt,
} as const;

export function animeResponse(row: AnimeRow) {
	const { genresJson, ...data } = row;
	const genres = parseJson(genresJson);
	return {
		...data,
		genres: Array.isArray(genres)
			? genres.filter((item): item is string => typeof item === "string")
			: [],
	};
}

export type AnimeListOptions = {
	page: number;
	pageSize: number;
	q?: string;
	genre?: string;
	status?: string;
	sort?: "recent" | "title";
};

export async function listAnime(db: Database, opts: AnimeListOptions) {
	const search = normalizeAnimeSearch((opts.q ?? "").slice(0, 120));
	const filters: SQL[] = [eq(animeSeries.isVisible, true)];
	if (search) {
		const searchCond = and(or_fts(search));
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
					animeSeries.id,
					db
						.select({ animeId: animeSeriesGenres.animeId })
						.from(animeSeriesGenres)
						.where(inArray(animeSeriesGenres.genreKey, keys)),
				),
			);
		}
	}
	if (opts.status)
		filters.push(
			eq(sql`lower(${animeSeries.status})`, opts.status.toLowerCase()),
		);
	const where = and(...filters);
	const sortOrder =
		opts.sort === "title"
			? [asc(animeSeries.title), desc(animeSeries.updatedAt)]
			: [desc(animeSeries.latestEpisodeAt), desc(animeSeries.updatedAt)];
	const rowsQuery = db
		.select(animeCardColumns)
		.from(animeSeries)
		.where(where)
		.orderBy(...sortOrder)
		.limit(opts.pageSize + 1)
		.offset((opts.page - 1) * opts.pageSize);
	const totalsQuery = db
		.select({ count: count() })
		.from(animeSeries)
		.where(where);
	const [rows, totals] = await Promise.all([rowsQuery, totalsQuery]);
	const hasMore = rows.length > opts.pageSize;
	const items = hasMore ? rows.slice(0, opts.pageSize) : rows;
	const ids = items.map((row) => row.id);
	const [latestEpisodes, sourceRows, thumbnailMap] = await Promise.all([
		latestEpisodesFor(db, ids),
		ids.length
			? db
					.select({
						animeId: animeSources.animeId,
						key: sources.key,
						name: sources.name,
					})
					.from(animeSources)
					.innerJoin(sources, eq(animeSources.sourceId, sources.id))
					.where(inArray(animeSources.animeId, ids))
			: Promise.resolve([]),
		thumbnailsFor(db, ids),
	]);
	const latestMap = new Map<
		string,
		Array<{ id: string; numberText: string }>
	>();
	for (const episode of latestEpisodes) {
		const list = latestMap.get(episode.animeId) ?? [];
		list.push({ id: episode.id, numberText: episode.numberText });
		latestMap.set(episode.animeId, list);
	}
	const sourceMap = new Map<string, Array<{ key: string; name: string }>>();
	for (const source of sourceRows) {
		const list = sourceMap.get(source.animeId) ?? [];
		if (!list.some((item) => item.key === source.key))
			list.push({ key: source.key, name: source.name });
		sourceMap.set(source.animeId, list);
	}
	return {
		items: items.map((row) => ({
			...animeResponse(row),
			latestEpisodes: latestMap.get(row.id) ?? [],
			sources: sourceMap.get(row.id) ?? [],
			thumbnailSources: thumbnailMap.get(row.id) ?? [],
		})),
		page: opts.page,
		pageSize: opts.pageSize,
		total: totals[0]?.count ?? 0,
		hasMore,
	};
}

function or_fts(search: string) {
	return sql`${animeSeries.searchVector} @@ plainto_tsquery('simple', ${search}) OR ${animeSeries.title} ILIKE ${`%${search}%`}`;
}

async function latestEpisodesFor(db: Database, animeIds: string[]) {
	if (animeIds.length === 0) return [];
	const ranked = await db
		.select({
			animeId: animeEpisodes.animeId,
			id: animeEpisodes.id,
			numberText: animeEpisodes.numberText,
			position:
				sql<number>`row_number() over (partition by ${animeEpisodes.animeId} order by ${animeEpisodes.sortNumber} desc nulls last, ${animeEpisodes.updatedAt} desc)`.as(
					"position",
				),
		})
		.from(animeEpisodes)
		.where(inArray(animeEpisodes.animeId, animeIds));
	return ranked.filter((row) => row.position <= 2);
}

export type ThumbnailSource = {
	key: string;
	name: string;
	url: string;
	local: boolean;
};

export async function thumbnailsFor(
	db: Database,
	animeIds: string[],
): Promise<Map<string, ThumbnailSource[]>> {
	const grouped = new Map<string, ThumbnailSource[]>();
	if (animeIds.length === 0) return grouped;
	const rows = await db
		.select({
			animeId: animeSources.animeId,
			sourceUpdatedAt: animeSources.updatedAt,
			sourceKey: sources.key,
			sourceName: sources.name,
			posterUrl: animeSources.posterUrl,
			thumbnailUpdatedAt: animeThumbnails.updatedAt,
			blobSha256: animeThumbnails.blobSha256,
		})
		.from(animeSources)
		.innerJoin(sources, eq(animeSources.sourceId, sources.id))
		.leftJoin(
			animeThumbnails,
			and(
				eq(animeThumbnails.animeSourceId, animeSources.id),
				ne(animeThumbnails.downloadStatus, "stale"),
			),
		)
		.where(inArray(animeSources.animeId, animeIds))
		.orderBy(asc(sources.key));
	const seen = new Set<string>();
	for (const row of rows) {
		if (row.blobSha256 && !seen.has(`${row.animeId}:local`)) {
			seen.add(`${row.animeId}:local`);
			const list = grouped.get(row.animeId) ?? [];
			list.push({
				key: "local",
				name: "MIFE",
				url: `/api/v1/anime/library/${row.animeId}/thumbnail?source=local&v=${encodeURIComponent(row.blobSha256)}`,
				local: true,
			});
			grouped.set(row.animeId, list);
		}
		if (row.posterUrl && !seen.has(`${row.animeId}:${row.sourceKey}`)) {
			seen.add(`${row.animeId}:${row.sourceKey}`);
			const list = grouped.get(row.animeId) ?? [];
			list.push({
				key: row.sourceKey,
				name: row.sourceName,
				url: `/api/v1/anime/library/${row.animeId}/thumbnail?source=${encodeURIComponent(row.sourceKey)}&v=${encodeURIComponent(row.thumbnailUpdatedAt?.toISOString() ?? row.sourceUpdatedAt.toISOString())}`,
				local: false,
			});
			grouped.set(row.animeId, list);
		}
	}
	for (const list of grouped.values())
		list.sort((a, b) => Number(b.local) - Number(a.local));
	return grouped;
}

/** Tight episode projection: exactly what `AnimeEpisode` renders. */
const episodeCardColumns = {
	id: animeEpisodes.id,
	animeId: animeEpisodes.animeId,
	numberText: animeEpisodes.numberText,
	title: animeEpisodes.title,
	releasedAt: animeEpisodes.releasedAt,
	localViewCount: animeEpisodes.localViewCount,
} as const;

export async function getEpisodePage(
	db: Database,
	animeId: string,
	page: number,
	pageSize: number,
) {
	const headsQuery = db
		.select(episodeCardColumns)
		.from(animeEpisodes)
		.where(eq(animeEpisodes.animeId, animeId))
		.orderBy(desc(animeEpisodes.sortNumber), desc(animeEpisodes.updatedAt))
		.limit(pageSize + 1)
		.offset((page - 1) * pageSize);
	const totalsQuery = db
		.select({ count: count() })
		.from(animeEpisodes)
		.where(eq(animeEpisodes.animeId, animeId));
	const [heads, totals] = await Promise.all([headsQuery, totalsQuery]);
	const hasMore = heads.length > pageSize;
	const pageHeads = hasMore ? heads.slice(0, pageSize) : heads;
	const ids = pageHeads.map((row) => row.id);
	const sourceRows = ids.length
		? await db
				.select({
					episodeId: animeEpisodeSources.episodeId,
					id: animeEpisodeSources.id,
					externalId: animeEpisodeSources.externalId,
					sourceUrl: animeEpisodeSources.sourceUrl,
					streamLinksJson: animeEpisodeSources.streamLinksJson,
					downloadLinksJson: animeEpisodeSources.downloadLinksJson,
					sourceKey: sources.key,
					sourceName: sources.name,
				})
				.from(animeEpisodeSources)
				.innerJoin(sources, eq(animeEpisodeSources.sourceId, sources.id))
				.where(inArray(animeEpisodeSources.episodeId, ids))
		: [];
	const sourceMap = new Map<string, Array<Record<string, unknown>>>();
	for (const row of sourceRows) {
		const list = sourceMap.get(row.episodeId) ?? [];
		list.push({
			id: row.id,
			key: row.sourceKey,
			name: row.sourceName,
			externalId: row.externalId,
			sourceUrl: row.sourceUrl,
			streams: parseJson(row.streamLinksJson),
			downloads: parseJson(row.downloadLinksJson),
		});
		sourceMap.set(row.episodeId, list);
	}
	return {
		items: pageHeads.map((episode) => ({
			...episode,
			sources: sourceMap.get(episode.id) ?? [],
		})),
		page,
		pageSize,
		total: totals[0]?.count ?? 0,
		hasMore,
	};
}

export async function getAnimeDetail(db: Database, animeId: string) {
	const rows = await db
		.select(animeCardColumns)
		.from(animeSeries)
		.where(and(eq(animeSeries.id, animeId), eq(animeSeries.isVisible, true)))
		.limit(1);
	if (!rows[0]) return null;
	const [links, thumbnailMap, episodes] = await Promise.all([
		db
			.select({
				id: animeSources.id,
				externalId: animeSources.externalId,
				slug: animeSources.slug,
				sourceUrl: animeSources.sourceUrl,
				posterUrl: animeSources.posterUrl,
				sourceKey: sources.key,
				sourceName: sources.name,
			})
			.from(animeSources)
			.innerJoin(sources, eq(animeSources.sourceId, sources.id))
			.where(eq(animeSources.animeId, animeId)),
		thumbnailsFor(db, [animeId]),
		getEpisodePage(db, animeId, 1, 10),
	]);
	return {
		...animeResponse(rows[0]),
		sources: links.map((link) => ({
			id: link.id,
			key: link.sourceKey,
			name: link.sourceName,
			externalId: link.externalId,
			slug: link.slug,
			sourceUrl: link.sourceUrl,
			posterUrl: link.posterUrl,
		})),
		thumbnailSources: thumbnailMap.get(animeId) ?? [],
		episodes: episodes.items,
		episodePagination: {
			total: episodes.total,
			hasMore: episodes.hasMore,
			pageSize: episodes.pageSize,
		},
	};
}

/**
 * Anime source list for `/api/v1/anime/sources`.
 * Filtered to the anime workspace (comic sources live in another lane) and
 * projected to the columns the admin + settings UI read — never `config_json`
 * raw, it is parsed into `config`.
 */
export async function listAnimeSources(db: Database) {
	const rows = await db
		.select({
			id: sources.id,
			key: sources.key,
			name: sources.name,
			baseUrl: sources.baseUrl,
			prefix: sources.prefix,
			requestDelayMs: sources.requestDelayMs,
			enabled: sources.enabled,
			configJson: sources.configJson,
		})
		.from(sources)
		.where(eq(sources.workspaceId, "anime"))
		.orderBy(asc(sources.key));
	return rows.map(({ configJson, ...source }) => ({
		...source,
		supported: true,
		config: parseJson(configJson),
	}));
}

/** Visibility probe for the episodes route — projects only the id. */
export async function getVisibleAnimeId(
	db: Database,
	animeId: string,
): Promise<string | null> {
	const rows = await db
		.select({ id: animeSeries.id })
		.from(animeSeries)
		.where(and(eq(animeSeries.id, animeId), eq(animeSeries.isVisible, true)))
		.limit(1);
	return rows[0]?.id ?? null;
}

export type EpisodeMedia = {
	animeId: string;
	animeTitle: string;
	episode: {
		id: string;
		animeId: string;
		numberText: string;
		title: string | null;
		localViewCount: number;
	};
	nextEpisodeId: string | null;
	sources: Array<Record<string, unknown>>;
	downloads: Array<Record<string, unknown>>;
};

/**
 * Playback payload for `/api/v1/anime/episodes/:id/media`.
 * Tight projections: episode/series identity columns only, plus the two
 * stored link JSON blobs and the source key/name used for attribution.
 * Links are returned as stored (no live source refresh — scraper lane).
 */
export async function getEpisodeMedia(
	db: Database,
	episodeId: string,
	sourceKey?: string,
): Promise<EpisodeMedia | null> {
	const episodeRows = await db
		.select({
			id: animeEpisodes.id,
			animeId: animeEpisodes.animeId,
			numberText: animeEpisodes.numberText,
			title: animeEpisodes.title,
			localViewCount: animeEpisodes.localViewCount,
			seriesId: animeSeries.id,
			seriesTitle: animeSeries.title,
		})
		.from(animeEpisodes)
		.innerJoin(animeSeries, eq(animeEpisodes.animeId, animeSeries.id))
		.where(eq(animeEpisodes.id, episodeId))
		.limit(1);
	const head = episodeRows[0];
	if (!head) return null;
	const links = await db
		.select({
			streamLinksJson: animeEpisodeSources.streamLinksJson,
			downloadLinksJson: animeEpisodeSources.downloadLinksJson,
			sourceKey: sources.key,
			sourceName: sources.name,
		})
		.from(animeEpisodeSources)
		.innerJoin(sources, eq(animeEpisodeSources.sourceId, sources.id))
		.where(
			and(
				eq(animeEpisodeSources.episodeId, episodeId),
				eq(sources.enabled, true),
			),
		);
	const filtered = sourceKey
		? links.filter((row) => row.sourceKey === sourceKey)
		: links;
	const withAttribution = (values: unknown): Array<Record<string, unknown>> => {
		const list = parseJson(values);
		return (Array.isArray(list) ? list : []).map((item) => ({
			...(typeof item === "object" && item !== null ? item : {}),
		}));
	};
	/**
	 * Defensive stream normalization: `stream_links_json` is written by
	 * site-specific scrape code outside this lane, so entries may use
	 * alternate keys (`src`/`file`/`stream_url`, `mime`, `resolution`, ...).
	 * The web player only reads `{id,label,url,type,mimeType,quality}`
	 * (`EpisodeMediaSource`), so map defensively and drop entries without a
	 * URL instead of emitting unplayable items.
	 */
	const normalizeStreams = (
		values: unknown,
		sourceKey: string,
		sourceName: string,
	): Array<Record<string, unknown>> => {
		const list = parseJson(values);
		const entries = Array.isArray(list) ? list : [];
		const textOf = (value: unknown): string | null =>
			typeof value === "string" && value.trim().length > 0
				? value.trim()
				: null;
		const guessType = (
			url: string,
			mimeType: string | null,
			explicit: unknown,
		): "video" | "embed" => {
			if (explicit === "video" || explicit === "embed") return explicit;
			if (typeof explicit === "string") {
				const hint = explicit.toLowerCase();
				if (
					hint.includes("video") ||
					hint.includes("mp4") ||
					hint.includes("hls") ||
					hint === "m3u8"
				)
					return "video";
				if (hint.includes("embed") || hint.includes("iframe")) return "embed";
			}
			const haystack = `${url} ${mimeType ?? ""}`.toLowerCase();
			if (
				haystack.includes(".m3u8") ||
				haystack.includes("mpegurl") ||
				haystack.includes(".mp4") ||
				haystack.includes(".m4v") ||
				haystack.includes(".webm") ||
				haystack.includes(".ogv") ||
				haystack.includes("video/")
			)
				return "video";
			return "embed";
		};
		return entries.flatMap((entry, index) => {
			if (typeof entry === "string") {
				const url = entry.trim();
				if (!url) return [];
				return [
					{
						id: `${sourceKey}-${index}`,
						label: sourceName,
						url,
						type: guessType(url, null, null),
						mimeType: null,
						quality: null,
					},
				];
			}
			if (typeof entry !== "object" || entry === null) return [];
			const record = entry as Record<string, unknown>;
			const url =
				textOf(record.url) ??
				textOf(record.src) ??
				textOf(record.file) ??
				textOf(record.link) ??
				textOf(record.streamUrl) ??
				textOf(record.stream_url) ??
				textOf(record.embedUrl) ??
				textOf(record.embed_url);
			if (!url) return [];
			const mimeType =
				textOf(record.mimeType) ??
				textOf(record.mime_type) ??
				textOf(record.mime) ??
				textOf(record.contentType) ??
				textOf(record.content_type);
			const quality =
				textOf(record.quality) ??
				textOf(record.resolution) ??
				textOf(record.qualityLabel) ??
				textOf(record.label);
			const label =
				textOf(record.label) ??
				textOf(record.name) ??
				textOf(record.server) ??
				quality ??
				sourceName;
			return [
				{
					id: textOf(record.id) ?? `${sourceKey}-${index}`,
					label,
					url,
					type: guessType(url, mimeType, record.type),
					mimeType,
					quality,
				},
			];
		});
	};
	return {
		animeId: head.seriesId,
		animeTitle: head.seriesTitle,
		episode: {
			id: head.id,
			animeId: head.animeId,
			numberText: head.numberText,
			title: head.title,
			localViewCount: head.localViewCount ?? 0,
		},
		nextEpisodeId: await findNextEpisodeId(db, head.seriesId, episodeId),
		sources: filtered.flatMap((row) =>
			normalizeStreams(row.streamLinksJson, row.sourceKey, row.sourceName).map(
				(item) => ({
					...item,
					sourceKey: row.sourceKey,
					sourceName: row.sourceName,
				}),
			),
		),
		downloads: filtered.flatMap((row) =>
			withAttribution(row.downloadLinksJson).map((item) => ({
				...item,
				sourceKey: row.sourceKey,
				sourceName: row.sourceName,
			})),
		),
	};
}

async function findNextEpisodeId(
	db: Database,
	animeId: string,
	episodeId: string,
): Promise<string | null> {
	const nextRows = await db
		.select({ id: animeEpisodes.id })
		.from(animeEpisodes)
		.where(eq(animeEpisodes.animeId, animeId))
		.orderBy(desc(animeEpisodes.sortNumber), desc(animeEpisodes.updatedAt))
		.limit(100);
	const index = nextRows.findIndex((row) => row.id === episodeId);
	return index >= 0 ? (nextRows[index - 1]?.id ?? null) : null;
}

export type AnimeThumbnailResolution =
	| { kind: "blob"; objectKey: string; contentType: string }
	| { kind: "remote"; url: string }
	| { kind: "none" };

/**
 * Thumbnail picking for `/api/v1/anime/library/:id/thumbnail`.
 * Projects only poster/blob/source columns; the route turns the resolution
 * into bytes (S3) or a 302 redirect.
 */
export async function resolveAnimeThumbnail(
	db: Database,
	animeId: string,
	preferredSource?: string,
): Promise<AnimeThumbnailResolution> {
	const links = await db
		.select({ posterUrl: animeSources.posterUrl, sourceKey: sources.key })
		.from(animeSources)
		.innerJoin(sources, eq(animeSources.sourceId, sources.id))
		.where(eq(animeSources.animeId, animeId))
		.orderBy(asc(sources.key));
	if (!links.length) return { kind: "none" };
	const thumbs = await db
		.select({
			externalUrl: animeThumbnails.externalUrl,
			blobSha256: animeThumbnails.blobSha256,
			objectKey: imageBlobs.objectKey,
			contentType: imageBlobs.contentType,
			thumbnailUpdatedAt: animeThumbnails.updatedAt,
			sourceUpdatedAt: animeSources.updatedAt,
			sourceKey: sources.key,
		})
		.from(animeThumbnails)
		.innerJoin(animeSources, eq(animeThumbnails.animeSourceId, animeSources.id))
		.innerJoin(sources, eq(animeSources.sourceId, sources.id))
		.leftJoin(imageBlobs, eq(animeThumbnails.blobSha256, imageBlobs.sha256))
		.where(eq(animeSources.animeId, animeId));
	const preferred = preferredSource?.trim() || undefined;
	const candidates =
		preferred && preferred !== "local"
			? thumbs.filter((row) => row.sourceKey === preferred)
			: thumbs;
	const withBlob =
		candidates.find((row) => row.objectKey) ??
		thumbs.find((row) => row.objectKey);
	if (withBlob?.objectKey && withBlob.contentType)
		return {
			kind: "blob",
			objectKey: withBlob.objectKey,
			contentType: withBlob.contentType,
		};
	const remote =
		candidates[0]?.externalUrl ??
		thumbs[0]?.externalUrl ??
		links.find((row) => !preferred || row.sourceKey === preferred)?.posterUrl ??
		links[0]?.posterUrl;
	if (!remote) return { kind: "none" };
	return { kind: "remote", url: remote };
}

/**
 * Reader for the anime settings route — projects only the requested
 * `(userId, key)` preference pairs.
 */
export async function readAnimeUserPrefs(
	db: Database,
	userId: string | null,
	keys: string[],
): Promise<Record<string, unknown>> {
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
		rows.map((row) => [row.key, parseJson(row.value)]),
	) as Record<string, unknown>;
}
