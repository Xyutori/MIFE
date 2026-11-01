export type ThemeMode = "dark" | "light" | "system";

export interface GeneralPreferences {
	pageSize: number;
	enabledImageSources: string[];
}

export interface AnimePreferences {
	playerQuality: string;
	autoplayNext: boolean;
	playbackRate: number;
}

export interface ImageSourceOption {
	key: string;
	name: string;
}

export const DEFAULT_IMAGE_SOURCES: ImageSourceOption[] = [
	{ key: "local", name: "Lokal" },
];

export const PAGE_SIZES = [6, 7, 8, 9, 10, 11, 12];
export const PLAYER_QUALITIES = [
	"auto",
	"2160p",
	"1440p",
	"1080p",
	"720p",
	"480p",
];
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const DEFAULT_GENERAL: GeneralPreferences = {
	pageSize: 12,
	enabledImageSources: ["local"],
};

const DEFAULT_ANIME: AnimePreferences = {
	playerQuality: "auto",
	autoplayNext: false,
	playbackRate: 1,
};

function storage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function clampPageSize(value: unknown): number {
	const size = Number(value);
	if (!Number.isFinite(size)) return DEFAULT_GENERAL.pageSize;
	return Math.max(6, Math.min(12, Math.round(size)));
}

export function readGeneralPrefs(): GeneralPreferences {
	const store = storage();
	if (!store) return { ...DEFAULT_GENERAL };
	try {
		const raw = store.getItem("symi.settings.general");
		if (!raw) return { ...DEFAULT_GENERAL };
		const parsed = JSON.parse(raw) as Partial<GeneralPreferences>;
		const enabled = Array.isArray(parsed.enabledImageSources)
			? parsed.enabledImageSources.filter(
					(key): key is string => typeof key === "string",
				)
			: DEFAULT_GENERAL.enabledImageSources;
		return {
			pageSize: clampPageSize(parsed.pageSize),
			enabledImageSources:
				enabled.length > 0 ? enabled : [...DEFAULT_GENERAL.enabledImageSources],
		};
	} catch {
		return { ...DEFAULT_GENERAL };
	}
}

export function saveGeneralPrefs(prefs: GeneralPreferences): void {
	try {
		storage()?.setItem("symi.settings.general", JSON.stringify(prefs));
	} catch {
		// Preferensi tampilan tetap jalan walau storage tidak tersedia.
	}
}

export function readAnimePrefs(): AnimePreferences {
	const store = storage();
	if (!store) return { ...DEFAULT_ANIME };
	try {
		const raw = store.getItem("symi.settings.anime");
		if (!raw) return { ...DEFAULT_ANIME };
		const parsed = JSON.parse(raw) as Partial<AnimePreferences>;
		const rate = Number(parsed.playbackRate);
		return {
			playerQuality:
				typeof parsed.playerQuality === "string" && parsed.playerQuality
					? parsed.playerQuality
					: DEFAULT_ANIME.playerQuality,
			autoplayNext: Boolean(parsed.autoplayNext),
			playbackRate:
				Number.isFinite(rate) && rate >= 0.5 && rate <= 2
					? rate
					: DEFAULT_ANIME.playbackRate,
		};
	} catch {
		return { ...DEFAULT_ANIME };
	}
}

export function saveAnimePrefs(prefs: AnimePreferences): void {
	try {
		storage()?.setItem("symi.settings.anime", JSON.stringify(prefs));
	} catch {
		// Abaikan kegagalan storage.
	}
}

export function readTheme(): ThemeMode {
	try {
		const saved = storage()?.getItem("symi.settings.theme");
		if (saved === "light" || saved === "dark" || saved === "system")
			return saved;
		return "dark";
	} catch {
		return "dark";
	}
}

export function saveTheme(theme: ThemeMode): void {
	try {
		storage()?.setItem("symi.settings.theme", theme);
	} catch {
		// Abaikan kegagalan storage.
	}
	applyTheme(theme);
}

export function applyTheme(theme: ThemeMode): void {
	try {
		const resolved =
			theme === "system"
				? window.matchMedia("(prefers-color-scheme: light)").matches
					? "light"
					: "dark"
				: theme;
		document.documentElement.style.colorScheme = resolved;
	} catch {
		// Abaikan: tema hanya peningkatan tampilan.
	}
}
