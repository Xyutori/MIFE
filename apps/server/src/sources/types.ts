export type SourceConfig = {
	id: string;
	workspaceId?: string;
	key: string;
	name: string;
	baseUrl: string;
	prefix: string;
	requestDelayMs: number;
	runId?: string;
	workerToken?: string;
	maxRetries?: number;
};

export type SeriesRecord = {
	externalId: string;
	category?: string | null;
	slug?: string | null;
	sourceUrl?: string | null;
	title: string;
	alternativeTitle?: string | null;
	aliases?: string[];
	authors?: string[];
	artists?: string[];
	genres?: string[];
	formats?: string[];
	comicType?: string | null;
	countryId?: string | null;
	viewCount?: number | null;
	rating?: number | null;
	bookmarkCount?: number | null;
	popularityRank?: number | null;
	isFeatured?: boolean | null;
	isRecommended?: boolean | null;
	description?: string | null;
	coverImageUrl?: string | null;
	bannerImageUrl?: string | null;
	status?: string | null;
	releaseYear?: number | null;
	latestChapterId?: string | null;
	latestChapterNumber?: string | null;
	latestChapterAt?: string | null;
	sourceUpdatedAt?: string | null;
	raw: unknown;
};

export type ChapterRecord = {
	externalId: string;
	slug?: string | null;
	sourceUrl?: string | null;
	number: string;
	title?: string | null;
	thumbnailUrl?: string | null;
	publishedAt?: string | null;
	viewCount?: number | null;
	raw: unknown;
};

export type PageResult<T> = {
	items: T[];
	page: number;
	pageSize: number;
	totalPages: number;
	totalRecords: number;
};

export interface ComicSourceAdapter {
	listSeries(
		source: SourceConfig,
		options: { page: number; pageSize: number; category?: string },
	): Promise<PageResult<SeriesRecord>>;
	getSeries(source: SourceConfig, series: SeriesRecord): Promise<SeriesRecord>;
	listChapters(
		source: SourceConfig,
		series: SeriesRecord,
	): Promise<ChapterRecord[]>;
	getChapterPages(
		source: SourceConfig,
		chapter: ChapterRecord,
	): Promise<string[]>;
}
