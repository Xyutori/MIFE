/**
 * Read-only comic routes, ported from XyMI `routes/mife.ts` and the read
 * endpoints of `routes/super-komik.ts` (single owner for both prefixes).
 *
 * Included (all GET, public):
 * - `/api/v1/health`, `/api/v1/workspaces`, `/api/v1/sources`,
 *   `/api/v1/settings` (read-only; writes live in `preferences.ts`)
 * - `/api/v1/library`, `/api/v1/library/hero`, `/api/v1/library/:id`,
 *   `/api/v1/library/:id/chapters`, `/api/v1/library/:id/cover`
 * - `/api/v1/chapters/by-slug/:seriesSlug/:chapterSlug`,
 *   `/api/v1/chapters/:id`, `/api/v1/chapters/:id/thumbnail`,
 *   `/api/v1/chapters/:id/pages`
 * - `/api/v1/images/:id` (S3 bytes), `/api/v1/images/source/:id` (redirect)
 * - `/api/v1/super-komik/access-check`, `/catalog`, `/series/:id`,
 *   `/chapters/:id`, `/media/series/:id/cover`, `/media/series/:id/banner`,
 *   `/media/chapter-sources/:id/thumbnail`, `/media/pages/:id`
 *
 * NOT ported (other lanes): PATCH sources/settings, archive
 * export/import, all `/scrapes` + `/jobs` + `/images/download` admin routes.
 *
 * All queries live in `../catalog/series.ts`; handlers below only validate
 * input, call catalog functions, and map results to HTTP responses.
 *
 * Deviations from XyMI are documented in `../catalog/series.ts`.
 */

import { Elysia, t } from "elysia";

import { cacheConfiguration, cacheRemember } from "../cache/index";
import {
	COMIC_WORKSPACE_ID,
	findChapterIdBySlug,
	getChapterDetail,
	getChapterPages,
	getChapterThumbnailUrl,
	getComicImageSourceOptions,
	getHeroItems,
	getSeriesCoverBlob,
	getSeriesDetail,
	getSourcePageExternalUrl,
	getStoredPageBlob,
	getSuperKomikBannerAsset,
	getSuperKomikChapterSourceThumbnail,
	getSuperKomikChapterWithPages,
	getSuperKomikCoverAsset,
	getSuperKomikPageAsset,
	getSuperKomikSeriesPage,
	getVisibleChapterPage,
	getVisibleChapterSeriesId,
	listComicSources,
	listGenreKeys,
	listSeries,
	listSuperKomikCatalog,
	listWorkspaces,
	readUserPrefs,
	SUPERKOMIK_WORKSPACE_ID,
	safeExternalUrl,
	visibleSeriesForRoute,
} from "../catalog/series";
import { auth, db, s3 } from "../services";
import {
	type ContentKind,
	getLocalViewCount,
	recordContentView,
} from "../visits/record";
import { getClientIp, isBot, visitorKey } from "../visits/visitor";

const PAGE_SIZE_MAX = 12;
const PAGE_SIZE_DEFAULT = 12;
const IMAGE_SOURCES_FALLBACK = ["local"];

/** Rate-limit in-memory per IP: 60 hit/menit, sweep tiap panggil. */
const VIEW_RATE_LIMIT = 60;
const VIEW_RATE_WINDOW_MS = 60_000;
const viewRateBuckets = new Map<string, { count: number; resetAt: number }>();

function isViewRateLimited(ip: string, now = Date.now()): boolean {
	for (const [key, bucket] of viewRateBuckets) {
		if (bucket.resetAt <= now) viewRateBuckets.delete(key);
	}
	const bucket = viewRateBuckets.get(ip);
	if (!bucket || bucket.resetAt <= now) {
		viewRateBuckets.set(ip, { count: 1, resetAt: now + VIEW_RATE_WINDOW_MS });
		return false;
	}
	bucket.count += 1;
	return bucket.count > VIEW_RATE_LIMIT;
}

function clampNumber(value: string | undefined, fallback: number, max: number) {
	const parsed = Number(value);
	return Number.isFinite(parsed)
		? Math.max(1, Math.min(max, Math.floor(parsed)))
		: fallback;
}

