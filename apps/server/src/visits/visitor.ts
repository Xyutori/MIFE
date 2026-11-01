import { createHmac } from "node:crypto";

/**
 * Helper murni untuk dedup view lokal (lane VISITOR-SERVER).
 *
 * Tidak ada I/O di sini: semua fungsi di bawah pure + testable.
 * Logika DB ada di `record.ts`, wiring HTTP ada di route
 * `POST /api/v1/views` (`routes/comic.ts`).
 */

const BOT_PATTERN =
	/bot|crawl|spider|slurp|mediapartners|headless|python-requests|curl|wget|scrapy/i;

export function isBot(userAgent: string): boolean {
	if (!userAgent) return false;
	return BOT_PATTERN.test(userAgent);
}

function firstHeaderValue(
	headers: Headers | Record<string, string | string[] | undefined | null>,
	name: string,
): string | null {
	if (typeof (headers as Headers).get === "function") {
		const value = (headers as Headers).get(name);
		return typeof value === "string" && value.length > 0 ? value : null;
	}
	const record = headers as Record<
		string,
		string | string[] | undefined | null
	>;
	for (const key of Object.keys(record)) {
		if (key.toLowerCase() === name) {
			const value = record[key];
			if (Array.isArray(value)) return value[0] ?? null;
			return typeof value === "string" && value.length > 0 ? value : null;
		}
	}
	return null;
}

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/;

/** Validasi dasar IPv4/IPv6 (bukan validasi ketat per-oktet/grup). */
export function isValidIp(value: string): boolean {
	if (IPV4_PATTERN.test(value)) {
		return value.split(".").every((octet) => Number(octet) <= 255);
	}
	if (value.includes(":") && IPV6_PATTERN.test(value)) return true;
	return false;
}

function stripPort(candidate: string): string {
	const value = candidate.trim().replace(/^["']|["']$/g, "");
	if (!value) return "";
	// IPv6 braket: "[::1]" atau "[::1]:3000".
	if (value.startsWith("[")) {
		const end = value.indexOf("]");
		if (end > 0) return value.slice(1, end);
		return value;
	}
	const colonCount = (value.match(/:/g) ?? []).length;
	if (colonCount === 0) return value;
	if (colonCount === 1) {
		// "1.2.3.4:5678" -> "1.2.3.4"; hostname tanpa port dibiarkan.
		const [host, port] = value.split(":");
		if (host && port && /^\d+$/.test(port) && IPV4_PATTERN.test(host))
			return host;
		return value;
	}
	// >1 colon = IPv6 literal tanpa braket; pertahankan apa adanya.
	return value;
}

/**
 * Urutan: X-Forwarded-For[0] -> X-Real-IP -> socketIp.
 * Mengembalikan `"unknown"` bila tidak ada IP valid.
 */
export function getClientIp(
	headers: Headers | Record<string, string | string[] | undefined | null>,
	socketIp?: string | null,
): string {
	const forwarded = firstHeaderValue(headers, "x-forwarded-for");
	if (forwarded) {
		const first = forwarded.split(",")[0]?.trim() ?? "";
		const cleaned = stripPort(first);
		if (cleaned && isValidIp(cleaned)) return cleaned;
	}
	const realIp = firstHeaderValue(headers, "x-real-ip");
	if (realIp) {
		const cleaned = stripPort(realIp.trim());
		if (cleaned && isValidIp(cleaned)) return cleaned;
	}
	if (socketIp) {
		const cleaned = stripPort(socketIp.trim());
		if (cleaned && isValidIp(cleaned)) return cleaned;
	}
	return "unknown";
}

export type VisitorKeyInput = {
	userId?: string | null;
	ip: string;
	ua: string;
	/** Default `new Date()`; diinjeksikan di test agar deterministik per hari. */
	now?: Date;
	/** Default `process.env.BETTER_AUTH_SECRET`; diinjeksikan di test. */
	secret?: string;
};

/**
 * `userId` ada -> `u:{userId}` (menang atas IP/UA).
 * Anonim -> `a:{12 hex}` = HMAC-SHA256(secret, `ip|ua64|yyyy-mm-dd`).
 */
export function visitorKey(input: VisitorKeyInput): string {
	const userId = input.userId?.trim();
	if (userId) return `u:${userId}`;
	const secret = input.secret ?? process.env.BETTER_AUTH_SECRET ?? "";
	const day = (input.now ?? new Date()).toISOString().slice(0, 10);
	const payload = `${input.ip}|${input.ua.slice(0, 64)}|${day}`;
	const hex = createHmac("sha256", secret).update(payload).digest("hex");
	return `a:${hex.slice(0, 12)}`;
}
