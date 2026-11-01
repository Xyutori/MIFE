import type { Database } from "@SyMi/db";
import {
	animeEpisodes,
	animeSeries,
	chapters,
	contentVisits,
	series,
} from "@SyMi/db/schema/index";
import { and, eq, lt, sql } from "drizzle-orm";
import { getVisibleAnimeId } from "../catalog/anime";
import {
	COMIC_WORKSPACE_ID,
	getVisibleChapterSeriesId,
	SUPERKOMIK_WORKSPACE_ID,
	visibleSeriesForRoute,
} from "../catalog/series";

export type ContentKind = "comic" | "chapter" | "anime" | "episode";

export type RecordContentViewInput = {
	type: ContentKind;
	id: string;
	visitorKey: string;
	now?: Date;
};

export type RecordContentViewResult = {
	/** True hanya saat counter benar-benar naik. */
	counted: boolean;
	/** Nilai `local_view_count` terbaru (atau saat ini bila dedup). */
	localViewCount: number;
	/** False bila konten tak ada/hidden — route memetakan ke 404 generik. */
	found: boolean;
};

const NOT_FOUND: RecordContentViewResult = {
	counted: false,
	localViewCount: 0,
	found: false,
};

/** TTL ledger: 24 jam dari pencatatan (dibersihkan scheduler harian). */
export function visitExpiry(from: Date): Date {
	return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

async function readSeriesLocalCount(
	db: Database,
	id: string,
): Promise<{ found: boolean; count: number }> {
	const row =
		(await visibleSeriesForRoute(db, COMIC_WORKSPACE_ID, id)) ??
		(await visibleSeriesForRoute(db, SUPERKOMIK_WORKSPACE_ID, id));
	if (!row) return { found: false, count: 0 };
	return { found: true, count: row.localViewCount ?? 0 };
}

async function readChapterLocalCount(
	db: Database,
	id: string,
): Promise<{ found: boolean; count: number; seriesId: string | null }> {
	const seriesId =
		(await getVisibleChapterSeriesId(db, COMIC_WORKSPACE_ID, id)) ??
		(await getVisibleChapterSeriesId(db, SUPERKOMIK_WORKSPACE_ID, id));
	if (!seriesId) return { found: false, count: 0, seriesId: null };
	const rows = await db
		.select({ localViewCount: chapters.localViewCount })
		.from(chapters)
		.where(eq(chapters.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) return { found: false, count: 0, seriesId: null };
	return { found: true, count: row.localViewCount ?? 0, seriesId };
}

async function readAnimeLocalCount(
	db: Database,
	id: string,
): Promise<{ found: boolean; count: number }> {
	const visibleId = await getVisibleAnimeId(db, id);
	if (!visibleId) return { found: false, count: 0 };
	const rows = await db
		.select({ localViewCount: animeSeries.localViewCount })
		.from(animeSeries)
		.where(eq(animeSeries.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) return { found: false, count: 0 };
	return { found: true, count: row.localViewCount ?? 0 };
}

async function readEpisodeLocalCount(
	db: Database,
	id: string,
): Promise<{ found: boolean; count: number }> {
	const rows = await db
		.select({ localViewCount: animeEpisodes.localViewCount })
		.from(animeEpisodes)
		.innerJoin(animeSeries, eq(animeEpisodes.animeId, animeSeries.id))
		.where(and(eq(animeEpisodes.id, id), eq(animeSeries.isVisible, true)))
		.limit(1);
	const row = rows[0];
	if (!row) return { found: false, count: 0 };
	return { found: true, count: row.localViewCount ?? 0 };
}

/**
 * Catat satu view bila pasangan (type, id, visitorKey) belum ada hari ini.
 *
 * - Verifikasi konten ada+visible dulu (helper existing; hidden/tak ada ->
 *   `{counted:false, found:false}` agar route balas 404 generik).
 * - `INSERT content_visits ON CONFLICT DO NOTHING`; bila inserted, naikkan
 *   `local_view_count + 1` dan kembalikan nilai baru.
 * - TIDAK PERNAH throw ke caller: semua error -> `{counted:false, ...}`.
 * - TIDAK menyentuh kolom `view_count` scraper (max() di `jobs/store.ts`).
 */
export async function recordContentView(
	db: Database,
	input: RecordContentViewInput,
): Promise<RecordContentViewResult> {
	try {
		const id = input.id.trim();
		if (!id || id.length > 256) return NOT_FOUND;
		if (!input.visitorKey) return { ...NOT_FOUND, found: true };

		let current = 0;
		if (input.type === "comic") {
			const checked = await readSeriesLocalCount(db, id);
			if (!checked.found) return NOT_FOUND;
			current = checked.count;
		} else if (input.type === "chapter") {
			const checked = await readChapterLocalCount(db, id);
			if (!checked.found) return NOT_FOUND;
			current = checked.count;
		} else if (input.type === "anime") {
			const checked = await readAnimeLocalCount(db, id);
			if (!checked.found) return NOT_FOUND;
			current = checked.count;
		} else {
			const checked = await readEpisodeLocalCount(db, id);
			if (!checked.found) return NOT_FOUND;
			current = checked.count;
		}

		const at = input.now ?? new Date();
		const inserted = await db
			.insert(contentVisits)
			.values({
				contentType: input.type,
				contentId: id,
				visitorKey: input.visitorKey,
				expiresAt: visitExpiry(at),
			})
			.onConflictDoNothing()
			.returning({ contentId: contentVisits.contentId });
		if (inserted.length === 0) {
			return { counted: false, localViewCount: current, found: true };
		}

		const bumped = await bumpLocalCount(db, input.type, id);
		return {
			counted: true,
			localViewCount: bumped ?? current + 1,
			found: true,
		};
	} catch {
		return { counted: false, localViewCount: 0, found: true };
	}
}

async function bumpLocalCount(
	db: Database,
	type: ContentKind,
	id: string,
): Promise<number | null> {
	try {
		if (type === "comic") {
			const rows = await db
				.update(series)
				.set({ localViewCount: sql`${series.localViewCount} + 1` })
				.where(eq(series.id, id))
				.returning({ localViewCount: series.localViewCount });
			return rows[0]?.localViewCount ?? null;
		}
		if (type === "chapter") {
			const rows = await db
				.update(chapters)
				.set({ localViewCount: sql`${chapters.localViewCount} + 1` })
				.where(eq(chapters.id, id))
				.returning({ localViewCount: chapters.localViewCount });
			return rows[0]?.localViewCount ?? null;
		}
		if (type === "anime") {
			const rows = await db
				.update(animeSeries)
				.set({ localViewCount: sql`${animeSeries.localViewCount} + 1` })
				.where(eq(animeSeries.id, id))
				.returning({ localViewCount: animeSeries.localViewCount });
			return rows[0]?.localViewCount ?? null;
		}
		const rows = await db
			.update(animeEpisodes)
			.set({ localViewCount: sql`${animeEpisodes.localViewCount} + 1` })
			.where(eq(animeEpisodes.id, id))
			.returning({ localViewCount: animeEpisodes.localViewCount });
		return rows[0]?.localViewCount ?? null;
	} catch {
		return null;
	}
}

/**
 * Baca `local_view_count` saat ini tanpa menghitung (dipakai jalur bot-UA
 * agar respons tetap `{counted:false, localViewCount}` dengan 200).
 * `null` bila konten tak ada/hidden; TIDAK PERNAH throw (error -> null).
 */
export async function getLocalViewCount(
	db: Database,
	type: ContentKind,
	id: string,
): Promise<number | null> {
	try {
		const clean = id.trim();
		if (!clean) return null;
		if (type === "comic") {
			const checked = await readSeriesLocalCount(db, clean);
			return checked.found ? checked.count : null;
		}
		if (type === "chapter") {
			const checked = await readChapterLocalCount(db, clean);
			return checked.found ? checked.count : null;
		}
		if (type === "anime") {
			const checked = await readAnimeLocalCount(db, clean);
			return checked.found ? checked.count : null;
		}
		const checked = await readEpisodeLocalCount(db, clean);
		return checked.found ? checked.count : null;
	} catch {
		return null;
	}
}

/**
 * Hapus baris ledger kedaluwarsa (`expires_at < now`). Dipanggil scheduler
 * sekali sehari; TIDAK PERNAH throw (error -> 0).
 */
export async function cleanupExpiredVisits(
	db: Database,
	now?: Date,
): Promise<number> {
	try {
		const rows = await db
			.delete(contentVisits)
			.where(lt(contentVisits.expiresAt, now ?? new Date()))
			.returning({ contentId: contentVisits.contentId });
		return rows.length;
	} catch {
		return 0;
	}
}
