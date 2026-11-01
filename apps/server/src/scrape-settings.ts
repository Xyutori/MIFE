import { appSettings, sources } from "@SyMi/db/schema/index";
import { asc } from "drizzle-orm";
import { cacheRemember } from "./cache/index";
import { cache, db } from "./services";

/**
 * Scrape settings yang bisa dikonfigurasi dari panel admin.
 *
 * Sumber nilai per key (prioritas):
 * 1. baris `app_settings` (`scrape.*`) bila ada dan valid,
 * 2. fallback ke default bawaan kode di bawah bila absen/invalid.
 *
 * Tidak ada lagi override via ENV (`SCRAPE_*` dihapus dari `.env.schema`):
 * panel admin adalah satu-satunya cara mengubah nilai saat runtime.
 */

export const SCRAPE_SETTING_KEYS = [
	"timeZone",
	"dailyTimes",
	"batchSize",
	"batchConcurrency",
	"incrementalMaxPages",
] as const;

export type ScrapeSettingKey = (typeof SCRAPE_SETTING_KEYS)[number];

export type ScrapeSettingSource = "db" | "default";

export interface ScrapeSettings {
	timeZone: string;
	/** Daftar jam scrape harian "HH:MM", terurut, unik (bisa >1 jadwal). */
	dailyTimes: string[];
	batchSize: number;
	batchConcurrency: number;
	incrementalMaxPages: number;
}

export interface ScrapeSettingsResult {
	values: ScrapeSettings;
	sources: Record<ScrapeSettingKey, ScrapeSettingSource>;
}

const DB_KEY: Record<ScrapeSettingKey, string> = {
	timeZone: "scrape.time_zone",
	dailyTimes: "scrape.daily_times",
	batchSize: "scrape.batch_size",
	batchConcurrency: "scrape.batch_concurrency",
	incrementalMaxPages: "scrape.incremental_max_pages",
};

/** Baris legacy satu-jadwal; dibaca sebagai fallback bila daily_times absen. */
const LEGACY_DB_KEY_DAILY_TIME = "scrape.daily_time";

/** Batas jumlah slot jadwal harian (cukup untuk pola per jam). */
export const MAX_DAILY_SLOTS = 12;

const CACHE_KEY = "scrape-settings";
const CACHE_TTL_SECONDS = 60;

