const imageExtensions: Record<string, string> = {
	"image/avif": "avif",
	"image/bmp": "bmp",
	"image/gif": "gif",
	"image/heic": "heic",
	"image/heif": "heif",
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/svg+xml": "svg",
	"image/tiff": "tiff",
	"image/webp": "webp",
};

function pathSegment(value: string, fallback: string) {
	const normalized = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
		.replace(/-+$/g, "");
	return normalized || fallback;
}

function idSegment(value: string) {
	return (
		value
			.replace(/[^a-z0-9]/gi, "")
			.slice(0, 8)
			.toLowerCase() || "item"
	);
}

function userIdSegment(userId: string) {
	const normalized = userId
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
		.replace(/-+$/g, "");
	return normalized || "user";
}

function imageExtension(contentType: string) {
	return (
		imageExtensions[contentType.toLowerCase().split(";")[0] ?? ""] ?? "img"
	);
}

export function comicPageObjectKey(input: {
	seriesId: string;
	seriesTitle: string;
	chapterSourceId: string;
	chapterNumber: string;
	sourceKey: string;
	pageIndex: number;
	sha256: string;
	contentType: string;
}) {
	const series = `${pathSegment(input.seriesTitle, "untitled")}-${idSegment(
		input.seriesId,
	)}`;
	const chapter = `${pathSegment(input.chapterNumber, "chapter")}-${idSegment(
		input.chapterSourceId,
	)}`;
	const page = String(input.pageIndex + 1).padStart(4, "0");
	return `comics/${series}/${pathSegment(input.sourceKey, "source")}/chapters/${chapter}/pages/${page}-${input.sha256}.${imageExtension(input.contentType)}`;
}

export function animeThumbnailObjectKey(input: {
	animeId: string;
	animeTitle: string;
	sourceKey: string;
	sha256: string;
	contentType: string;
}) {
	const anime = `${pathSegment(input.animeTitle, "untitled")}-${idSegment(
		input.animeId,
	)}`;
	return `anime/${anime}/thumbnails/${pathSegment(input.sourceKey, "source")}/${input.sha256}.${imageExtension(input.contentType)}`;
}

export function webpVariantObjectKey(originalKey: string) {
	const extensionIndex = originalKey.lastIndexOf(".");
	const directoryIndex = originalKey.lastIndexOf("/");
	if (extensionIndex <= directoryIndex) return `${originalKey}.webp`;
	if (originalKey.slice(extensionIndex).toLowerCase() === ".webp")
		return `${originalKey.slice(0, extensionIndex)}.variant.webp`;
	return `${originalKey.slice(0, extensionIndex)}.webp`;
}

export function mediaAssetObjectKey(sha256: string, contentType: string) {
	return `media/assets/${sha256}.${imageExtension(contentType)}`;
}

/**
 * Key deterministik per (pengguna, jenis): upload ulang menimpa blob yang
 * sama sehingga tidak ada blob yatim bila ekstensi tidak berubah. Bila
 * ekstensi berubah (ganti format), blob lama dihapus eksplisit oleh caller
 * via user_media (lihat `media/user-media.ts`).
 */
export function userAvatarObjectKey(userId: string, contentType: string) {
	return `users/${userIdSegment(userId)}/avatar.${imageExtension(contentType)}`;
}

export function userHeaderObjectKey(userId: string, contentType: string) {
	return `users/${userIdSegment(userId)}/header.${imageExtension(contentType)}`;
}
