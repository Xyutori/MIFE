import * as schema from "@SyMi/db/schema/index";
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getTableConfig, type PgTable, PgTimestamp } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { db } from "../services";
import { getObjectBytes, putObject } from "../storage/s3";

const FORMAT = "symi-library-archive";
const VERSION = 1;
const MAX_ARCHIVE_BYTES = 768 * 1024 * 1024;

type ArchiveTableMap = Record<string, PgTable>;

const CATALOG_TABLES: ArchiveTableMap = {
	workspaces: schema.workspaces,
	sources: schema.sources,
	series: schema.series,
	series_aliases: schema.seriesAliases,
	series_genres: schema.seriesGenres,
	series_sources: schema.seriesSources,
	chapters: schema.chapters,
	chapter_sources: schema.chapterSources,
	chapter_pages: schema.chapterPages,
	media_assets: schema.mediaAssets,
	source_scrape_state: schema.sourceScrapeState,
} as const;

const ANIME_TABLES: ArchiveTableMap = {
	anime_series: schema.animeSeries,
	anime_series_genres: schema.animeSeriesGenres,
	anime_sources: schema.animeSources,
	anime_episodes: schema.animeEpisodes,
	anime_episode_sources: schema.animeEpisodeSources,
	anime_thumbnails: schema.animeThumbnails,
} as const;

const IMAGE_META_TABLES: ArchiveTableMap = {
	image_blobs: schema.imageBlobs,
	image_variants: schema.imageVariants,
} as const;

type ComicWorkspace = "comic" | "superkomik";

