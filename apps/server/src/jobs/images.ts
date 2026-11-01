import {
	animeSources,
	animeThumbnails,
	chapterPages,
	chapterSources,
	chapters,
	imageBlobs,
	mediaAssets,
	scrapeRuns,
	series,
	seriesSources,
	sources,
} from "@SyMi/db/schema/index";
import { createHash } from "node:crypto";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import {
	animeThumbnailObjectKey,
	comicPageObjectKey,
	mediaAssetObjectKey,
} from "../media/object-keys";
import { db } from "../services";
import {
	fetchSource,
	safeSourceErrorMessage,
	withSourceNetworkRetry,
} from "../sources/http";
import type { SourceConfig } from "../sources/types";
import {
	ensureBucketExists,
	getObjectBytes,
	objectExists,
	putObject,
} from "../storage/s3";
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
	ensureImageVariants,
	InvalidImageBytesError,
	type ValidatedImageBytes,
	validateImageBytes,
} from "./image-variants";
import { updatePageMediaAssetStatus } from "./store";
import {
	claimRunWorkerToken,
	releaseRunWorker,
	withRunWorkerLease,
} from "./worker-lease";

const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const COMIC_WORKSPACE_ID = "comic";
const activeRuns = new Set<string>();

type ComicWorkspace = "comic" | "superkomik";

function isComicWorkspace(value: string): value is ComicWorkspace {
	return value === "comic" || value === "superkomik";
}

export type DownloadScope = {
	seriesId?: string;
	chapterId?: string;
	sourceKey?: string;
};

export type RunImageOptions = {
	workspaceId?: string;
	triggeredBy?: "manual" | "scheduler";
	verifyAll?: boolean;
	workerToken?: string;
	workerMode?: "start" | "resume" | "recovery";
};

function sourceConfig(
	row: typeof sources.$inferSelect,
	runId?: string,
): SourceConfig {
	return {
		id: row.id,
		key: row.key,
		name: row.name,
		baseUrl: row.baseUrl,
		prefix: row.prefix,
		requestDelayMs: row.requestDelayMs,
		runId,
		workspaceId: row.workspaceId,
	};
}

function transferSource(runId?: string): SourceConfig {
	return {
		id: "symi:object-storage",
		key: "object-storage",
		name: "Object Storage",
		baseUrl: "http://object-storage.local",
		prefix: "",
		requestDelayMs: 200,
		runId,
	};
}

class MediaObjectIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MediaObjectIntegrityError";
	}
}

