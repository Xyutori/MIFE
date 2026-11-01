import { apiBase, fetchUntilConnected, readJson } from "#lib/api.ts";

/** Typed client mirror katalog komik untuk Super Komik (kontrak XyMI). */

export interface SuperKomikItem {
	id: string;
	title: string;
	alternativeTitle: string | null;
	description: string | null;
	coverImageUrl: string | null;
	status: string | null;
	genres: string[];
	authors: string[];
	latestChapterNumber: string | null;
	latestChapterAt: string | null;
}

export interface SuperKomikCatalog {
	items: SuperKomikItem[];
	page: number;
	pageSize: number;
	totalPages: number;
	totalRecords: number;
}

export interface SuperKomikChapter {
	id: string;
	numberText: string;
	title: string | null;
	publishedAt: string | null;
	thumbnailUrl: string | null;
}

export interface SuperKomikDetail {
	series: {
		id: string;
		title: string;
		alternativeTitle: string | null;
		description: string | null;
		coverImageUrl: string | null;
		bannerUrl: string | null;
		status: string | null;
		authors: string[];
		artists: string[];
		genres: string[];
		formats: string[];
		rating: number | null;
		viewCount: number | null;
	};
	chapters: SuperKomikChapter[];
	page: number;
	pageSize: number;
	totalChapters: number;
	totalPages: number;
	hasMore: boolean;
}

export interface SuperKomikReaderPayload {
	series: { id: string; title: string };
	chapter: {
		id: string;
		numberText: string;
		title: string | null;
	};
	pages: { id: string; url: string; pageIndex: number }[];
	previousChapterId: string | null;
	nextChapterId: string | null;
}

export async function getSuperKomikCatalog(
	params: { page?: number; pageSize?: number; q?: string },
	signal?: AbortSignal,
): Promise<SuperKomikCatalog> {
	const search = new URLSearchParams({
		page: String(params.page ?? 1),
		pageSize: String(params.pageSize ?? 24),
		q: params.q?.trim() ?? "",
	});
	const response = await fetchUntilConnected(
		`${apiBase()}/api/v1/super-komik/catalog?${search}`,
		{ signal, credentials: "include" },
	);
	const payload = await readJson<SuperKomikCatalog>(response);
	return payload;
}

export async function getSuperKomikDetail(
	seriesId: string,
	page = 1,
	signal?: AbortSignal,
): Promise<SuperKomikDetail> {
	const response = await fetchUntilConnected(
		`${apiBase()}/api/v1/super-komik/series/${encodeURIComponent(seriesId)}?page=${page}&pageSize=100`,
		{ signal, credentials: "include" },
	);
	return readJson<SuperKomikDetail>(response);
}

export async function getSuperKomikChapter(
	chapterId: string,
	signal?: AbortSignal,
): Promise<SuperKomikReaderPayload> {
	const response = await fetchUntilConnected(
		`${apiBase()}/api/v1/super-komik/chapters/${encodeURIComponent(chapterId)}`,
		{ signal, credentials: "include" },
	);
	return readJson<SuperKomikReaderPayload>(response);
}
