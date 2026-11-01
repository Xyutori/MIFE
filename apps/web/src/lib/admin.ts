// Helper bersama untuk area anime & admin (client-side, Svelte 5).
// Kontrak endpoint mengikuti XyMI; lihat asumsi di tiap fungsi.
import { ENV } from "../env.generated";

export function resolveApiBase(configuredUrl: string): string {
	const configured = new URL(configuredUrl);
	if (typeof window === "undefined") return configured.origin;
	const browserHost = window.location.hostname;
	const configuredIsLoopback = ["localhost", "127.0.0.1", "::1"].includes(
		configured.hostname,
	);
	const browserIsLoopback = ["localhost", "127.0.0.1", "::1"].includes(
		browserHost,
	);
	if (configuredIsLoopback && !browserIsLoopback) return window.location.origin;
	return configured.origin;
}

export function apiBase(): string {
	const fallback = "http://localhost:3000";
	const configured = ENV.PUBLIC_SERVER_URL || fallback;
	try {
		return resolveApiBase(configured);
	} catch {
		return fallback;
	}
}

export async function requestJson<T>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const response = await fetch(`${apiBase()}${path}`, {
		credentials: "include",
		...init,
		headers: {
			...(init.body instanceof FormData
				? {}
				: { "content-type": "application/json" }),
			...init.headers,
		},
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message =
			(payload as { error?: string; message?: string }).error ??
			(payload as { message?: string }).message ??
			"Permintaan gagal.";
		const error = new Error(message) as Error & {
			status?: number;
			payload?: unknown;
		};
		error.status = response.status;
		error.payload = payload;
		throw error;
	}
	return payload as T;
}

// --- Cek admin -----------------------------------------------------------
// Primer: GET /api/auth/profile -> `{ user: { role, isAdmin } }`.
// 401 berarti belum login; user login dengan role/isAdmin admin berarti admin,
// user login lain berarti denied. Bila field role/isAdmin absen (backend lama),
// fallback ke probe RBAC lama di bawah — jangan rusak.
// Legacy: GET /api/admin/roles hanya 200 untuk admin,
// 401 bila belum login, 403 bila login tapi bukan admin.
// 403 → tampilkan akses-ditolak (jangan redirect loop).
export type AdminGateState =
	| { kind: "checking" }
	| { kind: "admin" }
	| { kind: "login" }
	| { kind: "denied" }
	| { kind: "error"; message: string };

type ProfileAdminProbe = {
	user?: unknown;
	role?: unknown;
	isAdmin?: unknown;
};

function readProfileUser(payload: unknown): {
	role?: unknown;
	isAdmin?: unknown;
} | null {
	if (typeof payload !== "object" || payload === null) return null;
	const record = payload as ProfileAdminProbe;
	const user =
		typeof record.user === "object" && record.user !== null
			? (record.user as { role?: unknown; isAdmin?: unknown })
			: record;
	if (typeof user !== "object" || user === null) return null;
	return user;
}

async function checkAdminLegacy(): Promise<AdminGateState> {
	for (const path of ["/api/admin/roles"]) {
		try {
			const response = await fetch(`${apiBase()}${path}`, {
				credentials: "include",
			});
			if (response.ok) return { kind: "admin" };
			if (response.status === 401) return { kind: "login" };
			if (response.status === 403) return { kind: "denied" };
		} catch {
			// Coba kandidat berikutnya; error dilaporkan bila semua gagal.
		}
	}
	return {
		kind: "error",
		message: "Server belum tersambung. Periksa koneksi lalu coba lagi.",
	};
}

export async function checkAdmin(): Promise<AdminGateState> {
	try {
		const response = await fetch(`${apiBase()}/api/auth/profile`, {
			credentials: "include",
		});
		if (response.status === 401) return { kind: "login" };
		if (response.status === 403) return { kind: "denied" };
		if (response.ok) {
			const user = readProfileUser(await response.json().catch(() => ({})));
			const hasField =
				user !== null &&
				(typeof user.isAdmin === "boolean" || typeof user.role === "string");
			if (hasField) {
				const admin = user.isAdmin === true || user.role === "admin";
				return admin ? { kind: "admin" } : { kind: "denied" };
			}
			return checkAdminLegacy();
		}
		if (response.status >= 500)
			return {
				kind: "error",
				message: `Server menjawab ${response.status}. Coba lagi nanti.`,
			};
		return checkAdminLegacy();
	} catch {
		return {
			kind: "error",
			message: "Server belum tersambung. Periksa koneksi lalu coba lagi.",
		};
	}
}

// --- Teks (port dari XyMI lib/text.ts) ------------------------------------

const namedEntities: Record<string, string> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};

