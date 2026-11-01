import type { imageBlobs } from "@SyMi/db/schema/index";
import { imageVariants } from "@SyMi/db/schema/index";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { webpVariantObjectKey } from "../media/object-keys";
import { db } from "../services";
import { getObjectBytes, putObject } from "../storage/s3";
import { now } from "./common";
import { isRunControlError } from "./control";

export class InvalidImageBytesError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidImageBytesError";
	}
}

export type ValidatedImageBytes = {
	format: string;
	contentType: string;
	sha256: string;
};

const IMAGE_CONTENT_TYPES: Record<string, string> = {
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	heif: "image/heif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	jp2: "image/jp2",
	jxl: "image/jxl",
	png: "image/png",
	svg: "image/svg+xml",
	tiff: "image/tiff",
	webp: "image/webp",
};

function normalizedContentType(contentType: string) {
	const normalized = contentType.split(";")[0]?.trim().toLowerCase();
	if (normalized === "image/jpg" || normalized === "image/pjpeg")
		return "image/jpeg";
	if (normalized === "image/heic") return "image/heif";
	return normalized;
}

export async function validateImageBytes(
	bytes: Uint8Array,
): Promise<ValidatedImageBytes> {
	try {
		const image = sharp(bytes, { animated: true, failOn: "error" });
		const metadata = await image.metadata();
		const format = metadata.format;
		const contentType = format ? IMAGE_CONTENT_TYPES[format] : null;
		if (!format || !contentType || !metadata.width || !metadata.height)
			throw new InvalidImageBytesError("Data media bukan gambar yang valid");
		// Force a full decode: metadata alone accepts some truncated or mislabeled files.
		await image.stats();
		return {
			format,
			contentType,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	} catch (error) {
		if (error instanceof InvalidImageBytesError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		throw new InvalidImageBytesError(
			`Data media bukan gambar yang valid: ${message}`,
		);
	}
}

export async function ensureImageVariants(
	blob: typeof imageBlobs.$inferSelect,
	originalBytes: Uint8Array,
	_verified?: unknown,
	verifiedImage?: ValidatedImageBytes,
) {
	const actualSha256 = createHash("sha256").update(originalBytes).digest("hex");
	const validated =
		verifiedImage?.sha256 === actualSha256
			? verifiedImage
			: await validateImageBytes(originalBytes);
	if (validated.sha256 !== blob.sha256)
		throw new InvalidImageBytesError("Checksum gambar asli tidak cocok");
	if (normalizedContentType(blob.contentType) !== validated.contentType)
		throw new InvalidImageBytesError(
			`Tipe konten ${blob.contentType} tidak cocok dengan format gambar ${validated.format}`,
		);

	const timestamp = now();
	await db
		.insert(imageVariants)
		.values({
			id: crypto.randomUUID(),
			blobSha256: blob.sha256,
			format: "original",
			objectKey: blob.objectKey,
			contentType: blob.contentType,
			byteSize: blob.byteSize,
			sha256: blob.sha256,
			createdAt: timestamp,
			updatedAt: timestamp,
		})
		.onConflictDoNothing();

	const existingWebp = await db
		.select()
		.from(imageVariants)
		.where(
			and(
				eq(imageVariants.blobSha256, blob.sha256),
				eq(imageVariants.format, "webp"),
			),
		)
		.limit(1);
	const webpKey = webpVariantObjectKey(blob.objectKey);
	const webpBytesBuffer =
		validated.format === "webp"
			? Buffer.from(originalBytes)
			: await sharp(originalBytes, { animated: true, failOn: "error" })
					.webp({
						quality: 96,
						alphaQuality: 100,
						effort: 6,
						smartSubsample: true,
					})
					.toBuffer();
	const webpBytes = new Uint8Array(webpBytesBuffer);
	const webpSha256 = createHash("sha256").update(webpBytes).digest("hex");
	const existingVariant = existingWebp[0];
	if (existingVariant?.objectKey === webpKey) {
		try {
			const existingBytes = await getObjectBytes(webpKey);
			const existingSha256 = createHash("sha256")
				.update(existingBytes)
				.digest("hex");
			if (
				existingSha256 === webpSha256 &&
				existingBytes.byteLength === webpBytes.byteLength
			) {
				await db
					.update(imageVariants)
					.set({
						contentType: "image/webp",
						byteSize: webpBytes.byteLength,
						sha256: webpSha256,
						updatedAt: timestamp,
					})
					.where(eq(imageVariants.id, existingVariant.id));
				return;
			}
		} catch (error) {
			if (isRunControlError(error)) throw error;
			// Rebuild the derivative when its canonical object is missing or invalid.
		}
	}

	// A valid object under a legacy key cannot be reused after changing the
	// database row to the canonical key: the canonical object must exist first.
	await putObject(webpKey, webpBytes, "image/webp");
	let uploadedWebpBytes: Uint8Array;
	try {
		uploadedWebpBytes = await getObjectBytes(webpKey);
	} catch (error) {
		if (isRunControlError(error)) throw error;
		throw new Error("Verifikasi varian WebP setelah upload gagal");
	}
	if (
		uploadedWebpBytes.byteLength !== webpBytes.byteLength ||
		createHash("sha256").update(uploadedWebpBytes).digest("hex") !== webpSha256
	)
		throw new Error("Verifikasi checksum varian WebP setelah upload gagal");

	if (existingVariant) {
		await db
			.update(imageVariants)
			.set({
				objectKey: webpKey,
				contentType: "image/webp",
				byteSize: webpBytes.byteLength,
				sha256: webpSha256,
				updatedAt: timestamp,
			})
			.where(eq(imageVariants.id, existingVariant.id));
		return;
	}

	await db
		.insert(imageVariants)
		.values({
			id: crypto.randomUUID(),
			blobSha256: blob.sha256,
			format: "webp",
			objectKey: webpKey,
			contentType: "image/webp",
			byteSize: webpBytes.byteLength,
			sha256: webpSha256,
			createdAt: timestamp,
			updatedAt: timestamp,
		})
		.onConflictDoNothing();

	// Another worker may have inserted the variant after our initial lookup.
	// Reconcile the unique blob/format row so it never points at an absent key.
	const canonicalRows = await db
		.select()
		.from(imageVariants)
		.where(
			and(
				eq(imageVariants.blobSha256, blob.sha256),
				eq(imageVariants.format, "webp"),
			),
		)
		.limit(1);
	const canonicalVariant = canonicalRows[0];
	if (!canonicalVariant)
		throw new Error("Metadata varian WebP tidak berhasil disimpan");
	if (
		canonicalVariant.objectKey !== webpKey ||
		canonicalVariant.contentType !== "image/webp" ||
		canonicalVariant.byteSize !== webpBytes.byteLength ||
		canonicalVariant.sha256 !== webpSha256
	) {
		await db
			.update(imageVariants)
			.set({
				objectKey: webpKey,
				contentType: "image/webp",
				byteSize: webpBytes.byteLength,
				sha256: webpSha256,
				updatedAt: timestamp,
			})
			.where(eq(imageVariants.id, canonicalVariant.id));
	}
}
