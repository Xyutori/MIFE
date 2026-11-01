import { parse } from "node-html-parser";
import {
	absoluteSourceUrl,
	asArray,
	asRecord,
	asString,
	fetchSource,
	readSourceText,
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

type InertiaPage = {
	component?: string;
	props?: Record<string, unknown>;
};

class KomikCastPageDataMissingError extends Error {
	constructor(
		readonly html: string,
		readonly pageUrl: string,
	) {
		super("KomikCast response did not include Inertia page data");
		this.name = "KomikCastPageDataMissingError";
	}
}

function decodeHtml(value: string) {
	return value
		.replaceAll("&quot;", '"')
		.replaceAll("&#039;", "'")
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

async function getPage(source: SourceConfig, url: URL): Promise<InertiaPage> {
	const requestUrl =
		url.origin === new URL(source.baseUrl).origin
			? sourceUrl(source, `${url.pathname}${url.search}`)
			: url;
	return withSourceNetworkRetry(source, async () => {
		const response = await fetchSource(
			source,
			requestUrl,
			"text/html, application/xhtml+xml",
			{ maxResponseBytes: 12 * 1024 * 1024 },
		);
		const html = await readSourceText(response, source.name);
		const pageHead = html.slice(0, 100_000);
		const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
		if (
			/just a moment|attention required|access denied|verify you are human|security check/i.test(
				pageTitle,
			) ||
			(/cloudflare|cf-ray/i.test(pageHead) &&
				/challenge|checking your browser/i.test(pageHead))
		)
			throw new SourceResponseValidationError(
				"KomikCast returned a challenge page instead of chapter content",
			);
		const match = html.match(/data-page\s*=\s*"([^"]+)"/i);
		if (!match?.[1])
			throw new KomikCastPageDataMissingError(
				html,
				response.url || requestUrl.toString(),
			);
		try {
			const page = JSON.parse(decodeHtml(match[1])) as InertiaPage;
			if (
				typeof page.component !== "string" ||
				!page.component.trim() ||
				!page.props ||
				typeof page.props !== "object" ||
				Array.isArray(page.props)
			)
				throw new Error("KomikCast returned incomplete Inertia page data");
			return page;
		} catch (error) {
			if (
				error instanceof SyntaxError &&
				/unexpected (?:end|eof)|unexpected eof|unterminated|incomplete json|end of json/i.test(
					error.message,
				)
			)
				throw error;
			if (error instanceof SyntaxError)
				throw new SourceResponseValidationError(
					"KomikCast returned invalid Inertia page JSON",
				);
			throw error;
		}
	});
}

function legacyChapterImages(html: string, pageUrl: string) {
	const document = parse(html);
	const selectors = [
		"img.klazy.ww",
		"#chapter-content img",
		"#readerarea img",
		".reader-area img",
		".reading-content img",
		".chapter-content img",
	];
	let candidates = [] as ReturnType<typeof document.querySelectorAll>;
	for (const selector of selectors) {
		candidates = document.querySelectorAll(selector);
		if (candidates.length > 0) break;
	}

	const urls = new Set<string>();
	for (const image of candidates) {
		const values = [
			image.getAttribute("data-src"),
			image.getAttribute("data-lazy-src"),
			image.getAttribute("data-original"),
			image.getAttribute("data-lazy"),
			image.getAttribute("data-cfsrc"),
			image.getAttribute("src"),
		].filter((value): value is string => Boolean(value?.trim()));

		for (const value of values) {
			try {
				const imageUrl = new URL(value.trim(), pageUrl);
				if (imageUrl.protocol !== "http:" && imageUrl.protocol !== "https:")
					continue;
				urls.add(imageUrl.toString());
				break;
			} catch {
				// Ignore malformed and placeholder URLs, then try the next lazy attribute.
			}
		}
	}
	return [...urls];
}

function props(page: InertiaPage) {
	return asRecord(page.props);
}

function names(value: unknown): string[] {
	const values = Array.isArray(value)
		? value
		: value === null || value === undefined
			? []
			: [value];
	return values
		.map((item) => {
			if (typeof item === "string" || typeof item === "number")
				return String(item).trim();
			const record = asRecord(item);
			return asString(record.name) ?? asString(record.title) ?? "";
		})
		.filter(Boolean);
}

function numberOrNull(value: unknown) {
	const parsed = Number(value);
	return value !== null && value !== undefined && Number.isFinite(parsed)
		? parsed
		: null;
}

function mapSeries(rawValue: unknown, source: SourceConfig): SeriesRecord {
	const raw = asRecord(rawValue);
	const title = asString(raw.title) ?? "Untitled";
	const slug = asString(raw.slug);
	const status = asString(raw.status);
	const year = numberOrNull(raw.release_year);
	const latestChapter = asRecord(asArray(raw.chapters).at(0));

	return {
		externalId: asString(raw.id) ?? slug ?? title,
		slug,
		sourceUrl:
			asString(raw.source_url) ??
			(slug
				? absoluteSourceUrl(source, `/manga/${encodeURIComponent(slug)}`)
				: null),
		title,
		aliases: slug ? [slug.replace(/[-_]+/g, " ")] : [],
		authors: names(raw.author),
		artists: names(raw.artist),
		genres: names(raw.genres),
		comicType: asString(raw.type),
		viewCount: numberOrNull(raw.views_count),
		rating: numberOrNull(raw.rating),
		isFeatured: typeof raw.is_featured === "boolean" ? raw.is_featured : null,
		description: asString(raw.synopsis),
		coverImageUrl: absoluteSourceUrl(source, asString(raw.poster)),
		status,
		releaseYear: year !== null && year > 0 ? year : null,
		latestChapterId: asString(latestChapter.id),
		latestChapterNumber: asString(latestChapter.chapter_number),
		latestChapterAt:
			asString(latestChapter.created_at) ?? asString(latestChapter.updated_at),
		sourceUpdatedAt:
			asString(raw.updated_at) ??
			asString(latestChapter.updated_at) ??
			asString(latestChapter.created_at),
		raw: rawValue,
	};
}

function mapChapter(
	rawValue: unknown,
	source: SourceConfig,
	mangaSlug?: string | null,
): ChapterRecord {
	const raw = asRecord(rawValue);
	const slug = asString(raw.slug);
	const number =
		asString(raw.chapter_number) ??
		slug?.replace(/^chapter-/i, "") ??
		asString(raw.title)?.replace(/^chapter\s*/i, "") ??
		"0";
	const sourceUrlValue = asString(raw.source_url);
	const path =
		sourceUrlValue ??
		(mangaSlug && (slug || number !== "0")
			? `/manga/${encodeURIComponent(mangaSlug)}/chapter/${encodeURIComponent(number)}`
			: null);
	const sourceUrl = chapterUrl(source, path, number);

	return {
		externalId: asString(raw.id) ?? slug ?? `${mangaSlug ?? "manga"}-${number}`,
		slug,
		sourceUrl,
		number,
		title: asString(raw.title),
		thumbnailUrl: absoluteSourceUrl(
			source,
			asString(raw.thumbnail) ?? asString(raw.thumbnail_url),
		),
		publishedAt: asString(raw.created_at) ?? asString(raw.updated_at),
		viewCount: numberOrNull(raw.views_count),
		raw: rawValue,
	};
}

// KomikCast reader paths use the chapter number, while older records store slugs like "chapter-19".
function chapterUrl(
	source: SourceConfig,
	value: string | null,
	chapterNumber?: string,
) {
	const absoluteUrl = absoluteSourceUrl(source, value);
	if (!absoluteUrl) return null;

	try {
		const url = new URL(absoluteUrl);
		const match = url.pathname.match(/^(.*\/chapter\/)([^/]+)\/?$/i);
		if (!match) return absoluteUrl;

		const segment = decodeURIComponent(match[2]!);
		const slugNumber = segment.match(/^chapter-(.+)$/i)?.[1];
		if (!slugNumber) return absoluteUrl;

		const number =
			chapterNumber && chapterNumber !== "0" ? chapterNumber : slugNumber;
		url.pathname = `${match[1]}${encodeURIComponent(number)}`;
		return url.toString();
	} catch {
		return absoluteUrl;
	}
}

function pagination(value: unknown, expectedPage: number) {
	const raw = asRecord(value);
	const page = Number(raw.current_page);
	const pageSize = Number(raw.per_page);
	const totalPages = Number(raw.last_page);
	const totalRecords = Number(raw.total);
	if (
		!Number.isSafeInteger(page) ||
		page < 1 ||
		page !== expectedPage ||
		!Number.isSafeInteger(pageSize) ||
		pageSize < 1 ||
		!Number.isSafeInteger(totalPages) ||
		!Number.isSafeInteger(totalRecords) ||
		totalRecords < 0 ||
		totalPages < 0 ||
		(totalRecords === 0 && (totalPages > 1 || expectedPage !== 1)) ||
		(totalRecords > 0 && totalPages !== Math.ceil(totalRecords / pageSize)) ||
		(totalPages > 0 && totalPages < expectedPage)
	)
		throw new SourceResponseValidationError(
			"KomikCast manga feed is missing valid pagination metadata",
		);
	return {
		page,
		pageSize,
		totalPages,
		totalRecords,
	};
}

function findImageUrl(value: unknown): string | null {
	if (typeof value === "string")
		return value.trim() && !/^(?:data|javascript):/i.test(value)
			? value.trim()
			: null;
	const record = asRecord(value);
	return (
		asString(record.r2_url) ??
		asString(record.image_path) ??
		asString(record.url) ??
		asString(record.src) ??
		asString(record.image_url) ??
		asString(record.image)
	);
}

export const komikcastAdapter: ComicSourceAdapter = {
	async listSeries(
		source,
		{ page, pageSize },
	): Promise<PageResult<SeriesRecord>> {
		const query = new URLSearchParams({
			page: String(page),
			per_page: String(pageSize),
		});
		const pageData = await getPage(source, sourceUrl(source, "/manga", query));
		const mangas = asRecord(props(pageData).mangas);
		if (!Array.isArray(mangas.data))
			throw new SourceResponseValidationError(
				"KomikCast manga feed is missing its data array",
			);
		const items = asArray(mangas.data).map((item) => {
			const raw = asRecord(item);
			if (!asString(raw.id) && !asString(raw.slug))
				throw new SourceResponseValidationError(
					"KomikCast manga feed contains an item without an ID or slug",
				);
			if (!asString(raw.title))
				throw new SourceResponseValidationError(
					"KomikCast manga feed contains an item without a title",
				);
			return mapSeries(raw, source);
		});
		const paginationData = pagination(mangas, page);
		const expectedItems =
			paginationData.totalRecords === 0
				? 0
				: Math.min(
						paginationData.pageSize,
						paginationData.totalRecords - (page - 1) * paginationData.pageSize,
					);
		if (items.length !== expectedItems)
			throw new SourceResponseValidationError(
				"KomikCast manga feed item count conflicts with its pagination metadata",
			);
		return {
			items,
			...paginationData,
		};
	},

	async getSeries(source, series): Promise<SeriesRecord> {
		const path = series.slug
			? `/manga/${encodeURIComponent(series.slug)}`
			: `/manga/${encodeURIComponent(series.externalId)}`;
		const pageData = await getPage(source, sourceUrl(source, path));
		const raw = asRecord(props(pageData).manga);
		if (!asString(raw.id) || !asString(raw.title))
			throw new Error("KomikCast manga detail is missing its ID or title");
		return mapSeries(raw, source);
	},

	async listChapters(source, series): Promise<ChapterRecord[]> {
		const raw = asRecord(series.raw);
		if (!Array.isArray(raw.chapters))
			throw new Error("KomikCast manga detail is missing its chapter list");
		const chapters = asArray(raw.chapters);
		return chapters.map((chapter) => {
			const mapped = mapChapter(chapter, source, series.slug);
			if (!mapped.externalId || !mapped.sourceUrl)
				throw new Error("KomikCast chapter is missing its ID or URL");
			return mapped;
		});
	},

	async getChapterPages(source, chapter): Promise<string[]> {
		if (!chapter.sourceUrl) throw new Error("KomikCast chapter URL is missing");
		const rawChapter = asRecord(chapter.raw);
		const chapterNumber = asString(rawChapter.chapter_number) ?? chapter.number;
		const url = chapterUrl(source, chapter.sourceUrl, chapterNumber);
		if (!url) throw new Error("KomikCast chapter URL is invalid");
		let pageData: InertiaPage;
		try {
			pageData = await getPage(source, new URL(url));
		} catch (error) {
			if (!(error instanceof KomikCastPageDataMissingError)) throw error;
			const legacyImages = legacyChapterImages(error.html, error.pageUrl);
			if (legacyImages.length > 0) return legacyImages;
			throw new Error(
				"KomikCast chapter response contains neither Inertia data nor recognized chapter images",
			);
		}
		const chapterData = asRecord(props(pageData).chapter);
		if (Object.keys(chapterData).length === 0)
			throw new Error("KomikCast chapter payload is missing or invalid");
		const rawImages = asArray(chapterData.images);
		const imageUrls = rawImages
			.map(findImageUrl)
			.map((url) => absoluteSourceUrl(source, url))
			.filter((url): url is string => Boolean(url));
		if (imageUrls.length > 0) return imageUrls;

		const content = asString(chapterData.content) ?? "";
		const htmlImages = [
			...content.matchAll(
				/<(?:img|source)\b[^>]*?(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi,
			),
		]
			.map((match) => match[1])
			.filter(
				(url): url is string =>
					typeof url === "string" && Boolean(url) && !url.startsWith("data:"),
			);
		const contentImageUrls = htmlImages
			.map((url) => absoluteSourceUrl(source, url))
			.filter((url): url is string => Boolean(url));
		if (contentImageUrls.length === 0)
			throw new Error(
				"KomikCast chapter response contains no valid page images",
			);
		return contentImageUrls;
	},
};