async function readBoundedImage(response: Response) {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Respons gambar tidak memiliki body");

	const chunks: Uint8Array[] = [];
	let byteSize = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteSize += value.byteLength;
			if (byteSize > MAX_IMAGE_BYTES) {
				await reader.cancel();
				throw new Error("Ukuran gambar melewati batas 80 MB");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(byteSize);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function parseJson(value: unknown) {
	if (value && typeof value === "object")
		return value as Record<string, unknown>;
	if (typeof value === "string") {
		try {
			return JSON.parse(value) as Record<string, unknown>;
		} catch {
			return {};
		}
	}
	return {};
}

/**
 * Download a remote image URL into the object storage with sha256 dedupe and
 * a WebP variant. Returns the canonical blob row. Recoverable object errors
 * (missing/corrupt stored object) fall through to re-download.
 */
export async function downloadUrlToBlob(
	runId: string,
	externalUrl: string,
	source: Pick<
		SourceConfig,
		"id" | "key" | "name" | "baseUrl" | "prefix" | "requestDelayMs"
	>,
	objectKeyHint: (sha256: string, contentType: string) => string,
	validatedHint?: { bytes: Uint8Array; validated: ValidatedImageBytes },
) {
	const transfer = transferSource(runId);
	const fetchSourceConfig: SourceConfig = { ...source, runId };
	if (validatedHint) {
		const { bytes, validated } = validatedHint;
		return persistBlob(
			runId,
			bytes,
			validated.contentType,
			objectKeyHint,
			validated,
		);
	}
	const { body, contentType, validatedImage } = await withSourceNetworkRetry(
		fetchSourceConfig,
		async () => {
			const response = await fetchSource(
				fetchSourceConfig,
				new URL(externalUrl),
				"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
				{
					lane: "image",
					intervalMs: Math.max(source.requestDelayMs, 800),
					timeoutMs: 300_000,
				},
			);
			const reportedSize = Number(response.headers.get("content-length"));
			if (Number.isFinite(reportedSize) && reportedSize > MAX_IMAGE_BYTES) {
				await response.body?.cancel();
				throw new Error("Ukuran gambar melewati batas 80 MB");
			}
			const bytes = await readBoundedImage(response);
			if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
				throw new Error("Ukuran gambar kosong atau melewati batas 80 MB");
			}
			const validatedImage = await validateImageBytes(bytes);
			return {
				body: bytes,
				contentType: validatedImage.contentType,
				validatedImage,
			};
		},
	);
	void transfer;
	return persistBlob(runId, body, contentType, objectKeyHint, validatedImage);
}

async function persistBlob(
	runId: string,
	body: Uint8Array,
	contentType: string,
	objectKeyHint: (sha256: string, contentType: string) => string,
	validatedImage: ValidatedImageBytes,
) {
	const transfer = transferSource(runId);
	const sha256 = createHash("sha256").update(body).digest("hex");
	const existing = await db
		.select()
		.from(imageBlobs)
		.where(eq(imageBlobs.sha256, sha256))
		.limit(1);
	if (existing[0]) {
		const known = existing[0];
		try {
			const stored = await withSourceNetworkRetry(transfer, () =>
				getObjectBytes(known.objectKey),
			);
			if (
				stored.byteLength === body.byteLength ||
				createHash("sha256").update(stored).digest("hex") === sha256
			) {
				await withSourceNetworkRetry(transfer, () =>
					ensureImageVariants(known, stored, runId, validatedImage),
				);
				return known;
			}
		} catch (error) {
			if (isRunControlError(error)) throw error;
			// Stored object missing/corrupt: re-upload below.
		}
	}
	const candidateKey =
		existing[0]?.objectKey ?? objectKeyHint(sha256, contentType);
	if (!existing[0]) {
		const storedAt = now();
		await db
			.insert(imageBlobs)
			.values({
				sha256,
				objectKey: candidateKey,
				contentType,
				byteSize: body.byteLength,
				createdAt: storedAt,
				updatedAt: storedAt,
			})
			.onConflictDoNothing();
	}
	const canonical = (
		await db
			.select()
			.from(imageBlobs)
			.where(eq(imageBlobs.sha256, sha256))
			.limit(1)
	)[0];
	if (!canonical) throw new Error("Metadata checksum gambar tidak tersimpan");
	await withSourceNetworkRetry(transfer, () =>
		putObject(canonical.objectKey, body, contentType),
	);
	const uploaded = await withSourceNetworkRetry(transfer, () =>
		getObjectBytes(canonical.objectKey),
	);
	if (
		uploaded.byteLength !== body.byteLength ||
		createHash("sha256").update(uploaded).digest("hex") !== sha256
	)
		throw new Error("Verifikasi checksum object setelah upload gagal");
	await db
		.update(imageBlobs)
		.set({ contentType, byteSize: uploaded.byteLength, updatedAt: now() })
		.where(eq(imageBlobs.sha256, sha256));
	const blob = { ...canonical, contentType, byteSize: uploaded.byteLength };
	await withSourceNetworkRetry(transfer, () =>
		ensureImageVariants(blob, uploaded, runId, validatedImage),
	);
	return blob;
}

function isMissingObjectError(error: unknown) {
	const details = error as {
		$metadata?: { httpStatusCode?: number };
		name?: string;
		Code?: string;
	};
	return (
		details?.$metadata?.httpStatusCode === 404 ||
		details?.name === "NotFound" ||
		details?.name === "NoSuchKey" ||
		details?.Code === "NoSuchKey"
	);
}

function isRecoverablePageObjectError(error: unknown) {
	return (
		error instanceof MediaObjectIntegrityError ||
		error instanceof InvalidImageBytesError ||
		isMissingObjectError(error)
	);
}

export async function storePage(
	runId: string,
	page: typeof chapterPages.$inferSelect,
	source: SourceConfig,
	context: {
		seriesId: string;
		seriesTitle: string;
		chapterSourceId: string;
		chapterNumber: string;
		verifyAll?: boolean;
	},
) {
	const wasSaved = Boolean(page.blobSha256);
	const needsWork =
		context.verifyAll ||
		page.downloadStatus === "remote" ||
		page.downloadStatus === "failed" ||
		page.downloadStatus === "downloading" ||
		!page.blobSha256;
	if (!needsWork && page.downloadStatus === "saved") {
		// Still ensure the stored object exists; repair when it is gone.
		if (page.blobSha256) {
			const blob = (
				await db
					.select()
					.from(imageBlobs)
					.where(eq(imageBlobs.sha256, page.blobSha256))
					.limit(1)
			)[0];
			if (blob && (await objectExists(blob.objectKey)))
				return { saved: false, byteSize: blob.byteSize };
		}
	}
	if (page.blobSha256 && !needsWork) return { saved: false, byteSize: 0 };

	if (page.blobSha256) {
		const blob = (
			await db
				.select()
				.from(imageBlobs)
				.where(eq(imageBlobs.sha256, page.blobSha256))
				.limit(1)
		)[0];
		if (blob) {
			try {
				const originalBytes = await withSourceNetworkRetry(
					transferSource(runId),
					async () => {
						if (!(await objectExists(blob.objectKey)))
							throw new MediaObjectIntegrityError("Object asli tidak ada");
						const bytes = await getObjectBytes(blob.objectKey);
						if (
							bytes.byteLength !== blob.byteSize ||
							createHash("sha256").update(bytes).digest("hex") !== blob.sha256
						)
							throw new MediaObjectIntegrityError(
								"Object asli tidak cocok dengan metadata",
							);
						return bytes;
					},
				);
				await withSourceNetworkRetry(transferSource(runId), () =>
					ensureImageVariants(blob, originalBytes, runId),
				);
				if (page.downloadStatus !== "saved") {
					await db
						.update(chapterPages)
						.set({
							downloadStatus: "saved",
							lastError: null,
							updatedAt: now(),
						})
						.where(eq(chapterPages.id, page.id));
				}
				await updatePageMediaAssetStatus(page.id, {
					downloadStatus: "saved",
					integrityStatus: "healthy",
					blobSha256: blob.sha256,
					sha256: blob.sha256,
					contentType: blob.contentType,
					byteSize: blob.byteSize,
					lastError: null,
					lastVerifiedAt: now(),
				});
				return { saved: false, byteSize: blob.byteSize };
			} catch (error) {
				if (isRunControlError(error)) throw error;
				if (!isRecoverablePageObjectError(error)) throw error;
				// Re-fetch only when the original object is known missing or corrupt.
			}
		}
	}

	const reused = (
		await db
			.select({ sha256: chapterPages.blobSha256 })
			.from(chapterPages)
			.where(
				and(
					eq(chapterPages.externalUrl, page.externalUrl),
					isNotNull(chapterPages.blobSha256),
				),
			)
			.limit(1)
	)[0]?.sha256;
	if (reused) {
		const blob = (
			await db
				.select()
				.from(imageBlobs)
				.where(eq(imageBlobs.sha256, reused))
				.limit(1)
		)[0];
		if (blob) {
			try {
				const originalBytes = await withSourceNetworkRetry(
					transferSource(runId),
					async () => {
						if (!(await objectExists(blob.objectKey)))
							throw new MediaObjectIntegrityError("Object asli tidak ada");
						const bytes = await getObjectBytes(blob.objectKey);
						if (
							createHash("sha256").update(bytes).digest("hex") !== blob.sha256
						)
							throw new MediaObjectIntegrityError(
								"Checksum object asli tidak cocok",
							);
						return bytes;
					},
				);
				await withSourceNetworkRetry(transferSource(runId), () =>
					ensureImageVariants(blob, originalBytes, runId),
				);
				await db
					.update(chapterPages)
					.set({
						blobSha256: blob.sha256,
						downloadStatus: "saved",
						downloadedAt: now(),
						lastError: null,
						updatedAt: now(),
					})
					.where(eq(chapterPages.id, page.id));
				await updatePageMediaAssetStatus(page.id, {
					downloadStatus: "saved",
					integrityStatus: "healthy",
					blobSha256: blob.sha256,
					sha256: blob.sha256,
					contentType: blob.contentType,
					byteSize: blob.byteSize,
					lastError: null,
					downloadedAt: now(),
					lastVerifiedAt: now(),
				});
				return { saved: false, byteSize: blob.byteSize };
			} catch (error) {
				if (isRunControlError(error)) throw error;
				if (!isRecoverablePageObjectError(error)) throw error;
			}
		}
	}

	const startedAt = now();
	await db
		.update(chapterPages)
		.set({
			downloadStatus: "downloading",
			downloadAttempts: page.downloadAttempts + 1,
			lastError: null,
			updatedAt: startedAt,
		})
		.where(eq(chapterPages.id, page.id));
	await updatePageMediaAssetStatus(page.id, {
		downloadStatus: "downloading",
		integrityStatus: wasSaved ? "repairing" : "unchecked",
		downloadAttempts: page.downloadAttempts + 1,
		lastError: null,
	});

	try {
		const blob = await downloadUrlToBlob(
			runId,
			page.externalUrl,
			source,
			(sha256, contentType) =>
				comicPageObjectKey({
					...context,
					sourceKey: source.key,
					pageIndex: page.pageIndex,
					sha256,
					contentType,
				}),
		);

		await db
			.update(chapterPages)
			.set({
				blobSha256: blob.sha256,
				downloadStatus: "saved",
				lastError: null,
				downloadedAt: now(),
				updatedAt: now(),
			})
			.where(eq(chapterPages.id, page.id));
		await updatePageMediaAssetStatus(page.id, {
			blobSha256: blob.sha256,
			sha256: blob.sha256,
			contentType: blob.contentType,
			byteSize: blob.byteSize,
			downloadStatus: "saved",
			integrityStatus: "healthy",
			lastError: null,
			downloadedAt: now(),
			lastVerifiedAt: now(),
		});
		return { saved: true, byteSize: blob.byteSize };
	} catch (error) {
		if (isRunControlError(error)) throw error;
		const message =
			error !== null && typeof error === "object" && "$metadata" in error
				? safeSourceErrorMessage(error, "Kesalahan object storage")
				: safeSourceErrorMessage(error, "Kesalahan download tidak diketahui");
		await db
			.update(chapterPages)
			.set({
				downloadStatus: "failed",
				lastError: message,
				updatedAt: now(),
			})
			.where(eq(chapterPages.id, page.id));
		await updatePageMediaAssetStatus(page.id, {
			downloadStatus: "failed",
			integrityStatus: wasSaved ? "repair_failed" : "unchecked",
			lastError: message,
			lastVerifiedAt: wasSaved ? now() : null,
		});
		await addRunEvent(
			runId,
			`Gagal menyimpan halaman ${page.pageIndex + 1} dari ${source.name}`,
			{
				level: "error",
				details: {
					chapterSourceId: page.chapterSourceId,
					pageIndex: page.pageIndex,
					error: message,
				},
			},
		);
		throw error;
	}
}

async function selectChapterSources(workspaceId: string, scope: DownloadScope) {
	const conditions = [eq(series.workspaceId, workspaceId)];
	if (scope.seriesId) conditions.push(eq(chapters.seriesId, scope.seriesId));
	if (scope.chapterId)
		conditions.push(eq(chapterSources.chapterId, scope.chapterId));
	if (scope.sourceKey) conditions.push(eq(sources.key, scope.sourceKey));

	return db
		.select({
			chapterSource: chapterSources,
			chapter: chapters,
			series,
			source: sources,
		})
		.from(chapterSources)
		.innerJoin(chapters, eq(chapterSources.chapterId, chapters.id))
		.innerJoin(series, eq(chapters.seriesId, series.id))
		.innerJoin(sources, eq(chapterSources.sourceId, sources.id))
		.where(
			and(
				...conditions,
				eq(sources.enabled, true),
				or(
					eq(chapterSources.readerUrlStatus, "complete"),
					sql`EXISTS (SELECT 1 FROM ${chapterPages} WHERE ${chapterPages.chapterSourceId} = ${chapterSources.id} AND ${chapterPages.isActive} = TRUE)`,
				),
			),
		);
}

async function upsertStandaloneAsset(input: {
	assetType: string;
	ownerType: string;
	ownerId: string;
	sourceId: string | null;
	externalUrl: string;
}) {
	const timestamp = now();
	const existing = await db
		.select()
		.from(mediaAssets)
		.where(
			and(
				eq(mediaAssets.assetType, input.assetType),
				eq(mediaAssets.ownerType, input.ownerType),
				eq(mediaAssets.ownerId, input.ownerId),
			),
		)
		.limit(1);
	if (existing[0]) {
		if (existing[0].externalUrl !== input.externalUrl) {
			await db
				.update(mediaAssets)
				.set({
					externalUrl: input.externalUrl,
					sourceId: input.sourceId,
					downloadStatus: "remote",
					integrityStatus: "unchecked",
					lastError: null,
					updatedAt: timestamp,
				})
				.where(eq(mediaAssets.id, existing[0].id));
		}
		return existing[0];
	}
	const id = crypto.randomUUID();
	await db
		.insert(mediaAssets)
		.values({
			id,
			assetType: input.assetType,
			ownerType: input.ownerType,
			ownerId: input.ownerId,
			sourceId: input.sourceId,
			externalUrl: input.externalUrl,
			downloadStatus: "remote",
			integrityStatus: "unchecked",
			downloadAttempts: 0,
			createdAt: timestamp,
			updatedAt: timestamp,
		})
		.onConflictDoNothing();
	return (
		await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1)
	)[0];
}

