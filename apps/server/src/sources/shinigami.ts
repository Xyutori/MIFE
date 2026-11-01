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

type ShinigamiEnvelope = {
	retcode?: number;
	message?: string;
	meta?: {
		page?: number;
		page_size?: number;
		total_page?: number;
		total_record?: number;
	};
	data?: unknown;
};

async function getJson(
	source: SourceConfig,
	url: URL,
): Promise<ShinigamiEnvelope> {
	return withSourceNetworkRetry(source, async () => {
		const response = await fetchSource(
			source,
			url,
			"application/json, application/*+json",
			{ maxResponseBytes: 12 * 1024 * 1024 },
		);
		const payload = await readSourceJson<ShinigamiEnvelope>(
			response,
			source.name,
		);
		if (!payload || typeof payload !== "object" || Array.isArray(payload))
			throw new Error("Shinigami returned an invalid API envelope");
		if (payload.retcode !== 0)
			throw new Error(
				`Shinigami API returned retcode ${payload.retcode ?? "unknown"}`,
			);
		if (!Object.hasOwn(payload, "data"))
			throw new Error("Shinigami API response is missing data");
		if (
			payload.meta !== undefined &&
			(!payload.meta ||
				typeof payload.meta !== "object" ||
				Array.isArray(payload.meta))
		)
			throw new Error(
				"Shinigami API response contains invalid pagination metadata",
			);
		return payload;
	});
}

function paginationMeta(meta: ShinigamiEnvelope["meta"], expectedPage: number) {
	const page = Number(meta?.page);
	const pageSize = Number(meta?.page_size);
	const totalPages = Number(meta?.total_page);
	const totalRecords = Number(meta?.total_record);
	if (
		!Number.isSafeInteger(page) ||
		page !== expectedPage ||
		!Number.isSafeInteger(pageSize) ||
		pageSize < 1 ||
		!Number.isSafeInteger(totalPages) ||
		!Number.isSafeInteger(totalRecords) ||
		totalRecords < 0 ||
		totalPages < 0 ||
		(totalRecords === 0 && (totalPages > 1 || page !== 1)) ||
		(totalRecords > 0 && totalPages !== Math.ceil(totalRecords / pageSize)) ||
		(totalPages > 0 && totalPages < page)
	)
		throw new SourceResponseValidationError(
			"Shinigami paginated response is missing valid pagination metadata",
		);
	return { page, pageSize, totalPages, totalRecords };
}

function mapSeries(
	rawValue: unknown,
	source: SourceConfig,
	category?: string,
): SeriesRecord {
	const raw = asRecord(rawValue);
	const taxonomy = asRecord(raw.taxonomy);
	const alternativeTitle = asString(raw.alternative_title);
	const latestChapterNumber = asString(raw.latest_chapter_number);
	const releaseYear = Number(raw.release_year);
	const numberOrNull = (value: unknown) => {
		const parsed = Number(value);
		return value !== null && value !== undefined && Number.isFinite(parsed)
			? parsed
			: null;
	};
	const taxonomyNames = (key: string) =>
		asArray(taxonomy[key])
			.map((value) => asString(asRecord(value).name))
			.filter((value): value is string => Boolean(value));

	return {
		externalId: asString(raw.manga_id) ?? "",
		category:
			category ??
			asString(
				asArray(taxonomy.Type)[0] && asRecord(asArray(taxonomy.Type)[0]).name,
			),
		title: asString(raw.title) ?? "Untitled",
		alternativeTitle,
		aliases: alternativeTitle ? [alternativeTitle] : [],
		authors: taxonomyNames("Author"),
		artists: taxonomyNames("Artist"),
		genres: taxonomyNames("Genre"),
		formats: taxonomyNames("Format"),
		comicType: taxonomyNames("Type")[0] ?? null,
		countryId: asString(raw.country_id),
		viewCount: numberOrNull(raw.view_count),
		rating: numberOrNull(raw.user_rate),
		bookmarkCount: numberOrNull(raw.bookmark_count),
		popularityRank: numberOrNull(raw.rank),
		isRecommended:
			typeof raw.is_recommended === "boolean" ? raw.is_recommended : null,
		description: asString(raw.description),
		coverImageUrl: absoluteSourceUrl(source, asString(raw.cover_image_url)),
		status: asString(raw.status),
		releaseYear:
			Number.isFinite(releaseYear) && releaseYear > 0 ? releaseYear : null,
		latestChapterId: asString(raw.latest_chapter_id),
		latestChapterNumber,
		latestChapterAt: asString(raw.latest_chapter_time),
		sourceUpdatedAt:
			asString(raw.updated_at) ?? asString(raw.latest_chapter_time),
		raw: rawValue,
	};
}

function mapChapter(rawValue: unknown, source: SourceConfig): ChapterRecord {
	const raw = asRecord(rawValue);
	const number = asString(raw.chapter_number) ?? "0";
	return {
		externalId: asString(raw.chapter_id) ?? "",
		number,
		title: asString(raw.chapter_title),
		thumbnailUrl: absoluteSourceUrl(source, asString(raw.thumbnail_image_url)),
		publishedAt: asString(raw.release_date) ?? asString(raw.created_at),
		viewCount:
			raw.view_count !== null &&
			raw.view_count !== undefined &&
			Number.isFinite(Number(raw.view_count))
				? Number(raw.view_count)
				: null,
		raw: rawValue,
	};
}

