// Rak dan riwayat versi client-only (localStorage).
// Dipakai lintas rute series / library / read. Tidak ada ketergantungan #lib.

export const BOOKMARKS_KEY = "symi:bookmarks";
export const READLIST_KEY = "symi:readlist";
export const HISTORY_KEY = "symi:history";

export interface HistoryEntry {
	seriesId: string;
	chapterId: string;
	title: string;
	chapter: string;
	cover: string;
	at: number;
}

function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return fallback;
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function writeJson(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Penyimpanan tidak tersedia (mode privat, dsb) — abaikan diam-diam.
	}
}

export function loadIds(key: string): string[] {
	const ids = readJson<unknown>(key, []);
	return Array.isArray(ids)
		? ids.filter((id): id is string => typeof id === "string")
		: [];
}

export function hasId(key: string, id: string): boolean {
	return loadIds(key).includes(id);
}

/** Toggle keanggotaan id. Mengembalikan status baru (true = ditambahkan). */
export function toggleId(key: string, id: string): boolean {
	const ids = loadIds(key);
	const next = ids.includes(id)
		? ids.filter((entry) => entry !== id)
		: [...ids, id];
	writeJson(key, next);
	return next.includes(id);
}

export function loadHistory(): HistoryEntry[] {
	const entries = readJson<unknown>(HISTORY_KEY, []);
	if (!Array.isArray(entries)) return [];
	return entries.filter(
		(entry): entry is HistoryEntry =>
			typeof entry === "object" &&
			entry !== null &&
			typeof (entry as HistoryEntry).chapterId === "string" &&
			typeof (entry as HistoryEntry).seriesId === "string",
	);
}

export function pushHistory(entry: HistoryEntry): void {
	const rest = loadHistory().filter(
		(item) => item.chapterId !== entry.chapterId,
	);
	writeJson(HISTORY_KEY, [entry, ...rest].slice(0, 30));
}
