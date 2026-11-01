/**
 * Date parsing for anime source pages.
 *
 * Ported from XyMI `apps/server/src/anime/sources.ts` (`parseAnimeSourceDate`).
 * Returns ISO strings because the scrape lane (`jobs/anime.ts`) declares
 * `sourceUpdatedAt`/`releasedAt` as `string | null` and converts them to
 * `Date` via `toDate()` before persisting.
 */

const monthNumbers = new Map<string, number>([
	["jan", 1],
	["january", 1],
	["januari", 1],
	["feb", 2],
	["february", 2],
	["februari", 2],
	["mar", 3],
	["march", 3],
	["maret", 3],
	["apr", 4],
	["april", 4],
	["may", 5],
	["mei", 5],
	["jun", 6],
	["june", 6],
	["juni", 6],
	["jul", 7],
	["july", 7],
	["juli", 7],
	["aug", 8],
	["august", 8],
	["agu", 8],
	["agustus", 8],
	["sep", 9],
	["sept", 9],
	["september", 9],
	["oct", 10],
	["okt", 10],
	["october", 10],
	["oktober", 10],
	["nov", 11],
	["november", 11],
	["dec", 12],
	["des", 12],
	["december", 12],
	["desember", 12],
]);

const relativeDatePattern =
	/\b(\d+|a|an|se)?\s*(detik|second|seconds|menit|minute|minutes|jam|hour|hours|hari|day|days|minggu|week|weeks|bulan|month|months|tahun|year|years)\s*(?:yang\s+)?(?:lalu|ago)?\b/;

function normalizedDateText(value: string) {
	return value
		.toLocaleLowerCase("id-ID")
		.replace(/[,|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function isRelativeAnimeDate(value: string | null) {
	if (!value) return false;
	const normalized = normalizedDateText(value);
	return (
		/^(?:baru saja|barusan|just now|now|hari ini|today|kemarin|yesterday)$/.test(
			normalized,
		) || relativeDatePattern.test(normalized)
	);
}

function dateFromParts(
	day: number,
	month: number,
	year: number | null,
	clock: string | null,
	now: Date,
) {
	const [hour = 0, minute = 0, second = 0] = clock
		? clock.split(":").map(Number)
		: [];
	if (
		!Number.isInteger(day) ||
		day < 1 ||
		day > 31 ||
		!Number.isInteger(month) ||
		month < 1 ||
		month > 12 ||
		[hour, minute, second].some((part) => !Number.isInteger(part)) ||
		(hour ?? 0) > 23 ||
		(minute ?? 0) > 59 ||
		(second ?? 0) > 59
	)
		return null;
	const dateForYear = (targetYear: number) => {
		const candidate = new Date(
			Date.UTC(targetYear, month - 1, day, hour ?? 0, minute ?? 0, second ?? 0),
		);
		return candidate.getUTCFullYear() === targetYear &&
			candidate.getUTCMonth() === month - 1 &&
			candidate.getUTCDate() === day
			? candidate
			: null;
	};
	let targetYear = year ?? now.getUTCFullYear();
	let result = dateForYear(targetYear);
	if (
		year === null &&
		(!result || result.getTime() > now.getTime() + 24 * 60 * 60 * 1_000)
	) {
		targetYear -= 1;
		result = dateForYear(targetYear);
	}
	if (!result) return null;
	return result.toISOString();
}

/** Parse the date formats used by the supported anime sources. */
export function parseAnimeSourceDate(
	sourceKey: string,
	value: unknown,
	now = new Date(),
): string | null {
	if (typeof value !== "string" || !value.trim()) return null;
	if (!Number.isFinite(now.getTime())) return null;
	const raw = value.trim();
	if (
		/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i.test(
			raw,
		)
	) {
		const [year, month, day] = raw.slice(0, 10).split("-").map(Number);
		if (!dateFromParts(day ?? 0, month ?? 0, year ?? null, null, now))
			return null;
		const parsed = new Date(raw);
		return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
	}

	const normalized = normalizedDateText(raw);
	if (/^(?:baru saja|barusan|just now|now|hari ini|today)$/.test(normalized))
		return now.toISOString();
	if (/^(?:kemarin|yesterday)$/.test(normalized))
		return new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();

	const relative = normalized.match(relativeDatePattern);
	if (relative) {
		const amount =
			relative[1] === "se" || relative[1] === "a" || relative[1] === "an"
				? 1
				: Number(relative[1]);
		if (!Number.isFinite(amount)) return null;
		const unit = relative[2] ?? "";
		const multiplier = /detik|second/.test(unit)
			? 1_000
			: /menit|minute/.test(unit)
				? 60_000
				: /jam|hour/.test(unit)
					? 3_600_000
					: /hari|day/.test(unit)
						? 86_400_000
						: /minggu|week/.test(unit)
							? 604_800_000
							: /bulan|month/.test(unit)
								? 2_592_000_000
								: 31_536_000_000;
		const relativeDate = new Date(now.getTime() - amount * multiplier);
		return Number.isFinite(relativeDate.getTime())
			? relativeDate.toISOString()
			: null;
	}

	const withoutWeekday = normalized.replace(
		/^(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+/,
		"",
	);
	const cleaned = withoutWeekday
		.replace(
			/^(?:released?\s+on|updated?\s+on|rilis|release|update)\s*:?\s*/i,
			"",
		)
		.trim();
	const clock = cleaned.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/)?.[1] ?? null;

	const isoLike = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s|$)/);
	if (isoLike)
		return dateFromParts(
			Number(isoLike[3]),
			Number(isoLike[2]),
			Number(isoLike[1]),
			clock,
			now,
		);

	const numeric = cleaned.match(
		/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?(?:\s|$)/,
	);
	if (numeric) {
		const day = Number(numeric[1]);
		const month = Number(numeric[2]);
		const year = numeric[3] ? Number(numeric[3]) : null;
		const dayFirstSource =
			sourceKey === "otakudesu" || sourceKey === "kuramanime";
		if (!dayFirstSource && day <= 12 && month <= 12 && day !== month)
			return null;
		return dateFromParts(day, month, year, clock, now);
	}

	const tokens = cleaned
		.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/, "")
		.split(/[\s.]+/)
		.filter(Boolean);
	const firstMonth = monthNumbers.get(tokens[0] ?? "");
	const lastMonth = monthNumbers.get(tokens[1] ?? "");
	if (firstMonth) {
		const day = Number(tokens[1]);
		const year = tokens[2]
			? Number((tokens[2] ?? "").replace(/\D/g, ""))
			: null;
		return dateFromParts(
			day,
			firstMonth,
			year !== null && year > 999 ? year : null,
			clock,
			now,
		);
	}
	if (lastMonth) {
		const day = Number(tokens[0]);
		const year = tokens[2]
			? Number((tokens[2] ?? "").replace(/\D/g, ""))
			: null;
		return dateFromParts(
			day,
			lastMonth,
			year !== null && year > 999 ? year : null,
			clock,
			now,
		);
	}
	return null;
}
