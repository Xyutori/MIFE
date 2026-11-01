import { registerAnimeAdapter } from "../jobs/anime";
import { kuramanimeAdapter } from "./kuramanime";
import { oploverzAdapter } from "./oploverz";
import { otakudesuAdapter } from "./otakudesu";

/**
 * Site adapters for the anime scrape lane.
 *
 * Ported from XyMI `apps/server/src/anime/sources.ts`: Otakudesu,
 * Kuramanime, and Oploverz keep their upstream parser status (active).
 * Samehadaku stays disabled — see `DISABLED_ANIME_SOURCES`.
 *
 * Wiring note: `registerAnimeAdapters()` runs on import so any module that
 * imports this file (e.g. future scheduler/route wiring) activates the
 * adapters. Importing `../jobs/anime` here is one-directional (the lane
 * never imports this file), so there is no import cycle.
 */

export const ANIME_ADAPTER_KEYS = [
	"otakudesu",
	"kuramanime",
	"oploverz",
] as const;

export type AnimeAdapterKey = (typeof ANIME_ADAPTER_KEYS)[number];

/**
 * Sources intentionally left without an adapter. Samehadaku is seeded as
 * disabled in `services.ts` (`anime:samehadaku`) and stays that way because
 * the upstream XyMI codebase has no Samehadaku feed/detail/episode/playback
 * parsers either (`samehadaku: { supported: false }`).
 */
export const DISABLED_ANIME_SOURCES: Record<string, string> = {
	samehadaku:
		"Parser feed, detail, episode, dan playback Samehadaku belum tersedia di upstream (XyMI), sehingga adapter tidak didaftarkan dan sumber tetap nonaktif.",
};

export function animeSourceCapability(key: string): {
	supported: boolean;
	reason: string | null;
} {
	if ((ANIME_ADAPTER_KEYS as readonly string[]).includes(key))
		return { supported: true, reason: null };
	if (key in DISABLED_ANIME_SOURCES)
		return { supported: false, reason: DISABLED_ANIME_SOURCES[key] ?? null };
	return {
		supported: false,
		reason: `Sumber anime ${key} belum memiliki parser aktif.`,
	};
}

export function registerAnimeAdapters() {
	registerAnimeAdapter("otakudesu", otakudesuAdapter);
	registerAnimeAdapter("kuramanime", kuramanimeAdapter);
	registerAnimeAdapter("oploverz", oploverzAdapter);
}

registerAnimeAdapters();