async function downloadStandaloneAsset(
	runId: string,
	asset: typeof mediaAssets.$inferSelect,
	source: SourceConfig | null,
	objectKeyHint: (sha256: string, contentType: string) => string,
) {
	const transfer = source
		? { ...source, runId }
		: { ...transferSource(runId), name: "Media" };
	const current = await db
		.select()
		.from(mediaAssets)
		.where(eq(mediaAssets.id, asset.id))
		.limit(1);
	const row = current[0] ?? asset;
	if (row.downloadStatus === "saved" && row.blobSha256) {
		const blob = (
			await db
				.select()
				.from(imageBlobs)
				.where(eq(imageBlobs.sha256, row.blobSha256))
				.limit(1)
		)[0];
		if (blob && (await objectExists(blob.objectKey)))
			return { saved: false, bytes: blob.byteSize };
	}
	const startedAt = now();
	await db
		.update(mediaAssets)
		.set({
			downloadStatus: "downloading",
			downloadAttempts: row.downloadAttempts + 1,
			lastError: null,
			updatedAt: startedAt,
		})
		.where(eq(mediaAssets.id, row.id));
	try {
		const blob = await downloadUrlToBlob(
			runId,
			row.externalUrl,
			transfer,
			objectKeyHint,
		);
		await db
			.update(mediaAssets)
			.set({
				blobSha256: blob.sha256,
				sha256: blob.sha256,
				contentType: blob.contentType,
				byteSize: blob.byteSize,
				downloadStatus: "saved",
				integrityStatus: "healthy",
				lastError: null,
				downloadedAt: now(),
				lastVerifiedAt: now(),
				updatedAt: now(),
			})
			.where(eq(mediaAssets.id, row.id));
		return { saved: true, bytes: blob.byteSize };
	} catch (error) {
		if (isRunControlError(error)) throw error;
		const message = safeSourceErrorMessage(
			error,
			"Kesalahan download tidak diketahui",
		);
		await db
			.update(mediaAssets)
			.set({
				downloadStatus: "failed",
				integrityStatus: "unchecked",
				lastError: message,
				updatedAt: now(),
			})
			.where(eq(mediaAssets.id, row.id));
		throw error;
	}
}