type ArchiveManifest = {
	format: typeof FORMAT;
	version: typeof VERSION;
	workspace: string;
	exportedAt: string;
	sources: Array<{ id: string; key: string }>;
	data: Record<string, Record<string, unknown>[]>;
	assets: Array<{
		path: string;
		blobSha256: string;
		contentType: string;
		byteSize: number;
		objectKey: string;
	}>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reviveRow(table: PgTable, row: Record<string, unknown>) {
	let config: ReturnType<typeof getTableConfig>;
	try {
		config = getTableConfig(table as never);
	} catch {
		return row;
	}
	const revived: Record<string, unknown> = { ...row };
	for (const column of config.columns) {
		const name = (column as { name: string }).name;
		const value = revived[name];
		if (column instanceof PgTimestamp && typeof value === "string") {
			const parsed = new Date(value);
			revived[name] = Number.isNaN(parsed.getTime()) ? null : parsed;
		}
	}
	return revived;
}

/**
 * NOTE (projection): the full-row `.select()` calls below are intentional.
 * An export archive must preserve every column verbatim so a later import can
 * restore rows exactly; projecting a subset would silently drop data.
 * Total/count queries are avoided entirely — sizes come from the collected
 * arrays, never from `select id` + `.length` waste.
 */
async function collectComicData(workspace: ComicWorkspace) {
	const data: Record<string, Record<string, unknown>[]> = {};
	const sourceRows = await db
		.select()
		.from(schema.sources)
		.where(eq(schema.sources.workspaceId, workspace));
	data.sources = sourceRows as unknown as Record<string, unknown>[];
	const seriesRows = await db
		.select()
		.from(schema.series)
		.where(eq(schema.series.workspaceId, workspace));
	data.series = seriesRows as unknown as Record<string, unknown>[];
	const seriesIds = seriesRows.map((row) => row.id);
	const aliasRows = seriesIds.length
		? await db
				.select()
				.from(schema.seriesAliases)
				.where(inArray(schema.seriesAliases.seriesId, seriesIds))
		: [];
	data.series_aliases = aliasRows as unknown as Record<string, unknown>[];
	const genreRows = seriesIds.length
		? await db
				.select()
				.from(schema.seriesGenres)
				.where(inArray(schema.seriesGenres.seriesId, seriesIds))
		: [];
	data.series_genres = genreRows as unknown as Record<string, unknown>[];
	const seriesSourceRows = seriesIds.length
		? await db
				.select()
				.from(schema.seriesSources)
				.where(inArray(schema.seriesSources.seriesId, seriesIds))
		: [];
	data.series_sources = seriesSourceRows as unknown as Record<
		string,
		unknown
	>[];
	const chapterRows = seriesIds.length
		? await db
				.select()
				.from(schema.chapters)
				.where(inArray(schema.chapters.seriesId, seriesIds))
		: [];
	data.chapters = chapterRows as unknown as Record<string, unknown>[];
	const chapterIds = chapterRows.map((row) => row.id);
	const sourceIds = sourceRows.map((row) => row.id);
	const chapterSourceRows =
		chapterIds.length > 0
			? await db
					.select()
					.from(schema.chapterSources)
					.where(inArray(schema.chapterSources.chapterId, chapterIds))
			: [];
	data.chapter_sources = chapterSourceRows as unknown as Record<
		string,
		unknown
	>[];
	const chapterSourceIds = chapterSourceRows.map((row) => row.id);
	const pageRows =
		chapterSourceIds.length > 0
			? await db
					.select()
					.from(schema.chapterPages)
					.where(inArray(schema.chapterPages.chapterSourceId, chapterSourceIds))
			: [];
	data.chapter_pages = pageRows as unknown as Record<string, unknown>[];
	data.media_assets = (await db
		.select()
		.from(schema.mediaAssets)
		.where(
			sourceIds.length
				? inArray(schema.mediaAssets.sourceId, [...sourceIds, null as never])
				: undefined,
		)) as unknown as Record<string, unknown>[];
	const stateRows = sourceIds.length
		? await db
				.select()
				.from(schema.sourceScrapeState)
				.where(inArray(schema.sourceScrapeState.sourceId, sourceIds))
		: [];
	data.source_scrape_state = stateRows as unknown as Record<string, unknown>[];
	data.workspaces = (await db
		.select()
		.from(schema.workspaces)
		.where(eq(schema.workspaces.id, workspace))) as unknown as Record<
		string,
		unknown
	>[];
	return {
		data,
		sources: sourceRows.map((row) => ({ id: row.id, key: row.key })),
	};
}

async function collectAnimeData() {
	const animeRows = await db.select().from(schema.animeSeries);
	const animeData: Record<string, Record<string, unknown>[]> = {
		anime_series: animeRows as unknown as Record<string, unknown>[],
	};
	const animeIds = animeRows.map((row) => row.id);
	animeData.anime_series_genres = (animeIds.length
		? await db
				.select()
				.from(schema.animeSeriesGenres)
				.where(inArray(schema.animeSeriesGenres.animeId, animeIds))
		: []) as unknown as Record<string, unknown>[];
	const animeSourceRows =
		animeIds.length > 0
			? await db
					.select()
					.from(schema.animeSources)
					.where(inArray(schema.animeSources.animeId, animeIds))
			: [];
	animeData.anime_sources = animeSourceRows as unknown as Record<
		string,
		unknown
	>[];
	const episodeRows =
		animeIds.length > 0
			? await db
					.select()
					.from(schema.animeEpisodes)
					.where(inArray(schema.animeEpisodes.animeId, animeIds))
			: [];
	animeData.anime_episodes = episodeRows as unknown as Record<
		string,
		unknown
	>[];
	const animeSourceIds = animeSourceRows.map((row) => row.id);
	animeData.anime_episode_sources = (animeSourceIds.length > 0
		? await db
				.select()
				.from(schema.animeEpisodeSources)
				.where(
					inArray(schema.animeEpisodeSources.animeSourceId, animeSourceIds),
				)
		: []) as unknown as Record<string, unknown>[];
	animeData.anime_thumbnails = (animeSourceIds.length > 0
		? await db
				.select()
				.from(schema.animeThumbnails)
				.where(inArray(schema.animeThumbnails.animeSourceId, animeSourceIds))
		: []) as unknown as Record<string, unknown>[];
	const sourceRows = await db
		.select()
		.from(schema.sources)
		.where(eq(schema.sources.workspaceId, "anime"));
	animeData.sources = sourceRows as unknown as Record<string, unknown>[];
	animeData.workspaces = (await db
		.select()
		.from(schema.workspaces)
		.where(eq(schema.workspaces.id, "anime"))) as unknown as Record<
		string,
		unknown
	>[];
	const stateRows = await db
		.select()
		.from(schema.sourceScrapeState)
		.where(
			inArray(
				schema.sourceScrapeState.sourceId,
				sourceRows.map((row) => row.id),
			),
		);
	animeData.source_scrape_state = stateRows as unknown as Record<
		string,
		unknown
	>[];
	return {
		data: animeData,
		sources: sourceRows.map((row) => ({ id: row.id, key: row.key })),
	};
}

async function collectBlobs(data: Record<string, Record<string, unknown>[]>) {
	const shaSet = new Set<string>();
	const pushSha = (value: unknown) => {
		if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value))
			shaSet.add(value.toLowerCase());
	};
	for (const pages of Object.values(data)) {
		for (const row of pages) {
			pushSha(row.blobSha256);
			pushSha(row.sha256);
		}
	}
	const shaList = [...shaSet];
	const blobRows = shaList.length
		? await db
				.select()
				.from(schema.imageBlobs)
				.where(inArray(schema.imageBlobs.sha256, shaList))
		: [];
	const variantRows = shaList.length
		? await db
				.select()
				.from(schema.imageVariants)
				.where(inArray(schema.imageVariants.blobSha256, shaList))
		: [];
	return { blobRows, variantRows };
}