export function decodeEntities(value: string | null | undefined): string {
	if (!value) return "";
	let result = value;
	for (let pass = 0; pass < 2; pass += 1) {
		result = result.replace(
			/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
			(entity, key: string) => {
				if (key[0] === "#") {
					const codePoint =
						key[1]?.toLowerCase() === "x"
							? Number.parseInt(key.slice(2), 16)
							: Number.parseInt(key.slice(1), 10);
					return Number.isInteger(codePoint) &&
						codePoint > 0 &&
						codePoint <= 0x10_ffff
						? String.fromCodePoint(codePoint)
						: entity;
				}
				return namedEntities[key.toLowerCase()] ?? entity;
			},
		);
	}
	return result;
}

function withNumberedTitle(
	label: "Episode",
	number: string,
	value: string | null | undefined,
): string {
	const base = `${label} ${number}`;
	const title = decodeEntities(value).trim();
	if (!title) return base;
	const escapedNumber = number.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const duplicate = title.match(
		new RegExp(
			`^(?:${label}\\s+)?${escapedNumber}(?:\\s*[-:·–—]\\s*(.*))?$`,
			"i",
		),
	);
	if (duplicate)
		return duplicate[1] ? `${base} · ${duplicate[1].trim()}` : base;
	return `${base} · ${title}`;
}

export function formatEpisodeLabel(
	number: string,
	title?: string | null,
): string {
	return withNumberedTitle("Episode", number, title);
}

export function formatDateId(value?: string | null): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) return null;
	return new Intl.DateTimeFormat("id-ID", {
		dateStyle: "medium",
		timeZone: "Asia/Jakarta",
	}).format(date);
}

export function formatDateTimeId(value?: string | null): string {
	if (!value) return "Belum pernah";
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) return "—";
	return new Intl.DateTimeFormat("id-ID", {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "Asia/Jakarta",
	}).format(date);
}

// --- Tipe kontrak API (asumsi = kontrak XyMI) -------------------------------

export type ThumbnailSource = {
	key: string;
	name: string;
	url: string;
	local: boolean;
};

export type AnimeListItem = {
	id: string;
	title: string;
	latestEpisodeNumber: string | null;
	latestEpisodes?: Array<{ id: string; numberText: string }>;
	genres: string[];
	thumbnailSources: ThumbnailSource[];
};

export type AnimeEpisode = {
	id: string;
	numberText: string;
	title: string | null;
	releasedAt: string | null;
};

export type AnimeDetail = {
	id: string;
	title: string;
	alternativeTitle: string | null;
	synopsis: string | null;
	status: string | null;
	releaseYear: number | null;
	score: number | null;
	episodeCount: number | null;
	animeType: string | null;
	studio: string | null;
	genres: string[];
	updatedAt: string;
	thumbnailSources: ThumbnailSource[];
	episodes: AnimeEpisode[];
	episodePagination: { total: number; hasMore: boolean; pageSize: number };
};

export type EpisodeMediaSource = {
	id: string;
	label: string;
	url: string;
	type: "video" | "embed";
	mimeType: string | null;
	quality: string | null;
	sourceKey: string;
	sourceName?: string;
};

export type EpisodeMedia = {
	animeId: string;
	animeTitle: string;
	episode: { id: string; numberText: string; title: string | null };
	nextEpisodeId: string | null;
	sources: EpisodeMediaSource[];
};

export type ScrapeRun = {
	id: string;
	kind: string;
	mode: string;
	status: string;
	currentStep: string | null;
	progressTotal: number;
	progressCompleted: number;
	progressFailed: number;
	errorMessage: string | null;
	createdAt: string;
	sourceName: string;
};

export type ScrapeEvent = {
	id: string;
	level: string;
	message: string;
	details?: unknown;
	createdAt: string;
};

export type MediaStatusCounts = {
	total: number;
	detected: number;
	pending: number;
	downloading: number;
	healthy: number;
	verifyDue: number;
	repairing: number;
	missing: number;
	corrupt: number;
	failed: number;
	stale: number;
	unsupported: number;
};

export type MediaSummary = MediaStatusCounts & {
	byType: Record<string, MediaStatusCounts>;
	disabledSources?: Array<{
		sourceKey: string;
		sourceName: string;
		reason: string;
	}>;
};

export type AdminMediaItem = {
	id: string;
	kind?: string;
	category?: string;
	type?: string;
	ownerUserId?: string;
	ownerId?: string;
	ownerName?: string;
	ownerEmail?: string;
	url: string;
	downloadUrl?: string;
	external?: boolean;
	contentType?: string;
	byteSize?: number | null;
	createdAt?: string;
};

export type AdminUser = {
	id: string;
	email: string;
	name: string;
	image?: string | null;
	role: string;
	banned: boolean;
	createdAt?: string | number;
};

export type RoleItem = {
	key: string;
	label: string;
	description?: string | null;
	isSystem?: boolean;
	permissions?: Array<{ key: string; label?: string }>;
};

export type PermissionItem = {
	key: string;
	label: string;
	description?: string | null;
	isSystem?: boolean;
};
