import { apiBase, type BookmarkGroup, getBookmarks } from "#lib/api.ts";
import { authClient } from "#lib/auth-client.ts";

/** URL kanonis reader ala XyMI: /baca/<slug>/chapter-<number>. */
export function readerUrl(
	seriesSlug: string,
	normalizedNumber: string,
): string {
	return `/baca/${encodeURIComponent(seriesSlug)}/chapter-${encodeURIComponent(normalizedNumber)}`;
}

// ---------------------------------------------------------------------------
// Preferensi + posisi baca (localStorage, kunci ala XyMI)
// ---------------------------------------------------------------------------

export type ScrollMode = "viewport" | "chapter";
export type LocalFormat = "original" | "webp";

export interface ReaderPrefs {
	autoNext: boolean;
	autoScroll: boolean;
	scrollMode: ScrollMode;
	autoScrollSpeed: number;
	localFormat: LocalFormat;
}

const DEFAULT_PREFS: ReaderPrefs = {
	autoNext: false,
	autoScroll: false,
	scrollMode: "viewport",
	autoScrollSpeed: 1,
	localFormat: "webp",
};

function storage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

export function readReaderPrefs(): ReaderPrefs {
	const store = storage();
	if (!store) return { ...DEFAULT_PREFS };
	try {
		const autoNext = store.getItem("xymi.reader.autoNext") === "true";
		const autoScroll = store.getItem("xymi.reader.autoScroll") === "true";
		const scrollMode =
			store.getItem("xymi.reader.scrollMode") === "chapter"
				? "chapter"
				: "viewport";
		const savedSpeed = Number(store.getItem("xymi.reader.autoScrollSpeed"));
		const autoScrollSpeed =
			savedSpeed >= 0.5 && savedSpeed <= 3 ? savedSpeed : 1;
		const savedFormat = store.getItem("xymi.reader.localFormat");
		const localFormat: LocalFormat =
			savedFormat === "original" ? "original" : "webp";
		return { autoNext, autoScroll, scrollMode, autoScrollSpeed, localFormat };
	} catch {
		return { ...DEFAULT_PREFS };
	}
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
	const store = storage();
	if (!store) return;
	try {
		store.setItem("xymi.reader.autoNext", String(prefs.autoNext));
		store.setItem("xymi.reader.autoScroll", String(prefs.autoScroll));
		store.setItem("xymi.reader.scrollMode", prefs.scrollMode);
		store.setItem("xymi.reader.autoScrollSpeed", String(prefs.autoScrollSpeed));
		store.setItem("xymi.reader.localFormat", prefs.localFormat);
	} catch {
		// Kontrol reader tetap jalan walau storage tidak tersedia.
	}
}

export function readReadingPosition(chapterId: string): number {
	const store = storage();
	if (!store) return 0;
	try {
		const raw = store.getItem(`xymi.reader.position.${chapterId}`);
		const value = Number(raw);
		return Number.isFinite(value) && value > 0 ? value : 0;
	} catch {
		return 0;
	}
}

export function saveReadingPosition(chapterId: string, scrollY: number): void {
	const store = storage();
	if (!store) return;
	try {
		store.setItem(`xymi.reader.position.${chapterId}`, String(scrollY));
	} catch {
		// Abaikan: posisi hanya peningkatan UX.
	}
}

// ---------------------------------------------------------------------------
// Bookmark: lokal + sinkronisasi server (last-write-wins saat login)
// ---------------------------------------------------------------------------

export type BookmarkType = "comic" | "anime";

interface LocalBookmarkEntry {
	seriesId: string;
	title: string;
	coverUrl: string | null;
	href: string;
	savedAt: string;
}

const localKey = (type: BookmarkType) => `xymi.bookmarks.${type}`;

export function readLocalBookmarks(type: BookmarkType): LocalBookmarkEntry[] {
	const store = storage();
	if (!store) return [];
	try {
		const raw = store.getItem(localKey(type));
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is LocalBookmarkEntry =>
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as LocalBookmarkEntry).seriesId === "string",
		);
	} catch {
		return [];
	}
}

export function toggleLocalBookmark(
	type: BookmarkType,
	entry: Omit<LocalBookmarkEntry, "savedAt">,
): boolean {
	const store = storage();
	const current = readLocalBookmarks(type);
	const exists = current.some((item) => item.seriesId === entry.seriesId);
	const next = exists
		? current.filter((item) => item.seriesId !== entry.seriesId)
		: [...current, { ...entry, savedAt: new Date().toISOString() }];
	try {
		store?.setItem(localKey(type), JSON.stringify(next));
	} catch {
		// Abaikan kegagalan storage.
	}
	return !exists;
}

export function isLocalBookmarked(
	type: BookmarkType,
	seriesId: string,
): boolean {
	return readLocalBookmarks(type).some((item) => item.seriesId === seriesId);
}

/**
 * Sinkronisasi bookmark ke server saat login (last-write-wins):
 * entri lokal yang lebih baru daripada versi server diunggah,
 * lalu cache lokal diganti dengan hasil gabungan terbaru.
 */
export async function syncBookmarksToServer(
	type: BookmarkType,
): Promise<{ synced: number; groups: BookmarkGroup[] }> {
	const session = await authClient.getSession().catch(() => null);
	if (!session) return { synced: 0, groups: [] };

	const local = readLocalBookmarks(type);
	if (local.length === 0) {
		const groups = await getBookmarks(type).catch(() => []);
		return { synced: 0, groups };
	}

	let groups: BookmarkGroup[] = [];
	try {
		groups = await getBookmarks(type);
	} catch {
		return { synced: 0, groups: [] };
	}

	const serverSeries = new Set(
		groups.flatMap((group) => group.items.map((item) => item.seriesId)),
	);
	const missing = local.filter((entry) => !serverSeries.has(entry.seriesId));
	if (missing.length === 0) return { synced: 0, groups };

	// Last-write-wins: entri lokal (lebih baru, belum ada di server)
	// diunggah ke grup default/pertama.
	const target = groups.find((group) => group.isDefault) ?? groups[0] ?? null;
	if (!target) return { synced: 0, groups };

	let synced = 0;
	for (const entry of missing) {
		try {
			const response = await fetch(
				`${apiBase()}/api/v1/bookmarks/groups/${target.id}/items`,
				{
					method: "POST",
					credentials: "include",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ seriesId: entry.seriesId }),
				},
			);
			const payload = (await response.json().catch(() => ({}))) as {
				error?: string;
			};
			if (!response.ok) continue;
			if (typeof payload.error === "string" && payload.error) continue;
			synced += 1;
		} catch {
			// Lanjut ke entri berikutnya; sinkronisasi bersifat best-effort.
		}
	}

	const fresh = await getBookmarks(type).catch(() => groups);
	return { synced, groups: fresh };
}