async function syncStandaloneComicMedia(
	runId: string,
	workspaceId: ComicWorkspace,
	scope: DownloadScope,
) {
	let total = 0;
	let saved = 0;
	let failed = 0;
	let bytes = 0;
	const conditions = [eq(series.workspaceId, workspaceId)];
	if (scope.seriesId) conditions.push(eq(series.id, scope.seriesId));
	const seriesRows = await db
		.select()
		.from(series)
		.where(and(...conditions));
	const sourceRows = await db
		.select()
		.from(sources)
		.where(eq(sources.workspaceId, workspaceId));
	const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
	for (const item of seriesRows) {
		await waitForRunResume(runId);
		if (scope.sourceKey) {
			const hasSource = await db
				.select({ id: seriesSources.id })
				.from(seriesSources)
				.innerJoin(sources, eq(seriesSources.sourceId, sources.id))
				.where(
					and(
						eq(seriesSources.seriesId, item.id),
						eq(sources.key, scope.sourceKey),
					),
				)
				.limit(1);
			if (!hasSource[0]) continue;
		}
		const links = await db
			.select()
			.from(seriesSources)
			.where(eq(seriesSources.seriesId, item.id));
		const primarySource = links[0]?.sourceId
			? (sourceById.get(links[0].sourceId) ?? null)
			: null;
		const jobs: Array<{
			assetType: string;
			ownerType: string;
			ownerId: string;
			url: string;
			source: SourceConfig | null;
			hint: (sha256: string, contentType: string) => string;
		}> = [];
		if (item.coverImageUrl) {
			jobs.push({
				assetType: "comic_cover",
				ownerType: "series",
				ownerId: item.id,
				url: item.coverImageUrl,
				source: primarySource ? sourceConfig(primarySource, runId) : null,
				hint: (sha256, contentType) => mediaAssetObjectKey(sha256, contentType),
			});
		}
		for (const link of links) {
			if (scope.sourceKey && link.sourceId) {
				const scoped = sourceById.get(link.sourceId);
				if (!scoped || scoped.key !== scope.sourceKey) continue;
			}
			const linkSource = link.sourceId
				? sourceById.get(link.sourceId)
				: undefined;
			if (link.bannerUrl) {
				jobs.push({
					assetType: "comic_banner",
					ownerType: "series_source",
					ownerId: link.id,
					url: link.bannerUrl,
					source: linkSource ? sourceConfig(linkSource, runId) : null,
					hint: (sha256, contentType) =>
						mediaAssetObjectKey(sha256, contentType),
				});
			}
		}
		// Chapter thumbnails (per chapter source).
		const thumbs = await db
			.select({ link: chapterSources })
			.from(chapterSources)
			.innerJoin(chapters, eq(chapterSources.chapterId, chapters.id))
			.where(
				and(
					eq(chapters.seriesId, item.id),
					isNotNull(chapterSources.thumbnailUrl),
					scope.chapterId
						? eq(chapterSources.chapterId, scope.chapterId)
						: sql`TRUE`,
				),
			);
		for (const { link } of thumbs) {
			if (!link.thumbnailUrl) continue;
			if (scope.sourceKey && link.sourceId) {
				const scoped = sourceById.get(link.sourceId);
				if (!scoped || scoped.key !== scope.sourceKey) continue;
			}
			const linkSource = link.sourceId
				? sourceById.get(link.sourceId)
				: undefined;
			jobs.push({
				assetType: "chapter_thumbnail",
				ownerType: "chapter_source",
				ownerId: link.id,
				url: link.thumbnailUrl,
				source: linkSource ? sourceConfig(linkSource, runId) : null,
				hint: (sha256, contentType) => mediaAssetObjectKey(sha256, contentType),
			});
		}
		for (const job of jobs) {
			await waitForRunResume(runId);
			total += 1;
			try {
				const asset = await upsertStandaloneAsset({
					assetType: job.assetType,
					ownerType: job.ownerType,
					ownerId: job.ownerId,
					sourceId: job.source?.id ?? null,
					externalUrl: job.url,
				});
				if (!asset) {
					failed += 1;
					continue;
				}
				const result = await downloadStandaloneAsset(
					runId,
					asset,
					job.source,
					job.hint,
				);
				if (result.saved) saved += 1;
				bytes += result.bytes;
			} catch (error) {
				if (isRunControlError(error)) throw error;
				failed += 1;
				await addRunEvent(runId, `Gagal menyimpan ${job.assetType}`, {
					level: "error",
					details: {
						ownerId: job.ownerId,
						error: error instanceof Error ? error.message : String(error),
					},
				});
			}
		}
	}
	return { total, saved, failed, bytes };
}