export const archiveRoutes = new Elysia({ name: "archive-routes" })
	.get(
		"/api/admin/archive/export",
		async ({ query, set }) => {
			const workspace = query.workspace ?? "comic";
			const collected =
				workspace === "anime"
					? await collectAnimeData()
					: workspace === "all"
						? await (async () => {
								const comic = await collectComicData("comic");
								const superkomik = await collectComicData("superkomik");
								const anime = await collectAnimeData();
								const data: Record<string, Record<string, unknown>[]> = {};
								for (const part of [comic.data, superkomik.data, anime.data]) {
									for (const [key, rows] of Object.entries(part)) {
										data[key] = [...(data[key] ?? []), ...rows];
									}
								}
								return {
									data,
									sources: [
										...comic.sources,
										...superkomik.sources,
										...anime.sources,
									],
								};
							})()
						: await collectComicData(
								workspace === "superkomik" ? "superkomik" : "comic",
							);
			const { blobRows, variantRows } = await collectBlobs(collected.data);
			collected.data.image_blobs = blobRows as unknown as Record<
				string,
				unknown
			>[];
			collected.data.image_variants = variantRows as unknown as Record<
				string,
				unknown
			>[];

			const files: Record<string, Uint8Array> = {};
			const assets: ArchiveManifest["assets"] = [];
			let totalBytes = 0;
			for (const blob of blobRows) {
				try {
					const bytes = await getObjectBytes(blob.objectKey);
					if (
						bytes.byteLength !== blob.byteSize ||
						createHash("sha256").update(bytes).digest("hex") !== blob.sha256
					)
						continue;
					totalBytes += bytes.byteLength;
					if (totalBytes > MAX_ARCHIVE_BYTES) {
						set.status = 413;
						return {
							error:
								"Arsip melebihi batas ukuran export; sinkronkan ulang gambar yang belum tersimpan lalu coba lagi",
						};
					}
					const path = `blobs/${blob.sha256}`;
					files[path] = bytes;
					assets.push({
						path,
						blobSha256: blob.sha256,
						contentType: blob.contentType,
						byteSize: bytes.byteLength,
						objectKey: blob.objectKey,
					});
				} catch {
					// Missing objects are skipped; the manifest keeps the metadata.
				}
			}
			const manifest: ArchiveManifest = {
				format: FORMAT,
				version: VERSION,
				workspace,
				exportedAt: new Date().toISOString(),
				sources: collected.sources,
				data: collected.data,
				assets,
			};
			files["manifest.json"] = strToU8(JSON.stringify(manifest));
			const zipped = zipSync(files, { level: 6 });
			const payload = zipped.buffer.slice(
				zipped.byteOffset,
				zipped.byteOffset + zipped.byteLength,
			);
			return new Response(payload, {
				headers: {
					"content-type": "application/zip",
					"content-disposition": `attachment; filename="symi-${workspace}-archive.zip"`,
					"cache-control": "no-store",
				},
			});
		},
		{
			query: t.Object({
				workspace: t.Optional(t.String()),
			}),
		},
	)
	.post(
		"/api/admin/archive/import",
		async ({ body, set }) => {
			const file = body.file;
			if (!file || file.size > MAX_ARCHIVE_BYTES) {
				set.status = 413;
				return { error: "File ZIP arsip tidak ditemukan atau terlalu besar" };
			}
			const buffer = new Uint8Array(await file.arrayBuffer());
			let entries: Record<string, Uint8Array>;
			try {
				entries = unzipSync(buffer);
			} catch {
				set.status = 400;
				return { error: "File bukan arsip ZIP yang valid" };
			}
			const manifestRaw = entries["manifest.json"];
			if (!manifestRaw) {
				set.status = 400;
				return { error: "Arsip tidak memuat manifest.json" };
			}
			let manifest: ArchiveManifest;
			try {
				const parsed = JSON.parse(strFromU8(manifestRaw)) as unknown;
				if (!isPlainObject(parsed)) throw new Error("bad manifest");
				manifest = parsed as unknown as ArchiveManifest;
			} catch {
				set.status = 400;
				return { error: "Manifest arsip tidak valid" };
			}
			if (manifest.format !== FORMAT || manifest.version !== VERSION) {
				set.status = 400;
				return { error: "Format arsip tidak dikenali" };
			}
			const allTables: ArchiveTableMap = {
				...CATALOG_TABLES,
				...ANIME_TABLES,
				...IMAGE_META_TABLES,
			};
			const restored: Record<string, number> = {};
			for (const [name, rows] of Object.entries(manifest.data)) {
				const table = allTables[name];
				if (!table || !Array.isArray(rows)) continue;
				let count = 0;
				for (const row of rows) {
					if (!isPlainObject(row)) continue;
					try {
						await db
							.insert(table as never)
							.values(reviveRow(table, row) as never)
							.onConflictDoNothing();
						count += 1;
					} catch {
						// Skip rows that violate newer constraints; keep the rest.
					}
				}
				restored[name] = count;
			}
			let blobsRestored = 0;
			for (const asset of manifest.assets ?? []) {
				const bytes = entries[asset.path];
				if (!bytes) continue;
				if (
					bytes.byteLength !== asset.byteSize ||
					createHash("sha256").update(bytes).digest("hex") !==
						asset.blobSha256.toLowerCase()
				)
					continue;
				try {
					await putObject(asset.objectKey, bytes, asset.contentType);
					blobsRestored += 1;
				} catch {
					// Keep restoring the remaining assets.
				}
			}
			return {
				workspace: manifest.workspace,
				exportedAt: manifest.exportedAt,
				restored,
				blobsRestored,
			};
		},
		{
			body: t.Object({
				file: t.File({ maxSize: MAX_ARCHIVE_BYTES }),
			}),
		},
	);
