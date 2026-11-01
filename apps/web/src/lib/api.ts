import { ENV } from "../env.generated";

/** Base URL server API (kontrak JSON = XyMI, server :4000). */
export function apiBase(): string {
	return resolveApiBase(ENV.PUBLIC_SERVER_URL);
}

export function resolveApiBase(configuredUrl: string): string {
	const configured = new URL(configuredUrl, "http://localhost:4000");
	if (typeof window === "undefined") return configured.origin;

	const browserHost = window.location.hostname;
	const loopbacks = ["localhost", "127.0.0.1", "::1"];
	const configuredIsLoopback = loopbacks.includes(configured.hostname);
	const browserIsLoopback = loopbacks.includes(browserHost);
	if (configuredIsLoopback && !browserIsLoopback) return window.location.origin;
	return configured.origin;
}

/**
 * Fetch yang menunggu server sampai tersambung (retry backoff),
 * kecuali sinyal AbortController dibatalkan. Pola ala XyMI.
 */
export async function fetchUntilConnected(
	input: RequestInfo | URL,
	init: RequestInit = {},
): Promise<Response> {
	const signal = init.signal;
	let retryDelay = 1_000;

	while (true) {
		if (signal?.aborted) {
			throw (
				signal.reason ?? new DOMException("Request dibatalkan.", "AbortError")
			);
		}

		const attempt = new AbortController();
		const forwardAbort = () => attempt.abort(signal?.reason);
		signal?.addEventListener("abort", forwardAbort, { once: true });
		const timeout = setTimeout(
			() => attempt.abort(new DOMException("Server timeout.", "TimeoutError")),
			10_000,
		);
		try {
			const response = await fetch(input, {
				...init,
				credentials: init.credentials ?? "include",
				signal: attempt.signal,
			});
			return response;
		} catch (error) {
			if (signal?.aborted) throw error;
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", forwardAbort);
		}

		await new Promise<void>((resolve, reject) => {
			if (signal?.aborted) {
				reject(
					signal.reason ??
						new DOMException("Request dibatalkan.", "AbortError"),
				);
				return;
			}
			let timer: ReturnType<typeof setTimeout>;
			const abort = () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				reject(
					signal?.reason ??
						new DOMException("Request dibatalkan.", "AbortError"),
				);
			};
			timer = setTimeout(() => {
				signal?.removeEventListener("abort", abort);
				resolve();
			}, retryDelay);
			signal?.addEventListener("abort", abort, { once: true });
		});
		retryDelay = Math.min(retryDelay * 2, 15_000);
	}
}

export async function readJson<T>(response: Response): Promise<T> {
	const payload = (await response.json().catch(() => ({}))) as T & {
		error?: string;
	};
	if (!response.ok) {
		throw new Error(
			typeof payload.error === "string" && payload.error
				? payload.error
				: "Konten tidak dapat dimuat.",
		);
	}
	return payload;
}

// ---------------------------------------------------------------------------
// Cache respons client-side (satu sumber web + Tauri)
// ---------------------------------------------------------------------------

/**
 * TTL singkat agar navigasi back/forward terasa instan tanpa data basi.
 * Key = URL lengkap (sudah termasuk query page/filter/search/sort), sehingga
 * perubahan filter/search/page otomatis memicu fetch baru (key berbeda),
 * sedangkan back/forward ke URL yang sama memakai cache bila masih segar.
 */
const RESPONSE_CACHE_TTL_MS = 45_000;
const RESPONSE_CACHE_MAX_ENTRIES = 120;

interface CachedResponse {
	expires: number;
	payload: unknown;
}

const responseCache = new Map<string, CachedResponse>();

function readResponseCache<T>(key: string): T | undefined {
	const hit = responseCache.get(key);
	if (!hit) return undefined;
	if (hit.expires <= Date.now()) {
		responseCache.delete(key);
		return undefined;
	}
	// LRU sederhana: segarkan urutan agar entri panas tidak ter-evict.
	responseCache.delete(key);
	responseCache.set(key, hit);
	return hit.payload as T;
}

function writeResponseCache(
	key: string,
	payload: unknown,
	ttlMs: number,
): void {
	if (responseCache.has(key)) responseCache.delete(key);
	while (responseCache.size >= RESPONSE_CACHE_MAX_ENTRIES) {
		const oldest = responseCache.keys().next();
		if (oldest.done) break;
		responseCache.delete(oldest.value);
	}
	responseCache.set(key, { expires: Date.now() + ttlMs, payload });
}

/** Kosongkan cache respons (mis. setelah mutasi / logout). */
export function clearResponseCache(): void {
	responseCache.clear();
}