async function syncAnimePosters(runId: string, scope: DownloadScope) {
	let total = 0;
	let saved = 0;
	let failed = 0;
	let bytes = 0;
	const conditions = [eq(sources.workspaceId, "anime")];
	if (scope.sourceKey) conditions.push(eq(sources.key, scope.sourceKey));
	const rows = await db
		.select({ link: animeSources, source: sources })
		.from(animeSources)
		.innerJoin(sources, eq(animeSources.sourceId, sources.id))
		.where(and(...conditions, isNotNull(animeSources.posterUrl)));
	for (const { link, source } of rows) {
		await waitForRunResume(runId);
		if (!link.posterUrl) continue;
		total += 1;
		try {
			const sourceConfigValue = sourceConfig(source, runId);
			const timestamp = now();
			const existingThumb = await db
				.select()
				.from(animeThumbnails)
				.where(
					and(
						eq(animeThumbnails.animeSourceId, link.id),
						eq(animeThumbnails.externalUrl, link.posterUrl),
					),
				)
				.limit(1);
			const thumbId =
				existingThumb[0]?.id ??
				(() => {
					const id = crypto.randomUUID();
					return id;
				})();
			if (!existingThumb[0]) {
				await db
					.insert(animeThumbnails)
					.values({
						id: thumbId,
						animeSourceId: link.id,
						externalUrl: link.posterUrl,
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
			if (!thumb) {
				failed += 1;
				continue;
			}
			if (thumb.downloadStatus === "saved" && thumb.blobSha256) {
				const blob = (
					await db
						.select()
						.from(imageBlobs)
						.where(eq(imageBlobs.sha256, thumb.blobSha256))
						.limit(1)
				)[0];
				if (blob && (await objectExists(blob.objectKey))) continue;
			}
			await db
				.update(animeThumbnails)
				.set({
					downloadStatus: "downloading",
					lastError: null,
					updatedAt: now(),
				})
				.where(eq(animeThumbnails.id, thumb.id));
			const blob = await downloadUrlToBlob(
				runId,
				link.posterUrl,
				sourceConfigValue,
				(sha256, contentType) =>
					animeThumbnailObjectKey({
						animeId: link.animeId,
						animeTitle: link.title,
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
			const asset = await upsertStandaloneAsset({
				assetType: "anime_poster",
				ownerType: "anime_source",
				ownerId: link.id,
				sourceId: source.id,
				externalUrl: link.posterUrl,
			});
			if (asset) {
				await db
					.update(mediaAssets)
					.set({
						blobSha256: blob.sha256,
						sha256: blob.sha256,
						contentType: blob.contentType,
						byteSize: blob.byteSize,
						downloadStatus: "saved",
						integrityStatus: "healthy",
						lastError: null,
						downloadedAt: now(),
						lastVerifiedAt: now(),
						updatedAt: now(),
					})
					.where(eq(mediaAssets.id, asset.id));
			}
			saved += 1;
			bytes += blob.byteSize;
		} catch (error) {
			if (isRunControlError(error)) throw error;
			failed += 1;
			await addRunEvent(runId, "Gagal menyimpan poster anime", {
				level: "error",
				details: {
					animeSourceId: link.id,
					error: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}
	return { total, saved, failed, bytes };
}

async function executeImageDownload(
	runId: string,
	scope: DownloadScope,
	workspaceId: string,
	options: RunImageOptions = {},
) {
	let progressTotal = 0;
	let progressCompleted = 0;
	let progressFailed = 0;
	let savedCount = 0;
	let totalBytes = 0;
	const startedAt = now();
	const verifyAll = options.verifyAll === true;

	try {
		await updateRun(runId, {
			status: "running",
			startedAt,
			currentStep: "Memeriksa object storage dan menyiapkan antrean",
		});
		await addRunEvent(runId, "Proses penyimpanan gambar dimulai", {
			details: { ...scope, workspaceId },
		});
		await withSourceNetworkRetry(transferSource(runId), () =>
			ensureBucketExists(),
		);

		if (workspaceId === "anime") {
			await updateRun(runId, {
				currentStep: "Menyinkronkan poster anime",
			});
			const posters = await syncAnimePosters(runId, scope);
			progressTotal += posters.total;
			progressCompleted += posters.total - posters.failed;
			progressFailed += posters.failed;
			savedCount += posters.saved;
			totalBytes += posters.bytes;
		} else if (isComicWorkspace(workspaceId)) {
			await updateRun(runId, {
				currentStep: "Menyinkronkan cover dan thumbnail",
			});
			const standalone = await syncStandaloneComicMedia(
				runId,
				workspaceId,
				scope,
			);
			progressTotal += standalone.total;
			progressCompleted += standalone.total - standalone.failed;
			progressFailed += standalone.failed;
			savedCount += standalone.saved;
			totalBytes += standalone.bytes;
		}

		const sourcesToProcess = scope.chapterId
			? await selectChapterSources(workspaceId, scope)
			: await selectChapterSources(workspaceId, scope);
		await updateRun(runId, {
			currentStep: sourcesToProcess.length
				? "Inventaris selesai; menyiapkan antrean chapter"
				: "Inventaris selesai; tidak ada chapter yang perlu diproses",
			progressTotal,
			progressCompleted,
			progressFailed,
		});

		for (const row of sourcesToProcess) {
			await waitForRunResume(runId);
			const source = sourceConfig(row.source, runId);
			try {
				await updateRun(runId, {
					currentStep: `${source.name}: memeriksa URL halaman chapter ${row.chapter.numberText}`,
					progressTotal,
					progressCompleted,
					progressFailed,
				});
				const pages = await db
					.select()
					.from(chapterPages)
					.where(
						and(
							eq(chapterPages.chapterSourceId, row.chapterSource.id),
							eq(chapterPages.isActive, true),
						),
					);
				if (pages.length === 0) {
					progressTotal += 1;
					progressCompleted += 1;
					progressFailed += 1;
					await addRunEvent(
						runId,
						`Lewati unduhan chapter ${row.chapter.numberText}: URL halaman belum tersedia di inventaris; jalankan discovery metadata terlebih dahulu`,
						{
							level: "warning",
							details: {
								chapterSourceId: row.chapterSource.id,
								chapter: row.chapter.numberText,
								workspaceId,
							},
						},
					);
					continue;
				}
				progressTotal += pages.length;
				let chapterSaved = 0;
				for (const page of pages) {
					await waitForRunResume(runId);
					try {
						const result = await storePage(runId, page, source, {
							seriesId: row.series.id,
							seriesTitle: row.series.title,
							chapterSourceId: row.chapterSource.id,
							chapterNumber: row.chapter.numberText,
							verifyAll,
						});
						if (result.saved) {
							savedCount += 1;
							chapterSaved += 1;
							totalBytes += result.byteSize;
						}
						progressCompleted += 1;
					} catch (error) {
						if (isRunControlError(error)) throw error;
						progressFailed += 1;
						progressCompleted += 1;
					}
				}
				await updateRun(runId, {
					currentStep: `${source.name}: chapter ${row.chapter.numberText} selesai, ${chapterSaved}/${pages.length} halaman tersimpan`,
					progressTotal,
					progressCompleted,
					progressFailed,
				});
			} catch (error) {
				if (isRunControlError(error)) throw error;
				const message = error instanceof Error ? error.message : String(error);
				await addRunEvent(
					runId,
					`${source.name}: chapter ${row.chapter.numberText} gagal diproses`,
					{ level: "error", details: { error: message } },
				);
			}
		}

		const finishedAt = now();
		const hasFailures = progressFailed > 0;
		await updateRun(runId, {
			progressTotal: Math.max(progressTotal, progressCompleted),
			progressCompleted,
			progressFailed,
		});
		await addRunEvent(
			runId,
			hasFailures
				? "Penyimpanan gambar selesai dengan sebagian error"
				: "Penyimpanan gambar selesai",
			{
				level: hasFailures ? "warning" : "info",
				details: {
					workspaceId,
					savedCount,
					totalBytes,
					progressFailed,
				},
			},
		);
		await finishRun(runId, hasFailures ? "partial" : "completed", {
			summary: {
				workspaceId,
				scope,
				savedCount,
				totalBytes,
				progressFailed,
			},
		});
		void finishedAt;
	} catch (error) {
		if (isRunControlError(error)) return;
		const message =
			error instanceof Error
				? error.message
				: "Kesalahan worker tidak diketahui";
		await addRunEvent(runId, "Worker gambar gagal dijalankan", {
			level: "error",
			details: { error: message },
		});
		try {
			await updateRun(runId, {
				progressTotal,
				progressCompleted,
				progressFailed,
			});
			await finishRun(runId, "failed", {
				errorMessage: message,
				summary: { workspaceId, scope },
			});
		} catch {
			// Lease already lost; recovery will resume the run.
		}
	} finally {
		clearRetryNotice(runId);
		activeRuns.delete(runId);
	}
}

async function runImageDownload(
	runId: string,
	scope: DownloadScope,
	workspaceId: string,
	options: RunImageOptions = {},
) {
	const mode =
		options.workerMode ?? (options.workerToken ? "recovery" : "start");
	const token = options.workerToken ?? (await claimRunWorkerToken(runId, mode));
	// Klaim yang gagal berarti worker lain memenangkan lease atomik di DB.
	// Jangan sentuh activeRuns: hanya pemilik lease yang boleh
	// menambah/menghapus agar worker yang kalah tidak memicu duplikat.
	if (!token) {
		return;
	}
	activeRuns.add(runId);
	try {
		await withRunWorkerLease(runId, token, () =>
			executeImageDownload(runId, scope, workspaceId, options),
		);
	} finally {
		await releaseRunWorker(runId, token);
		activeRuns.delete(runId);
	}
}

function scopeFromSummary(summaryJson: unknown): DownloadScope {
	const summary = parseJson(summaryJson);
	if (!summary || typeof summary !== "object") return {};
	const scope = (summary as Record<string, unknown>).scope;
	return parseJson(scope) as DownloadScope;
}

function workspaceFromSummary(summaryJson: unknown, fallback?: string) {
	const summary = parseJson(summaryJson);
	const candidate = (summary as Record<string, unknown>).workspaceId;
	const value = typeof candidate === "string" ? candidate : fallback;
	return value === "superkomik" || value === "anime" || value === "comic"
		? value
		: COMIC_WORKSPACE_ID;
}

export async function startImageDownload(
	scope: DownloadScope = {},
	options: RunImageOptions = {},
) {
	const workspaceId = options.workspaceId ?? COMIC_WORKSPACE_ID;
	const started = await beginRun({
		workspaceId,
		jobKey: `images:${workspaceId}`,
		kind: "images",
		mode: "full",
		triggeredBy: options.triggeredBy ?? "manual",
		summary: { scope, workspaceId, verifyAll: options.verifyAll === true },
	});

	if (started.created) {
		void runImageDownload(started.run.id, scope, workspaceId, options).catch(
			(error) => {
				console.error("Image worker could not be started", {
					runId: started.run.id,
					error: safeSourceErrorMessage(error),
				});
				activeRuns.delete(started.run.id);
			},
		);
	}
	return started.run;
}

export async function startChapterImageRepair(
	chapterId: string,
	workspaceId: string = COMIC_WORKSPACE_ID,
) {
	const scope: DownloadScope = { chapterId };
	const started = await beginRun({
		workspaceId,
		jobKey:
			workspaceId === COMIC_WORKSPACE_ID
				? `images:repair:${chapterId}`
				: `images:${workspaceId}:repair:${chapterId}`,
		kind: "images",
		mode: "full",
		triggeredBy: "manual",
		summary: { scope, reason: "reader_media_repair", workspaceId },
	});

	if (started.created) {
		void runImageDownload(started.run.id, scope, workspaceId).catch((error) => {
			console.error("Chapter repair worker could not be started", {
				runId: started.run.id,
				error: safeSourceErrorMessage(error),
			});
			activeRuns.delete(started.run.id);
		});
	} else if (
		started.run.status === "paused" ||
		started.run.status === "running"
	) {
		await resumeImageRun(started.run.id);
	}
	return started.run;
}

export async function resumeImageRun(
	runId: string,
	options: RunImageOptions = {},
) {
	const rows = await db
		.select()
		.from(scrapeRuns)
		.where(eq(scrapeRuns.id, runId))
		.limit(1);
	const run = rows[0];
	if (run?.kind !== "images") throw new Error("Image run tidak ditemukan");
	if (
		run.status !== "queued" &&
		run.status !== "paused" &&
		run.status !== "running"
	)
		throw new Error("Hanya download yang dijeda yang dapat dilanjutkan");

	if (!activeRuns.has(runId)) {
		const summary = readJsonObject(run.summaryJson);
		void runImageDownload(
			runId,
			scopeFromSummary(summary),
			workspaceFromSummary(summary, run.workspaceId),
			{
				...options,
				verifyAll:
					options.verifyAll ??
					(summary as { verifyAll?: boolean }).verifyAll === true,
				workerMode:
					options.workerMode ?? (options.workerToken ? "recovery" : "resume"),
			},
		).catch((error) => {
			if (isRunControlError(error)) return;
			console.error("Image worker could not be started", {
				runId,
				error: safeSourceErrorMessage(error),
			});
			activeRuns.delete(runId);
		});
	}
	return (
		await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId)).limit(1)
	)[0];
}

export async function retryImageRun(
	runId: string,
	options: RunImageOptions = {},
) {
	const rows = await db
		.select()
		.from(scrapeRuns)
		.where(eq(scrapeRuns.id, runId))
		.limit(1);
	const run = rows[0];
	if (run?.kind !== "images") throw new Error("Image run tidak ditemukan");
	if (!["partial", "failed", "cancelled"].includes(run.status))
		throw new Error("Run ini belum dapat dicoba ulang");
	const summary = readJsonObject(run.summaryJson);
	const scope = scopeFromSummary(summary);
	const workspaceId = workspaceFromSummary(summary, run.workspaceId);
	return scope.chapterId
		? startChapterImageRepair(scope.chapterId, workspaceId)
		: startImageDownload(scope, {
				...options,
				verifyAll:
					options.verifyAll ??
					(summary as { verifyAll?: boolean }).verifyAll === true,
				workspaceId,
			});
}
