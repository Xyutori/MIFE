import { getScrapeSettingsFresh } from "../scrape-settings";
import { db } from "../services";
import { cleanupExpiredVisits } from "../visits/record";
import { runScheduledAnimeScrapeForToday } from "./anime";
import { runScheduledScrapeForToday } from "./metadata";
import { resumeInterruptedWorkers } from "./recovery";
import { latestDueSlot } from "./schedule-slots";

const TICK_INTERVAL_MS = 30_000;

let interval: ReturnType<typeof setInterval> | undefined;
let tickInProgress = false;
/** Tanggal UTC terakhir cleanup ledger view lokal (YYYY-MM-DD). */
let lastVisitCleanupDay = "";

/**
 * Hapus baris `content_visits` kedaluwarsa sekali sehari (low-priority,
 * bukan hot path; error ditelan agar tick scrape tidak terganggu).
 */
async function maybeCleanupExpiredVisits() {
	try {
		const today = new Date().toISOString().slice(0, 10);
		if (lastVisitCleanupDay === today) return;
		lastVisitCleanupDay = today;
		await cleanupExpiredVisits(db);
	} catch {
		// Low-priority: abaikan, coba lagi besok (guard tanggal sudah maju).
	}
}

function describeErrorChain(error: unknown) {
	const chain: Array<{
		name: string;
		message: string;
		code?: string | number;
	}> = [];
	const seen = new Set<object>();
	let current: unknown = error;

	for (let depth = 0; current != null && depth < 5; depth += 1) {
		const isObject =
			(typeof current === "object" && current !== null) ||
			typeof current === "function";
		if (isObject) {
			const objectValue = current as object;
			if (seen.has(objectValue)) break;
			seen.add(objectValue);
		}
		const value = isObject ? (current as Record<string, unknown>) : undefined;
		const rawMessage =
			typeof value?.message === "string" ? value.message : String(current);
		const message = rawMessage
			.replace(
				/\b(?:libsql|postgres(?:ql)?|https?):\/\/[^\s"'`]+/gi,
				"<database-url>",
			)
			.slice(0, 2_000);
		const name = typeof value?.name === "string" ? value.name : "Error";
		const code = value?.code;
		chain.push({
			name,
			message,
			...(typeof code === "string" || typeof code === "number" ? { code } : {}),
		});
		current = value?.cause;
	}

	return chain;
}

/**
 * Start background scrape workers with the service identity (no user session).
 *
 * Runs an immediate tick, then every 30 seconds:
 * 1. resume workers left behind by a restart (`resumeInterruptedWorkers`),
 * 2. hitung slot jadwal terakhir yang sudah lewat hari ini dari
 *    `dailyTimes` admin (zona `timeZone`), lalu jalankan incremental scrape
 *    sekali per slot per sumber untuk tiap workspace comic/anime
 *    (idempotensi per-slot via `last_auto_scrape_date`+`last_auto_scrape_slot`).
 *
 * The orchestrator (`apps/server/src/index.ts`) wires this exactly once at
 * boot: `startBackgroundJobs()`.
 */
export function startBackgroundJobs() {
	if (interval) return;

	const tick = async () => {
		if (tickInProgress) return;
		tickInProgress = true;
		try {
			// Baca segar tiap tick (tanpa cache): jadwal mengikuti perubahan
			// admin maksimal 30 detik (interval tick).
			const settings = (await getScrapeSettingsFresh()).values;
			await resumeInterruptedWorkers();
			await maybeCleanupExpiredVisits();
			const slot = latestDueSlot(settings.timeZone, settings.dailyTimes);
			if (!slot) return;
			const results = await Promise.allSettled([
				runScheduledScrapeForToday("comic", settings.timeZone, slot),
				runScheduledScrapeForToday("superkomik", settings.timeZone, slot),
				runScheduledAnimeScrapeForToday(settings.timeZone, slot),
			]);
			for (const [index, result] of results.entries()) {
				if (result.status === "rejected") {
					const message =
						result.reason instanceof Error
							? result.reason.message
							: "Kesalahan scheduler tidak diketahui";
					console.error(
						[
							"Daily Comic scrape could not be started",
							"Daily SuperKomik scrape could not be started",
							"Daily Anime scrape could not be started",
						][index],
						{
							error: message,
							errorChain: describeErrorChain(result.reason),
						},
					);
				}
			}
		} finally {
			tickInProgress = false;
		}
	};

	void tick();
	interval = setInterval(() => void tick(), TICK_INTERVAL_MS);
}
