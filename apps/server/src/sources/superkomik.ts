import { decryptDoujindesuResponse } from "./doujindesu-decrypt";
import {
	absoluteSourceUrl,
	asArray,
	asRecord,
	asString,
	fetchSource,
	readSourceJson,
	SourceResponseValidationError,
	sourceUrl,
	withSourceNetworkRetry,
} from "./http";
import type {
	ChapterRecord,
	ComicSourceAdapter,
	PageResult,
	SeriesRecord,
	SourceConfig,
} from "./types";

// This value is shipped by the provider's public frontend and is not a user credential.
const APP_SECRET = "dfdf72051dbfdc7d76889ebd31324e74";
const API_HEADERS = {
	"X-App-Secret": APP_SECRET,
	"X-Device-ID": "symi-superkomik",
};

// Exact hosts observed in the provider's cover and reader media URLs.
export const SUPERKOMIK_MEDIA_HOSTS = [
	"doujin.desu.xxx",
	"pic.desu.xxx",
	"amz-ch.desu.pics",
] as const;

function requireString(value: unknown, field: string) {
	const parsed = asString(value);
	if (!parsed)
		throw new SourceResponseValidationError(
			`Super Komik response is missing ${field}`,
		);
	return parsed;
}

function numberOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function names(value: unknown): string[] {
	if (typeof value === "string")
		return value
			.split(/[,;\n]/)
			.map((name) => name.trim())
			.filter(Boolean);
	if (Array.isArray(value))
		return value
			.map((item) =>
				typeof item === "string" ? item.trim() : asString(asRecord(item).name),
			)
			.filter((name): name is string => Boolean(name));
	return [];
}

function genreNames(raw: Record<string, unknown>) {
	return asArray(raw.manga_genres)
		.map((item) => asString(asRecord(asRecord(item).genres).name))
		.filter((name): name is string => Boolean(name));
}

function mapSeries(
	value: unknown,
	source: SourceConfig,
	category?: string,
): SeriesRecord {
	const raw = asRecord(value);
	const externalId = requireString(raw.id, "manga id");
	const title = requireString(raw.title, "manga title");
	const slug = requireString(raw.slug, "manga slug");
	const latestChapter = asRecord(asArray(raw.chapters)[0]);
	const alternativeTitle = asString(raw.alt_titles);
	const sourceUpdatedAt = asString(raw.updated_at);

	return {
		externalId,
		slug,
		sourceUrl: absoluteSourceUrl(source, `/manga/${encodeURIComponent(slug)}`),
		category: category ?? asString(raw.type),
		title,
		alternativeTitle,
		aliases: names(alternativeTitle),
		authors: names(raw.author),
		artists: names(raw.artist),
		genres: genreNames(raw),
		comicType: asString(raw.type),
		viewCount: numberOrNull(raw.views),
		rating: numberOrNull(raw.rating),
		description: asString(raw.description),
		coverImageUrl: absoluteSourceUrl(source, asString(raw.cover_url)),
		bannerImageUrl: absoluteSourceUrl(source, asString(raw.banner_url)),
		status: asString(raw.status),
		latestChapterId: asString(latestChapter.id),
		latestChapterNumber: asString(latestChapter.chapter_number),
		latestChapterAt: asString(latestChapter.created_at),
		sourceUpdatedAt,
		raw: value,
	};
}

function mapChapter(
	value: unknown,
	source: SourceConfig,
	seriesSlug: string,
): ChapterRecord {
	const raw = asRecord(value);
	const externalId = requireString(raw.id, "chapter id");
	const number = requireString(raw.chapter_number, "chapter number");
	const chapterTitle = asString(raw.title);
	return {
		externalId,
		number,
		title: chapterTitle,
		slug: externalId,
		sourceUrl: absoluteSourceUrl(
			source,
			`/manga/${encodeURIComponent(seriesSlug)}/chapter/${encodeURIComponent(externalId)}`,
		),
		publishedAt: asString(raw.created_at),
		viewCount: numberOrNull(raw.views),
		raw: value,
	};
}

async function getJson(source: SourceConfig, url: URL): Promise<unknown> {
	return withSourceNetworkRetry(source, async () => {
		const response = await fetchSource(
			source,
			url,
			"application/json, application/*+json",
			{
				maxResponseBytes: 12 * 1024 * 1024,
				headers: API_HEADERS,
			},
		);
		const envelope = await readSourceJson<unknown>(response, source.name);
		try {
			return decryptDoujindesuResponse(envelope);
		} catch {
			throw new SourceResponseValidationError(
				"Super Komik returned an unreadable encrypted response",
			);
		}
	});
}

function validatePage(page: number, pageSize: number) {
	if (
		!Number.isSafeInteger(page) ||
		page < 1 ||
		!Number.isSafeInteger(pageSize) ||
		pageSize < 1
	)
		throw new SourceResponseValidationError(
			"Super Komik pagination requires positive integer page and pageSize values",
		);
}