export const shinigamiAdapter: ComicSourceAdapter = {
	async listSeries(
		source,
		{ page, pageSize, category = "project" },
	): Promise<PageResult<SeriesRecord>> {
		const query = new URLSearchParams({
			type: category,
			page: String(page),
			page_size: String(pageSize),
			is_update: "true",
			sort: "latest",
			sort_order: "desc",
		});
		const payload = await getJson(
			source,
			sourceUrl(source, "/manga/list", query),
		);
		if (!Array.isArray(payload.data))
			throw new SourceResponseValidationError(
				"Shinigami manga list is not an array",
			);
		const items = payload.data.map((item) => {
			const raw = asRecord(item);
			if (!asString(raw.manga_id) || !asString(raw.title))
				throw new SourceResponseValidationError(
					"Shinigami manga list contains an item without an ID or title",
				);
			return mapSeries(raw, source, category);
		});
		const meta = paginationMeta(payload.meta, page);
		const expectedItems =
			meta.totalRecords === 0
				? 0
				: Math.min(
						meta.pageSize,
						meta.totalRecords - (page - 1) * meta.pageSize,
					);
		if (items.length !== expectedItems)
			throw new SourceResponseValidationError(
				"Shinigami manga item count conflicts with its pagination metadata",
			);
		return {
			items,
			...meta,
		};
	},

	async getSeries(source, series): Promise<SeriesRecord> {
		const payload = await getJson(
			source,
			sourceUrl(
				source,
				`/manga/detail/${encodeURIComponent(series.externalId)}`,
			),
		);
		const raw = asRecord(payload.data);
		if (!asString(raw.manga_id) || !asString(raw.title))
			throw new Error("Shinigami manga detail is missing its ID or title");
		return mapSeries(raw, source, series.category ?? undefined);
	},

	async listChapters(source, series): Promise<ChapterRecord[]> {
		const chapters: ChapterRecord[] = [];
		let page = 1;
		let totalPages = 1;
		let totalRecords = 0;

		do {
			const query = new URLSearchParams({
				page: String(page),
				page_size: "100",
				sort_by: "chapter_number",
				sort_order: "desc",
			});
			const payload = await getJson(
				source,
				sourceUrl(
					source,
					`/chapter/${encodeURIComponent(series.externalId)}/list`,
					query,
				),
			);
			if (!Array.isArray(payload.data))
				throw new SourceResponseValidationError(
					"Shinigami chapter list is not an array",
				);
			chapters.push(
				...payload.data.map((item) => {
					const chapter = mapChapter(item, source);
					if (!chapter.externalId)
						throw new Error("Shinigami chapter is missing its external ID");
					return chapter;
				}),
			);
			const meta = paginationMeta(payload.meta, page);
			const expectedItems =
				meta.totalRecords === 0
					? 0
					: Math.min(
							meta.pageSize,
							meta.totalRecords - (page - 1) * meta.pageSize,
						);
			if (payload.data.length !== expectedItems)
				throw new SourceResponseValidationError(
					"Shinigami chapter item count conflicts with its pagination metadata",
				);
			if (page === 1) {
				totalPages = meta.totalPages;
				totalRecords = meta.totalRecords;
			} else if (
				meta.totalPages !== totalPages ||
				meta.totalRecords !== totalRecords
			) {
				throw new SourceResponseValidationError(
					"Shinigami chapter pagination metadata changed during the scrape",
				);
			}
			page += 1;
		} while (page <= totalPages);
		if (chapters.length !== totalRecords)
			throw new SourceResponseValidationError(
				"Shinigami chapter list does not match its pagination record count",
			);
		if (
			new Set(chapters.map((chapter) => chapter.externalId)).size !==
			chapters.length
		)
			throw new SourceResponseValidationError(
				"Shinigami chapter list contains duplicate external IDs",
			);

		return chapters;
	},

	async getChapterPages(source, chapter): Promise<string[]> {
		const payload = await getJson(
			source,
			sourceUrl(
				source,
				`/chapter/detail/${encodeURIComponent(chapter.externalId)}`,
			),
		);
		const data = asRecord(payload.data);
		const chapterPayload = asRecord(data.chapter);
		if (Object.keys(chapterPayload).length === 0)
			throw new Error("Shinigami chapter detail is missing chapter data");
		const imageNames = asArray(chapterPayload.data)
			.map(asString)
			.filter((name): name is string => Boolean(name));
		if (imageNames.length === 0)
			throw new Error("Shinigami chapter detail contains no page images");
		const imageBase =
			asString(data.base_url) ?? asString(data.base_url_low) ?? source.baseUrl;
		const path = asString(chapterPayload.path) ?? "";

		return imageNames.map((name) => {
			const imageUrl = new URL(
				`${path.replace(/^\/*/, "").replace(/\/*$/, "")}/${name}`,
				`${imageBase.replace(/\/+$/, "")}/`,
			);
			if (imageUrl.protocol !== "http:" && imageUrl.protocol !== "https:")
				throw new Error("Shinigami returned a non-HTTP chapter image URL");
			return imageUrl.toString();
		});
	},
};
