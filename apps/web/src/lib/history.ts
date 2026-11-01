/**
 * History baca (komik) & tonton (anime) — localStorage only.
 *
 * Disengaja lokal (tanpa tabel backend) mengikuti pola yang sudah ada:
 * - posisi baca: `xymi.reader.position.<chapterId>` (reader.ts)
 * - posisi tonton: `symi:anime:pos:<episodeId>` (AnimeWatchView)
 *
 * Bentuk penyimpanan: satu key `symi:history:v1` berisi map
 * `"<type>:<seriesId>" -> HistorySeriesEntry`.
 */

export type HistoryType = "comic" | "anime";

export interface HistoryChapterEntry {
	id: string;
	numberText: string;
	normalizedNumber?: string | null;
	title: string | null;
	readAt: string;
}

export interface HistorySeriesEntry {
	type: HistoryType;
	seriesId: string;
	/** slug komik (`/komik/<slug>`) atau animeId untuk anime (`/anime/<id>`) */
	slug: string;
	title: string;
	href: string;
	/** Untuk komik: param `v` cover via coverUrl(seriesId, coverUpdatedAt). */
	coverUpdatedAt?: string | null;
	/** Untuk anime: URL thumbnail absolut bila diketahui dari halaman detail. */
	coverUrl?: string | null;
	/** Untuk komik: tipe & negara untuk badge flag (manga/manhwa/manhua). */
	comicType?: string | null;
	countryId?: string | null;
	lastReadAt: string;
	chapters: HistoryChapterEntry[];
}

export interface HistorySeriesMeta {
	slug: string;
	title: string;
	href: string;
	coverUpdatedAt?: string | null;
	coverUrl?: string | null;
	comicType?: string | null;
	countryId?: string | null;
}

export interface HistoryChapterRef {
	id: string;
	numberText: string;
	normalizedNumber?: string | null;
	title?: string | null;
}

const STORAGE_KEY = "symi:history:v1";
const MAX_SERIES = 200;
const MAX_CHAPTERS_PER_SERIES = 500;

function storage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function mapKey(type: HistoryType, seriesId: string): string {
	return `${type}:${seriesId}`;
}

function readMap(): Record<string, HistorySeriesEntry> {
	const store = storage();
	if (!store) return {};
	try {
		const raw = store.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return {};
		const out: Record<string, HistorySeriesEntry> = {};
		for (const [key, value] of Object.entries(
			parsed as Record<string, unknown>,
		)) {
			if (typeof value !== "object" || value === null) continue;
			const entry = value as Partial<HistorySeriesEntry>;
			if (
				(entry.type !== "comic" && entry.type !== "anime") ||
				typeof entry.seriesId !== "string" ||
				typeof entry.slug !== "string" ||
				typeof entry.title !== "string" ||
				typeof entry.href !== "string" ||
				!Array.isArray(entry.chapters)
			)
				continue;
			out[key] = {
				type: entry.type,
				seriesId: entry.seriesId,
				slug: entry.slug,
				title: entry.title,
				href: entry.href,
				coverUpdatedAt: entry.coverUpdatedAt ?? null,
				coverUrl: entry.coverUrl ?? null,
				comicType: typeof entry.comicType === "string" ? entry.comicType : null,
				countryId: typeof entry.countryId === "string" ? entry.countryId : null,
				lastReadAt:
					typeof entry.lastReadAt === "string"
						? entry.lastReadAt
						: new Date(0).toISOString(),
				chapters: entry.chapters.filter(
					(chapter): chapter is HistoryChapterEntry =>
						typeof chapter === "object" &&
						chapter !== null &&
						typeof (chapter as HistoryChapterEntry).id === "string",
				),
			};
		}
		return out;
	} catch {
		return {};
	}
}

function writeMap(map: Record<string, HistorySeriesEntry>): void {
	const store = storage();
	if (!store) return;
	try {
		store.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		// Abaikan: history hanya peningkatan UX.
	}
}

/** Daftar series beryhistory, terurut bacaan terbaru dulu. */
export function getHistoryList(): HistorySeriesEntry[] {
	return Object.values(readMap()).sort(
		(a, b) => Date.parse(b.lastReadAt) - Date.parse(a.lastReadAt),
	);
}

/** Id chapter/episode yang sudah dibaca untuk satu series. */
export function getReadChapterIds(
	type: HistoryType,
	seriesId: string,
): Set<string> {
	const entry = readMap()[mapKey(type, seriesId)];
	if (!entry) return new Set();
	return new Set(entry.chapters.map((chapter) => chapter.id));
}

/**
 * Perbarui meta series (judul/cover/href) HANYA bila entri history sudah ada.
 * Tidak membuat entri baru — entri hanya dibuat saat chapter dibaca/ditonton.
 */
export function refreshHistoryMeta(
	type: HistoryType,
	seriesId: string,
	meta: HistorySeriesMeta,
): void {
	const map = readMap();
	const key = mapKey(type, seriesId);
	const existing = map[key];
	if (!existing) return;
	map[key] = {
		...existing,
		slug: meta.slug,
		title: meta.title,
		href: meta.href,
		coverUpdatedAt: meta.coverUpdatedAt ?? existing.coverUpdatedAt ?? null,
		coverUrl: meta.coverUrl ?? existing.coverUrl ?? null,
		comicType: meta.comicType ?? existing.comicType ?? null,
		countryId: meta.countryId ?? existing.countryId ?? null,
	};
	writeMap(map);
}

/** Catat chapter/episode sebagai sudah dibaca/ditonton (membuat entri bila perlu). */
export function markChapterRead(
	type: HistoryType,
	seriesId: string,
	chapter: HistoryChapterRef,
	meta: HistorySeriesMeta,
): void {
	const map = readMap();
	const key = mapKey(type, seriesId);
	const now = new Date().toISOString();
	const existing = map[key];
	const chapters = existing ? [...existing.chapters] : [];
	const index = chapters.findIndex((entry) => entry.id === chapter.id);
	const record: HistoryChapterEntry = {
		id: chapter.id,
		numberText: chapter.numberText,
		normalizedNumber: chapter.normalizedNumber ?? null,
		title: chapter.title ?? null,
		readAt: now,
	};
	if (index >= 0) chapters[index] = record;
	else chapters.unshift(record);

	map[key] = {
		type,
		seriesId,
		slug: meta.slug,
		title: meta.title,
		href: meta.href,
		coverUpdatedAt: meta.coverUpdatedAt ?? existing?.coverUpdatedAt ?? null,
		coverUrl: meta.coverUrl ?? existing?.coverUrl ?? null,
		comicType: meta.comicType ?? existing?.comicType ?? null,
		countryId: meta.countryId ?? existing?.countryId ?? null,
		lastReadAt: now,
		chapters: chapters.slice(0, MAX_CHAPTERS_PER_SERIES),
	};

	// Batasi jumlah series: buang yang paling lama tidak dibaca.
	const sorted = Object.entries(map).sort(
		(a, b) => Date.parse(b[1].lastReadAt) - Date.parse(a[1].lastReadAt),
	);
	const trimmed: Record<string, HistorySeriesEntry> = {};
	for (const [entryKey, entry] of sorted.slice(0, MAX_SERIES)) {
		trimmed[entryKey] = entry;
	}
	writeMap(trimmed);
}

export function removeHistoryEntry(type: HistoryType, seriesId: string): void {
	const map = readMap();
	delete map[mapKey(type, seriesId)];
	writeMap(map);
}

export function clearHistory(): void {
	writeMap({});
}
