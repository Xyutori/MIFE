import { getScrapeSettingsFresh } from "../scrape-settings";
import { runScheduledAnimeScrapeForToday } from "./anime";
import { runScheduledScrapeForToday } from "./metadata";
import { resumeInterruptedWorkers } from "./recovery";

const TICK_INTERVAL_MS = 30_000;

let interval: ReturnType<typeof setInterval> | undefined;
let tickInProgress = false;

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

function currentTimeInZone(timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date());
	const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
	const minute = Number(
		parts.find((part) => part.type === "minute")?.value ?? 0,
	);
	return hour * 60 + minute;
}

function scheduledMinute(dailyTime: string) {
	const [hourText, minuteText] = dailyTime.split(":");
	const hour = Number(hourText);
	const minute = Number(minuteText);
	if (
		!Number.isInteger(hour) ||
		!Number.isInteger(minute) ||
		hour < 0 ||
		hour > 23 ||
		minute < 0 ||
		minute > 59
	) {
		return 20 * 60;
	}
	return hour * 60 + minute;
}

/**
 * Start background scrape workers with the service identity (no user session).
 *
 * Runs an immediate tick, then every 30 seconds:
 * 1. resume workers left behind by a restart (`resumeInterruptedWorkers`),
 * 2. once the local time in `SCRAPE_TIME_ZONE` reaches `SCRAPE_DAILY_TIME`,
 *    launch the daily incremental scrape for every comic/anime workspace
 *    (per-source idempotency via `last_auto_scrape_date`).
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
			if (
				currentTimeInZone(settings.timeZone) <
				scheduledMinute(settings.dailyTime)
			)
				return;
			const results = await Promise.allSettled([
				runScheduledScrapeForToday("comic", settings.timeZone),
				runScheduledScrapeForToday("superkomik", settings.timeZone),
				runScheduledAnimeScrapeForToday(settings.timeZone),
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
