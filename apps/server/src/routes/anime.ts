/**
 * Read-only anime routes, ported from XyMI `routes/anime.ts`.
 *
 * Included (all GET, public):
 * - `/api/v1/anime/sources`, `/api/v1/anime/settings` (read-only)
 * - `/api/v1/anime/library`, `/api/v1/anime/library/:id`,
 *   `/api/v1/anime/library/:id/episodes`, `/api/v1/anime/episodes/:id/media`,
 *   `/api/v1/anime/library/:id/thumbnail`
 *
 * NOT ported (other lanes): PATCH sources/settings, archive export/import,
 * all `/scrapes` job routes.
 *
 * Deviations from XyMI:
 * - `sources[].supported` is always `true` for enabled sources — MIFE has no
 *   source-capability registry lane yet.
 * - `/episodes/:id/media` returns stored `streamLinksJson`/`downloadLinksJson`
 *   as-is (no live source refresh, no direct-media resolution); `nextEpisodeId`
 *   is derived from sort order.
 * - Thumbnails serve S3 bytes when a blob exists, else 302 redirect to the
 *   stored poster URL (see `../catalog/series.ts` header for the rationale).
 *
 * This file stays thin: validation + cache + HTTP mapping only. All queries
 * live in `../catalog/anime.ts`.
 */

import { Elysia, t } from "elysia";

import { cacheConfiguration, cacheRemember } from "../cache/index";
import {
	getAnimeDetail,
	getEpisodeMedia,
	getEpisodePage,
	getVisibleAnimeId,
	listAnime,
	listAnimeSources,
	readAnimeUserPrefs,
	resolveAnimeThumbnail,
} from "../catalog/anime";
import { safeExternalUrl } from "../catalog/series";
import { auth, db, s3 } from "../services";

const PAGE_SIZE_MAX = 12;
const PAGE_SIZE_DEFAULT = 12;

function clamp(value: string | undefined, fallback: number, max: number) {
	const parsed = Number(value);
	return Number.isFinite(parsed)
		? Math.max(1, Math.min(max, Math.floor(parsed)))
		: fallback;
}

function clampPageSize(value: string | undefined) {
	return clamp(value, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX);
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

export const animeRoutes = new Elysia({ name: "anime-routes" })
	.get("/api/v1/anime/sources", async () => listAnimeSources(db))
	.get("/api/v1/anime/settings", async ({ request }) => {
		const userId = await resolveUserId(request);
		const personal = await readAnimeUserPrefs(db, userId, [
			"anime.thumbnailSource",
			"anime.playerQuality",
			"anime.autoplayNext",
			"anime.playbackRate",
		]);
		return {
			settings: {
				thumbnailSource:
					(personal["anime.thumbnailSource"] as string) ?? "local",
				playerQuality: (personal["anime.playerQuality"] as string) ?? "auto",
				autoplayNext: personal["anime.autoplayNext"] === true,
				playbackRate: Number(personal["anime.playbackRate"] ?? 1),
			},
			cache: cacheConfiguration(),
		};
	})
	.get(
		"/api/v1/anime/library",
		async ({ query }) => {
			const page = clamp(query.page, 1, 1_000_000);
			const pageSize = clampPageSize(query.pageSize);
			const cacheKey = `anime:library:${JSON.stringify({
				page,
				pageSize,
				q: query.q ?? "",
				genre: query.genre ?? "",
				status: query.status ?? "",
				sort: query.sort ?? "recent",
			})}`;
			return cacheRemember(
				cacheKey,
				() =>
					listAnime(db, {
						page,
						pageSize,
						q: query.q,
						genre: query.genre,
						status: query.status,
						sort: query.sort === "title" ? "title" : "recent",
					}),
				120,
			);
		},
		{
			query: t.Object({
				page: t.Optional(t.String()),
				pageSize: t.Optional(t.String()),
				q: t.Optional(t.String()),
				genre: t.Optional(t.String()),
				status: t.Optional(t.String()),
				sort: t.Optional(t.String()),
			}),
		},
	)
	.get(
		"/api/v1/anime/library/:id",
		async ({ params, set }) => {
			const detail = await cacheRemember(
				`anime:detail:${params.id}`,
				() => getAnimeDetail(db, params.id),
				120,
			);
			if (!detail) {
				set.status = 404;
				return { error: "Anime tidak ditemukan" };
			}
			return detail;
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get(
		"/api/v1/anime/library/:id/episodes",
		async ({ params, query, set }) => {
			const page = clamp(query.page, 1, 1_000_000);
			const pageSize = clamp(query.pageSize, 40, 100);
			const result = await cacheRemember(
				`anime:episodes:${JSON.stringify({ id: params.id, page, pageSize })}`,
				async () => {
					const visibleId = await getVisibleAnimeId(db, params.id);
					if (!visibleId) return null;
					return getEpisodePage(db, params.id, page, pageSize);
				},
				120,
			);
			if (!result) {
				set.status = 404;
				return { error: "Anime tidak ditemukan" };
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
		"/api/v1/anime/episodes/:id/media",
		async ({ params, query }) =>
			cacheRemember(
				`anime:media:${JSON.stringify({ id: params.id, source: query.source ?? "" })}`,
				async () =>
					(await getEpisodeMedia(db, params.id, query.source)) ?? {
						sources: [],
						downloads: [],
					},
				60,
			),
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ source: t.Optional(t.String()) }),
		},
	)
	.get(
		"/api/v1/anime/library/:id/thumbnail",
		async ({ params, query, set }) => {
			const resolved = await resolveAnimeThumbnail(
				db,
				params.id,
				query.source?.trim() || undefined,
			);
			if (resolved.kind === "blob") {
				try {
					const bytes = await s3.getObjectBytes(resolved.objectKey);
					set.headers["content-type"] = resolved.contentType;
					set.headers["cache-control"] = "private, max-age=300";
					return new Response(bytes);
				} catch {
					set.status = 502;
					return { error: "Thumbnail lokal gagal dibaca." };
				}
			}
			if (resolved.kind === "remote") {
				const safe = safeExternalUrl(resolved.url);
				if (safe) {
					set.status = 302;
					set.headers.location = safe;
					set.headers["cache-control"] = "public, max-age=600";
					return;
				}
			}
			set.status = 404;
			return { error: "Thumbnail anime tidak tersedia" };
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({
				source: t.Optional(t.String()),
				v: t.Optional(t.String()),
				format: t.Optional(t.Union([t.Literal("original"), t.Literal("webp")])),
			}),
		},
	);