export const superkomikAdapter: ComicSourceAdapter = {
	async listSeries(
		source,
		{ page, pageSize, category },
	): Promise<PageResult<SeriesRecord>> {
		validatePage(page, pageSize);
		const offset = (page - 1) * pageSize;
		if (!Number.isSafeInteger(offset))
			throw new SourceResponseValidationError(
				"Super Komik pagination offset exceeds the supported range",
			);
		const query = new URLSearchParams({
			limit: String(pageSize),
			offset: String(offset),
			sort: "latest_chapter",
		});
		if (category?.trim()) query.set("type", category.trim());

		const requestUrl = sourceUrl(source, "/api/manga", query);
		const response = await withSourceNetworkRetry(source, async () => {
			const result = await fetchSource(
				source,
				requestUrl,
				"application/json, application/*+json",
				{
					maxResponseBytes: 12 * 1024 * 1024,
					headers: API_HEADERS,
				},
			);
			const encrypted = await readSourceJson<unknown>(result, source.name);
			let payload: unknown;
			try {
				payload = decryptDoujindesuResponse(encrypted);
			} catch {
				throw new SourceResponseValidationError(
					"Super Komik returned an unreadable encrypted listing",
				);
			}
			return { payload, totalCountHeader: result.headers.get("x-total-count") };
		});

		if (!Array.isArray(response.payload))
			throw new SourceResponseValidationError(
				"Super Komik manga listing is not an array",
			);
		const totalRecords = Number(response.totalCountHeader);
		if (
			!response.totalCountHeader ||
			!/^\d+$/.test(response.totalCountHeader) ||
			!Number.isSafeInteger(totalRecords) ||
			totalRecords < 0
		)
			throw new SourceResponseValidationError(
				"Super Komik manga listing is missing a valid x-total-count header",
			);

		const expectedItems = Math.max(
			0,
			Math.min(pageSize, totalRecords - offset),
		);
		if (response.payload.length !== expectedItems)
			throw new SourceResponseValidationError(
				"Super Komik manga item count conflicts with x-total-count",
			);
		const items = response.payload.map((item) => {
			const mapped = mapSeries(item, source, category);
			if (!mapped.externalId || !mapped.title || !mapped.slug)
				throw new SourceResponseValidationError(
					"Super Komik manga listing contains an incomplete item",
				);
			return mapped;
		});
		return {
			items,
			page,
			pageSize,
			totalPages: totalRecords === 0 ? 0 : Math.ceil(totalRecords / pageSize),
			totalRecords,
		};
	},

	async getSeries(source, series): Promise<SeriesRecord> {
		const slug = series.slug ?? asString(asRecord(series.raw).slug);
		if (!slug)
			throw new SourceResponseValidationError(
				"Super Komik manga detail requires a source slug",
			);
		const payload = await getJson(
			source,
			sourceUrl(source, `/api/manga/${encodeURIComponent(slug)}`),
		);
		const raw = asRecord(payload);
		if (!asString(raw.id) || !asString(raw.slug) || !asString(raw.title))
			throw new SourceResponseValidationError(
				"Super Komik manga detail is missing its id, slug, or title",
			);
		return mapSeries(payload, source, series.category ?? undefined);
	},

	async listChapters(source, series): Promise<ChapterRecord[]> {
		// Metadata discovery already hydrates the series. Reuse its chapter list and
		// fetch detail only when the adapter is called with a summary card directly.
		const summaryChapters = asRecord(series.raw).chapters;
		const detail = Array.isArray(summaryChapters)
			? series
			: await this.getSeries(source, series);
		const slug = detail.slug;
		const rawChapters = asRecord(detail.raw).chapters;
		if (!Array.isArray(rawChapters))
			throw new SourceResponseValidationError(
				"Super Komik manga detail does not contain a chapter array",
			);
		const chapters = rawChapters.map((chapter) =>
			mapChapter(chapter, source, slug ?? series.externalId),
		);
		if (
			new Set(chapters.map((chapter) => chapter.externalId)).size !==
			chapters.length
		)
			throw new SourceResponseValidationError(
				"Super Komik chapter list contains duplicate IDs",
			);
		return chapters;
	},

	async getChapterPages(source, chapter): Promise<string[]> {
		const payload = await getJson(
			source,
			sourceUrl(
				source,
				`/api/chapters/${encodeURIComponent(chapter.externalId)}`,
			),
		);
		const raw = asRecord(payload);
		if (
			asString(raw.id) !== chapter.externalId ||
			!Array.isArray(raw.content_urls)
		)
			throw new SourceResponseValidationError(
				"Super Komik reader response does not match the requested chapter or is missing its content_urls array",
			);
		const pages = raw.content_urls.map((value, index) => {
			const valueString = asString(value);
			const url = absoluteSourceUrl(source, valueString);
			if (!url)
				throw new SourceResponseValidationError(
					`Super Komik reader page ${index + 1} is not a valid HTTP image URL`,
				);
			return url;
		});
		return pages;
	},
};
