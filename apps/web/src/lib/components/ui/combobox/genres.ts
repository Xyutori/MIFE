import { apiBase } from "#lib/api.ts";

/** Ruang kerja untuk saran genre (kontrak `GET /api/v1/genres?workspace=`). */
export type GenreWorkspace = "comic" | "anime";

/**
 * Daftar genre populer sebagai fallback. Selalu digabung dengan hasil
 * endpoint (deduplicate, tak peduli besar-kecil huruf) karena DB bisa
 * kosong (`{ genres: [] }`).
 */
export const FALLBACK_GENRES: readonly string[] = [
	"Action",
	"Adventure",
	"Comedy",
	"Drama",
	"Fantasy",
	"Horror",
	"Isekai",
	"Martial Arts",
	"Mystery",
	"Romance",
	"School",
	"Shounen",
	"Slice of Life",
	"Sports",
	"Supernatural",
];

/** Gabung beberapa daftar genre: trim, deduplicate (case-insensitive), urut A–Z. */
export function mergeGenres(...lists: string[][]): string[] {
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const list of lists) {
		for (const raw of list) {
			const genre = raw.trim();
			if (!genre) continue;
			const key = genre.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(genre);
		}
	}
	return merged.sort((a, b) =>
		a.localeCompare(b, "id", { sensitivity: "base" }),
	);
}

/**
 * Ambil saran genre dari server, gabung dengan fallback populer.
 * Gagal jaringan / respons tak valid → fallback saja (tak pernah throw).
 */
export async function fetchGenreSuggestions(
	workspace: GenreWorkspace,
	signal?: AbortSignal,
): Promise<string[]> {
	try {
		const response = await fetch(
			`${apiBase()}/api/v1/genres?workspace=${workspace}`,
			{ signal, credentials: "include" },
		);
		if (!response.ok) return [...FALLBACK_GENRES];
		const payload = (await response.json()) as { genres?: unknown };
		const fromApi = Array.isArray(payload.genres)
			? payload.genres.filter(
					(genre): genre is string =>
						typeof genre === "string" && genre.trim().length > 0,
				)
			: [];
		return mergeGenres(fromApi, [...FALLBACK_GENRES]);
	} catch {
		return [...FALLBACK_GENRES];
	}
}