export function isValidTimeZone(value: unknown): value is string {
	if (typeof value !== "string" || value.trim() === "") return false;
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

export function isValidDailyTime(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
	if (!match) return false;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	return (
		Number.isInteger(hour) &&
		Number.isInteger(minute) &&
		hour >= 0 &&
		hour <= 23 &&
		minute >= 0 &&
		minute <= 59
	);
}

function parsePositiveInt(value: unknown): number | null {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const text = String(value).trim();
	if (!/^\d+$/.test(text)) return null;
	const parsed = Number(text);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Normalisasi daftar slot "HH:MM": trim, valid, unik, terurut, dibatasi. */
export function normalizeDailyTimes(value: unknown): string[] | null {
	if (typeof value === "string") {
		// Baris DB lama bisa berupa JSON array tersimpan sebagai string.
		try {
			return normalizeDailyTimes(JSON.parse(value) as unknown);
		} catch {
			return isValidDailyTime(value) ? [value.trim()] : null;
		}
	}
	if (!Array.isArray(value)) return null;
	const cleaned: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string" || !isValidDailyTime(entry)) return null;
		const slot = entry.trim();
		if (!cleaned.includes(slot)) cleaned.push(slot);
	}
	if (cleaned.length === 0 || cleaned.length > MAX_DAILY_SLOTS) return null;
	return cleaned.sort();
}

/** Default bawaan kode; dipakai bila baris DB absen/invalid. */
export function envScrapeDefaults(): ScrapeSettings {
	return {
		timeZone: "Asia/Jakarta",
		dailyTimes: ["20:00"],
		batchSize: 20,
		batchConcurrency: 3,
		incrementalMaxPages: 5,
	};
}

/** Baca langsung dari DB (tanpa cache) — dipakai scheduler tiap tick. */
export async function getScrapeSettingsFresh(): Promise<ScrapeSettingsResult> {
	const fallback = envScrapeDefaults();
	const values: ScrapeSettings = {
		...fallback,
		dailyTimes: [...fallback.dailyTimes],
	};
	const sources: Record<ScrapeSettingKey, ScrapeSettingSource> = {
		timeZone: "default",
		dailyTimes: "default",
		batchSize: "default",
		batchConcurrency: "default",
		incrementalMaxPages: "default",
	};
	let rows: Array<{ key: string; value: string }> = [];
	try {
		rows = await db
			.select({ key: appSettings.key, value: appSettings.value })
			.from(appSettings);
	} catch {
		return { values, sources };
	}
	const byKey = new Map(rows.map((row) => [row.key, row.value]));
	const timeZone = byKey.get(DB_KEY.timeZone);
	if (timeZone !== undefined && isValidTimeZone(timeZone.trim())) {
		values.timeZone = timeZone.trim();
		sources.timeZone = "db";
	}
	const dailyTimes = normalizeDailyTimes(byKey.get(DB_KEY.dailyTimes));
	if (dailyTimes) {
		values.dailyTimes = dailyTimes;
		sources.dailyTimes = "db";
	} else {
		// Migrasi lunak baris legacy satu-jadwal ("20:00") ke daftar.
		const legacy = byKey.get(LEGACY_DB_KEY_DAILY_TIME);
		if (legacy !== undefined && isValidDailyTime(legacy)) {
			values.dailyTimes = [legacy.trim()];
			sources.dailyTimes = "db";
		}
	}
	const numbers: Array<{
		key: "batchSize" | "batchConcurrency" | "incrementalMaxPages";
		min: number;
		max: number;
	}> = [
		{ key: "batchSize", min: 5, max: 100 },
		{ key: "batchConcurrency", min: 1, max: 8 },
		{ key: "incrementalMaxPages", min: 2, max: 20 },
	];
	for (const { key, min, max } of numbers) {
		const raw = byKey.get(DB_KEY[key]);
		if (raw === undefined) continue;
		const parsed = parsePositiveInt(raw);
		if (parsed === null) continue;
		values[key] = Math.max(min, Math.min(max, parsed));
		sources[key] = "db";
	}
	return { values, sources };
}

/** Baca via cache in-memory 60 detik; di-invalidate setiap PUT berhasil. */
export function getScrapeSettings(): Promise<ScrapeSettingsResult> {
	return cacheRemember(CACHE_KEY, getScrapeSettingsFresh, CACHE_TTL_SECONDS);
}

export async function invalidateScrapeSettingsCache(): Promise<void> {
	await cache.del(CACHE_KEY);
}

const FIELD_ERRORS: Record<ScrapeSettingKey, string> = {
	timeZone:
		"timeZone harus nama zona waktu IANA yang valid (mis. Asia/Jakarta).",
	dailyTimes: `dailyTimes harus array 1–${MAX_DAILY_SLOTS} string format HH:MM 24 jam (mis. ["07:00", "19:00"]).`,
	batchSize: "batchSize harus bilangan bulat 1–100.",
	batchConcurrency: "batchConcurrency harus bilangan bulat 1–8.",
	incrementalMaxPages: "incrementalMaxPages harus bilangan bulat 2–20.",
};

function validateSettingValue(
	key: ScrapeSettingKey,
	value: unknown,
): { ok: true; stored: string } | { ok: false; error: string } {
	if (key === "timeZone") {
		if (!isValidTimeZone(typeof value === "string" ? value.trim() : value))
			return { ok: false, error: FIELD_ERRORS.timeZone };
		return { ok: true, stored: (value as string).trim() };
	}
	if (key === "dailyTimes") {
		// Terima string tunggal ("20:00") sebagai alias satu slot.
		const normalized = normalizeDailyTimes(
			typeof value === "string" ? [value] : value,
		);
		if (!normalized) return { ok: false, error: FIELD_ERRORS.dailyTimes };
		return { ok: true, stored: JSON.stringify(normalized) };
	}
	const parsed = parsePositiveInt(value);
	if (parsed === null) return { ok: false, error: FIELD_ERRORS[key] };
	const bounds: Record<string, { min: number; max: number }> = {
		batchSize: { min: 1, max: 100 },
		batchConcurrency: { min: 1, max: 8 },
		incrementalMaxPages: { min: 2, max: 20 },
	};
	const bound = bounds[key];
	if (!bound) return { ok: false, error: FIELD_ERRORS[key] };
	if (parsed < bound.min || parsed > bound.max)
		return { ok: false, error: FIELD_ERRORS[key] };
	return { ok: true, stored: String(parsed) };
}

export function validateScrapeSettingsPatch(
	body: unknown,
):
	| { ok: true; patch: Partial<Record<ScrapeSettingKey, string>> }
	| { ok: false; error: string } {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return { ok: false, error: "Body harus objek JSON." };
	const record = body as Record<string, unknown>;
	const entries = Object.entries(record);
	if (entries.length === 0)
		return {
			ok: false,
			error: "Body kosong: tidak ada pengaturan yang diubah.",
		};
	const valid = new Set<string>(SCRAPE_SETTING_KEYS);
	for (const [key] of entries) {
		if (!valid.has(key))
			return {
				ok: false,
				error: `Kunci tidak dikenal: ${key}. Kunci valid: ${SCRAPE_SETTING_KEYS.join(", ")}.`,
			};
	}
	const patch: Partial<Record<ScrapeSettingKey, string>> = {};
	for (const [key, value] of entries) {
		const settingKey = key as ScrapeSettingKey;
		const validated = validateSettingValue(settingKey, value);
		if (!validated.ok) return validated;
		patch[settingKey] = validated.stored;
	}
	return { ok: true, patch };
}

export async function saveScrapeSettings(
	patch: Partial<Record<ScrapeSettingKey, string>>,
): Promise<void> {
	const timestamp = new Date();
	for (const [key, stored] of Object.entries(patch)) {
		if (stored === undefined) continue;
		await db
			.insert(appSettings)
			.values({
				key: DB_KEY[key as ScrapeSettingKey],
				value: stored,
				createdAt: timestamp,
				updatedAt: timestamp,
			})
			.onConflictDoUpdate({
				target: appSettings.key,
				set: { value: stored, updatedAt: timestamp },
			});
	}
	await invalidateScrapeSettingsCache();
}

export interface EditableScrapeSource {
	id: string;
	key: string;
	name: string;
	workspaceId: string;
	baseUrl: string;
	prefix: string;
	requestDelayMs: number;
	enabled: boolean;
}

/** Semua sumber (komik + superkomik + anime) untuk tabel pengaturan. */
export async function listEditableScrapeSources(): Promise<
	EditableScrapeSource[]
> {
	return db
		.select({
			id: sources.id,
			key: sources.key,
			name: sources.name,
			workspaceId: sources.workspaceId,
			baseUrl: sources.baseUrl,
			prefix: sources.prefix,
			requestDelayMs: sources.requestDelayMs,
			enabled: sources.enabled,
		})
		.from(sources)
		.orderBy(asc(sources.workspaceId), asc(sources.key));
}