/**
 * GET JSON dengan cache memori singkat. Signature pemanggil tidak berubah:
 * URL + `init` (termasuk `signal`) sama seperti `fetchUntilConnected`.
 * Hanya dipakai di browser agar SSR tidak membocorkan data antar-request;
 * bookmark (data privat per-akun) sengaja tidak lewat sini.
 */
export async function fetchJsonCached<T>(
	url: string,
	init: RequestInit = {},
	ttlMs: number = RESPONSE_CACHE_TTL_MS,
): Promise<T> {
	if (init.signal?.aborted) {
		throw (
			init.signal.reason ??
			new DOMException("Request dibatalkan.", "AbortError")
		);
	}
	if (typeof window !== "undefined") {
		const hit = readResponseCache<T>(url);
		if (hit !== undefined) return hit;
	}
	const response = await fetchUntilConnected(url, init);
	const payload = await readJson<T>(response);
	if (typeof window !== "undefined" && !init.signal?.aborted) {
		writeResponseCache(url, payload, ttlMs);
	}
	return payload;
}

// ---------------------------------------------------------------------------
// Tipe respons server (kontrak XyMI)
// ---------------------------------------------------------------------------

export type ComicType = string | null;

export interface CatalogChapter {
	id: string;
	numberText: string;
	createdAt?: string | null;
}

export interface Series {
	id: string;
	slug: string;
	title: string;
	coverImageUrl: string | null;
	updatedAt?: string;
	latestChapterNumber: string | null;
	latestChapters?: CatalogChapter[];
	comicType: ComicType;
	countryId: string | null;
}

export interface LibraryResponse {
	items: Series[];
	total: number;
}

export interface HeroItem extends Series {
	description?: string | null;
}

export interface ChapterProvider {
	key: string;
	thumbnailUrl: string | null;
	updatedAt?: string;
}

export interface ChapterListItem {
	chapter: {
		id: string;
		numberText: string;
		normalizedNumber: string;
		title: string | null;
		publishedAt: string | null;
		createdAt: string;
		sortNumber: number | null;
	};
	sources: ChapterProvider[];
}

export interface SeriesDetail {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	coverImageUrl: string | null;
	status: string | null;
	countryId: string | null;
	alternativeTitle: string | null;
	authors: string[];
	artists: string[];
	genres: string[];
	formats: string[];
	comicType: ComicType;
	viewCount: number | null;
	rating: number | null;
	bookmarkCount: number | null;
	popularityRank: number | null;
	isFeatured: boolean | null;
	isRecommended: boolean | null;
	updatedAt: string;
	chapters: ChapterListItem[];
	chapterPagination: { total: number; hasMore: boolean; pageSize: number };
}

export interface ChapterInfo {
	id: string;
	seriesId: string;
	seriesSlug: string;
	seriesTitle: string;
	numberText: string;
	normalizedNumber: string;
	title: string | null;
	previousChapterId: string | null;
	previousChapterNumber: string | null;
	nextChapterId: string | null;
	nextChapterNumber: string | null;
	chapterCount: number;
	sources: { key: string; name: string; hasThumbnail: boolean }[];
}

export interface ReaderPage {
	id: string;
	index: number;
	url: string;
	local: boolean;
	fallbackUrl?: string;
}

export interface PagePayload {
	pages: ReaderPage[];
	availableSources?: string[];
	partial?: boolean;
}

export interface BookmarkItem {
	id: string;
	seriesId: string;
	title: string;
	coverUrl?: string | null;
	href?: string | null;
	updatedAt?: string;
}