function clampPageSize(value: string | undefined) {
	return clampNumber(value, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX);
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

type RouteSet = {
	headers: Record<string, string | number>;
	status?: number | string;
};

async function serveStoredBytes(
	objectKey: string,
	contentType: string,
	cacheControl: string,
	set: RouteSet,
) {
	try {
		const bytes = await s3.getObjectBytes(objectKey);
		set.headers["content-type"] = contentType;
		set.headers["cache-control"] = cacheControl;
		return new Response(bytes);
	} catch {
		set.status = 502;
		return { error: "Gagal membaca media dari penyimpanan." };
	}
}

function redirectExternal(
	url: string | null,
	set: RouteSet,
	missingMessage: string,
) {
	const safe = safeExternalUrl(url);
	if (!safe) {
		set.status = 404;
		return { error: missingMessage };
	}
	set.status = 302;
	set.headers.location = safe;
	set.headers["cache-control"] = "public, max-age=600";
	return;
}

export const comicRoutes = new Elysia({ name: "comic-routes" })
	.get("/api/v1/health", () => ({ status: "ok", workspace: "Comic" }))
	.get("/api/v1/workspaces", async () => listWorkspaces(db))
	.get("/api/v1/sources", async () => listComicSources(db))
	.get("/api/v1/settings", async ({ request }) => {
		const imageSources = await cacheRemember(
			"comic:image-source-options",
			() => getComicImageSourceOptions(db),
			300,
		);
		const userId = await resolveUserId(request);
		const personal = await readUserPrefs(db, userId, [
			"comic.paginationMode",
			"comic.pageSize",
			"comic.enabledImageSources",
		]);
		const enabled = Array.isArray(personal["comic.enabledImageSources"])
			? (personal["comic.enabledImageSources"] as string[]).filter((key) =>
					imageSources.some((source) => source.key === key),
				)
			: IMAGE_SOURCES_FALLBACK;
		return {
			settings: {
				paginationMode:
					personal["comic.paginationMode"] === "scroll" ? "scroll" : "numbered",
				pageSize: clampPageSize(String(personal["comic.pageSize"] ?? "")),
				enabledImageSources:
					enabled.length > 0 ? enabled : IMAGE_SOURCES_FALLBACK,
			},
			imageSources,
			cache: cacheConfiguration(),
		};
	})
	.get(
		"/api/v1/genres",
		async ({ query }) => listGenreKeys(db, query.workspace),
		{
			query: t.Object({
				workspace: t.Optional(
					t.Union([t.Literal("comic"), t.Literal("anime")]),
				),
			}),
		},
	)
	.get("/api/v1/library", async ({ query }) => {
		const page = clampNumber(query.page, 1, 1_000_000);
		const pageSize = clampPageSize(query.pageSize);
		const cacheKey = `comic:library:v3:${JSON.stringify({
			page,
			pageSize,
			q: query.q ?? "",
			genre: query.genre ?? "",
			status: query.status ?? "",
			source: query.source ?? "",
			country: query.country ?? "",
			type: query.type ?? "",
			sort: query.sort ?? "recent",
			hidden: query.includeHidden ?? "",
		})}`;
		return cacheRemember(
			cacheKey,
			() =>
				listSeries(db, {
					workspaceId: COMIC_WORKSPACE_ID,
					page,
					pageSize,
					q: query.q,
					genre: query.genre,
					status: query.status,
					source: query.source,
					country: query.country,
					type: query.type,
					sort: query.sort === "title" ? "title" : "recent",
					includeHidden: query.includeHidden === "true",
				}),
			120,
		);
	})
	.get("/api/v1/library/hero", async () =>
		cacheRemember(
			"comic:library:hero:v2",
			() => getHeroItems(db, COMIC_WORKSPACE_ID),
			300,
		),
	)
	.get(
		"/api/v1/library/:id",
		async ({ params, set }) => {
			const detail = await cacheRemember(
				`comic:detail:v2:${params.id}`,
				() => getSeriesDetail(db, COMIC_WORKSPACE_ID, params.id),
				120,
			);
			if (!detail) {
				set.status = 404;
				return { error: "Komik tidak ditemukan" };
			}
			return detail;
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get(
		"/api/v1/library/:id/chapters",
		async ({ params, query, set }) => {
			const page = clampNumber(query.page, 1, 1_000_000);
			const pageSize = clampNumber(query.pageSize, 10, 100);
			const search = query.q?.trim().slice(0, 80) ?? "";
			const sort = query.sort === "oldest" ? "oldest" : "recent";
			const exists = await cacheRemember(
				`comic:visible:${params.id}`,
				async () =>
					(await visibleSeriesForRoute(db, COMIC_WORKSPACE_ID, params.id)) !==
					null,
				120,
			);
			if (!exists) {
				set.status = 404;
				return { error: "Komik tidak ditemukan" };
			}
			const result = await cacheRemember(
				`comic:chapters:${JSON.stringify({ id: params.id, page, pageSize, search, sort })}`,
				() =>
					getVisibleChapterPage(db, COMIC_WORKSPACE_ID, params.id, {
						page,
						pageSize,
						search,
						sort,
					}),
				120,
			);
			if (!result) {
				set.status = 404;
				return { error: "Komik tidak ditemukan" };
			}
			return result;
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({
				page: t.Optional(t.String()),
				pageSize: t.Optional(t.String()),
				q: t.Optional(t.String()),
				sort: t.Optional(t.String()),
			}),
		},
	)
	.get(
		"/api/v1/library/:id/cover",
		async ({ params, set }) => {
			const row = await visibleSeriesForRoute(
				db,
				COMIC_WORKSPACE_ID,
				params.id,
			);
			if (!row) {
				set.status = 404;
				return { error: "Sampul tidak tersedia" };
			}
			const blob = await getSeriesCoverBlob(db, row.id);
			if (blob)
				return serveStoredBytes(
					blob.objectKey,
					blob.contentType,
					"public, max-age=900, stale-while-revalidate=3600",
					set,
				);
			return redirectExternal(row.coverImageUrl, set, "Sampul tidak tersedia");
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get(
		"/api/v1/chapters/by-slug/:seriesSlug/:chapterSlug",
		async ({ params, set }) => {
			const chapterId = await findChapterIdBySlug(
				db,
				COMIC_WORKSPACE_ID,
				params.seriesSlug,
				params.chapterSlug,
			);
			const detail = chapterId
				? await getChapterDetail(db, COMIC_WORKSPACE_ID, chapterId)
				: null;
			if (!detail) {
				set.status = 404;
				return { error: "Chapter tidak ditemukan" };
			}
			return detail;
		},
		{ params: t.Object({ seriesSlug: t.String(), chapterSlug: t.String() }) },
	)
	.get(
		"/api/v1/chapters/:id",
		async ({ params, set }) => {
			const detail = await getChapterDetail(db, COMIC_WORKSPACE_ID, params.id);
			if (!detail) {
				set.status = 404;
				return { error: "Chapter tidak ditemukan" };
			}
			return detail;
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get(
		"/api/v1/chapters/:id/thumbnail",
		async ({ params, set }) => {
			const thumbnailUrl = await getChapterThumbnailUrl(
				db,
				COMIC_WORKSPACE_ID,
				params.id,
			);
			if (!thumbnailUrl) {
				set.status = 404;
				return { error: "Thumbnail chapter tidak tersedia" };
			}
			return redirectExternal(
				thumbnailUrl,
				set,
				"Thumbnail chapter tidak tersedia",
			);
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get(
		"/api/v1/chapters/:id/pages",
		async ({ params, query, set }) => {
			const requested = query.source?.trim() || undefined;
			const seriesId = await getVisibleChapterSeriesId(
				db,
				COMIC_WORKSPACE_ID,
				params.id,
			);
			if (!seriesId) {
				set.status = 404;
				return { error: "Chapter tidak ditemukan" };
			}
			const result = await getChapterPages(
				db,
				COMIC_WORKSPACE_ID,
				params.id,
				requested,
			);
			if ("error" in result) {
				if (result.error === "source-unavailable") {
					set.status = 400;
					return {
						code: "SOURCE_UNAVAILABLE",
						availableSources: result.availableSources,
					};
				}
				set.status = 404;
				return { error: "Chapter tidak ditemukan" };
			}
			return result;
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ source: t.Optional(t.String()) }),
		},
	)
	.get(
		"/api/v1/images/source/:id",
		async ({ params, set }) => {
			const externalUrl = await getSourcePageExternalUrl(db, params.id);
			if (!externalUrl) {
				set.status = 404;
				return { error: "Gambar sumber tidak ditemukan" };
			}
			return redirectExternal(
				externalUrl,
				set,
				"Gambar sumber tidak ditemukan",
			);
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get(
		"/api/v1/images/:id",
		async ({ params, set }) => {
			const blob = await getStoredPageBlob(db, params.id);
			if (!blob) {
				set.status = 404;
				return { error: "Gambar belum tersimpan di penyimpanan" };
			}
			return serveStoredBytes(
				blob.objectKey,
				blob.contentType,
				"private, max-age=31536000, immutable",
				set,
			);
		},
		{ params: t.Object({ id: t.String() }) },
	)
	// ---- Super Komik (read) ----
	.get("/api/v1/super-komik/access-check", () => ({
		allowed: true,
		workspace: SUPERKOMIK_WORKSPACE_ID,
	}))
	.get(
		"/api/v1/super-komik/catalog",
		async ({ query }) => {
			const page = clampNumber(query.page, 1, 1_000_000);
			const pageSize = clampNumber(query.pageSize, 24, 100);
			const q = (query.q ?? "").trim().slice(0, 120);
			return listSuperKomikCatalog(db, { page, pageSize, q });
		},
		{
			query: t.Object({
				page: t.Optional(t.String()),
				pageSize: t.Optional(t.String()),
				q: t.Optional(t.String()),
			}),
		},
	)
	.get(
		"/api/v1/super-komik/series/:id",
		async ({ params, query, set }) => {
			const page = clampNumber(query.page, 1, 1_000_000);
			const pageSize = clampNumber(query.pageSize, 10, 100);
			const result = await getSuperKomikSeriesPage(db, params.id, {
				page,
				pageSize,
			});
			if (!result) {
				set.status = 404;
				return { error: "Komik tidak ditemukan." };
			}
			return result;
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({
				page: t.Optional(t.String()),
				pageSize: t.Optional(t.String()),
			}),
		},
	)
	.get(
		"/api/v1/super-komik/chapters/:id",
		async ({ params, set }) => {
			const result = await getSuperKomikChapterWithPages(db, params.id);
			if (!result) {
				set.status = 404;
				return { error: "Chapter tidak ditemukan." };
			}
			return result;
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get(
		"/api/v1/super-komik/media/series/:id/cover",
		async ({ params, set }) => {
			const asset = await getSuperKomikCoverAsset(db, params.id);
			if (!asset) {
				set.status = 404;
				return { error: "Komik tidak ditemukan." };
			}
			if (asset.blob)
				return serveStoredBytes(
					asset.blob.objectKey,
					asset.blob.contentType,
					"private, no-store",
					set,
				);
			return redirectExternal(asset.fallbackUrl, set, "Media tidak tersedia.");
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get(
		"/api/v1/super-komik/media/series/:id/banner",
		async ({ params, set }) => {
			const asset = await getSuperKomikBannerAsset(db, params.id);
			if (!asset) {
				set.status = 404;
				return { error: "Komik tidak ditemukan." };
			}
			if (asset.blob)
				return serveStoredBytes(
					asset.blob.objectKey,
					asset.blob.contentType,
					"private, no-store",
					set,
				);
			return redirectExternal(asset.fallbackUrl, set, "Media tidak tersedia.");
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get(
		"/api/v1/super-komik/media/chapter-sources/:id/thumbnail",
		async ({ params, set }) => {
			const thumbnailUrl = await getSuperKomikChapterSourceThumbnail(
				db,
				params.id,
			);
			if (!thumbnailUrl) {
				set.status = 404;
				return { error: "Thumbnail tidak ditemukan." };
			}
			return redirectExternal(thumbnailUrl, set, "Thumbnail tidak ditemukan.");
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get(
		"/api/v1/super-komik/media/pages/:id",
		async ({ params, set }) => {
			const asset = await getSuperKomikPageAsset(db, params.id);
			if (!asset) {
				set.status = 404;
				return { error: "Halaman tidak ditemukan." };
			}
			if (asset.blob)
				return serveStoredBytes(
					asset.blob.objectKey,
					asset.blob.contentType,
					"private, no-store",
					set,
				);
			return redirectExternal(asset.fallbackUrl, set, "Media tidak tersedia.");
		},
		{ params: t.Object({ id: t.String() }) },
	)
	// ---- Local view counter (lane VISITOR-SERVER) ----
	// Satu endpoint generik untuk komik/chapter/anime/episode. GET detail
	// sengaja TIDAK menghitung (cache 120 dtk + crawler); frontend memanggil
	// POST ini sekali per tayang. Bot-UA dan view duplikat harian tetap 200
	// dengan `{counted:false}`; id tak dikenal/hidden -> 404 generik.
	.post(
		"/api/v1/views",
		async ({ body, request, set }) => {
			const ip = getClientIp(request.headers);
			if (isViewRateLimited(ip)) {
				set.status = 429;
				return { error: "Terlalu banyak permintaan, coba lagi nanti." };
			}
			const kind = body.kind as ContentKind;
			const id = body.id.trim();
			if (!id || id.length > 256) {
				set.status = 404;
				return { error: "Konten tidak ditemukan" };
			}
			const userAgent = request.headers.get("user-agent") ?? "";
			if (isBot(userAgent)) {
				const current = await getLocalViewCount(db, kind, id);
				if (current === null) {
					set.status = 404;
					return { error: "Konten tidak ditemukan" };
				}
				return { counted: false, localViewCount: current };
			}
			const userId = await resolveUserId(request);
			const key = visitorKey({ userId, ip, ua: userAgent });
			const result = await recordContentView(db, {
				type: kind,
				id,
				visitorKey: key,
			});
			if (!result.found) {
				set.status = 404;
				return { error: "Konten tidak ditemukan" };
			}
			return { counted: result.counted, localViewCount: result.localViewCount };
		},
		{
			body: t.Object({
				kind: t.Union([
					t.Literal("comic"),
					t.Literal("chapter"),
					t.Literal("anime"),
					t.Literal("episode"),
				]),
				id: t.String({ minLength: 1, maxLength: 256 }),
			}),
		},
	);