export interface BookmarkGroup {
	id: string;
	type: "comic" | "anime";
	name: string;
	coverUrl?: string | null;
	customCoverUrl?: string | null;
	itemCount: number;
	items: BookmarkItem[];
	isDefault?: boolean;
	updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Typed client
// ---------------------------------------------------------------------------

export interface LibraryParams {
	page?: number;
	pageSize?: number;
	sort?: string;
	q?: string;
	type?: string;
}

export function coverUrl(seriesId: string, updatedAt?: string): string {
	return `${apiBase()}/api/v1/library/${encodeURIComponent(seriesId)}/cover?v=${encodeURIComponent(updatedAt ?? "")}`;
}

/**
 * URL gambar bisa absolut (foto profil Google dkk.) atau path relatif server
 * (`/api/auth/media/...`, `/api/v1/.../media/...`). Path relatif WAJIB
 * di-prefix `apiBase()`: dipakai mentah sebagai `<img src>`, browser akan
 * memintanya ke origin WEB (404) setiap origin web ≠ API.
 */
export function resolveMediaUrl(value?: string | null): string | null {
	if (!value) return null;
	if (value.startsWith("/") && !value.startsWith("//"))
		return `${apiBase()}${value}`;
	return value;
}

export function chapterThumbnailUrl(
	chapterId: string,
	sourceKey: string,
	updatedAt?: string,
): string {
	return `${apiBase()}/api/v1/chapters/${encodeURIComponent(chapterId)}/thumbnail?source=${encodeURIComponent(sourceKey)}&v=${encodeURIComponent(updatedAt ?? "")}`;
}

export function pageImageUrl(
	page: ReaderPage,
	source: string,
	format: "original" | "webp" = "webp",
): string {
	const path = page.url.startsWith("http")
		? page.url
		: `${apiBase()}${page.url}`;
	if (!page.local || source !== "local") return path;
	return `${path}${path.includes("?") ? "&" : "?"}format=${format}`;
}

export async function getLibrary(
	params: LibraryParams,
	signal?: AbortSignal,
): Promise<LibraryResponse> {
	const search = new URLSearchParams({
		page: String(params.page ?? 1),
		pageSize: String(params.pageSize ?? 12),
		sort: params.sort ?? "recent",
	});
	if (params.q?.trim()) search.set("q", params.q.trim());
	if (params.type) search.set("type", params.type);
	return fetchJsonCached<LibraryResponse>(
		`${apiBase()}/api/v1/library?${search}`,
		{ signal },
	);
}

export async function getHero(signal?: AbortSignal): Promise<HeroItem[]> {
	const payload = await fetchJsonCached<{ items?: HeroItem[] }>(
		`${apiBase()}/api/v1/library/hero`,
		{ signal },
	);
	return payload.items ?? [];
}

export async function getSeries(
	seriesId: string,
	signal?: AbortSignal,
): Promise<SeriesDetail> {
	return fetchJsonCached<SeriesDetail>(
		`${apiBase()}/api/v1/library/${encodeURIComponent(seriesId)}`,
		{ signal },
	);
}

export interface ChapterListParams {
	page?: number;
	pageSize?: number;
	sort?: "recent" | "oldest";
	q?: string;
}

export async function getSeriesChapters(
	seriesId: string,
	params: ChapterListParams,
	signal?: AbortSignal,
): Promise<{ items: ChapterListItem[]; total: number; hasMore: boolean }> {
	const search = new URLSearchParams({
		page: String(params.page ?? 1),
		pageSize: String(params.pageSize ?? 30),
		sort: params.sort ?? "recent",
	});
	if (params.q?.trim()) search.set("q", params.q.trim());
	return fetchJsonCached<{
		items: ChapterListItem[];
		total: number;
		hasMore: boolean;
	}>(
		`${apiBase()}/api/v1/library/${encodeURIComponent(seriesId)}/chapters?${search}`,
		{ signal },
	);
}

export async function getChapter(
	chapterId: string,
	signal?: AbortSignal,
): Promise<ChapterInfo> {
	return fetchJsonCached<ChapterInfo>(
		`${apiBase()}/api/v1/chapters/${encodeURIComponent(chapterId)}`,
		{ signal },
	);
}

export async function getChapterBySlug(
	seriesSlug: string,
	chapterNumber: string,
	signal?: AbortSignal,
): Promise<ChapterInfo> {
	return fetchJsonCached<ChapterInfo>(
		`${apiBase()}/api/v1/chapters/by-slug/${encodeURIComponent(seriesSlug)}/chapter-${encodeURIComponent(chapterNumber)}`,
		{ signal },
	);
}

export async function getChapterPages(
	chapterId: string,
	source: string,
	signal?: AbortSignal,
): Promise<PagePayload> {
	return fetchJsonCached<PagePayload>(
		`${apiBase()}/api/v1/chapters/${encodeURIComponent(chapterId)}/pages?source=${encodeURIComponent(source)}`,
		{ signal },
	);
}

export async function getBookmarks(
	type: "comic" | "anime",
	signal?: AbortSignal,
): Promise<BookmarkGroup[]> {
	const response = await fetch(`${apiBase()}/api/v1/bookmarks?type=${type}`, {
		credentials: "include",
		signal,
	});
	if (response.status === 401) {
		const error = new Error("Masuk untuk melihat bookmark.") as Error & {
			status?: number;
		};
		error.status = 401;
		throw error;
	}
	const payload = await readJson<{ groups?: BookmarkGroup[] }>(response);
	return payload.groups ?? [];
}
