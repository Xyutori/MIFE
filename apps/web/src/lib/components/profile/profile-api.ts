import { apiBase } from "#lib/api.ts";

export interface UserProfile {
	id: string;
	name: string;
	email: string;
	image?: string | null;
	headerImage?: string | null;
	username?: string | null;
	phone?: string | null;
	role?: string;
	isAdmin?: boolean | null;
}

export interface LinkedAccount {
	id: string;
	providerId: string;
	accountId?: string;
	createdAt?: string;
}

export interface ProfileUpdate {
	name: string;
	username: string | null;
	phone: string | null;
	image: string | null;
	headerImage: string | null;
}

/**
 * Asumsi kontrak backend (dibuat lane lain mengikuti XyMI):
 * - GET /api/auth/profile -> `{ user: UserProfile }` atau objek user langsung.
 *   Mengembalikan `null` bila 401; melempar bila endpoint belum tersedia.
 * - PATCH /api/auth/profile -> `{ user: UserProfile }` (atau user langsung).
 * - GET /api/auth/list-accounts -> `Account[]` ala better-auth (best-effort).
 */
export async function fetchProfile(
	signal?: AbortSignal,
): Promise<UserProfile | null> {
	const response = await fetch(`${apiBase()}/api/auth/profile`, {
		credentials: "include",
		signal,
	});
	if (response.status === 401) return null;
	const payload = (await response.json().catch(() => ({}))) as {
		user?: unknown;
		error?: unknown;
	} & Partial<UserProfile>;
	if (!response.ok) {
		throw new Error(
			typeof payload.error === "string" && payload.error
				? payload.error
				: "Profil tidak dapat dimuat.",
		);
	}
	const user =
		payload.user && typeof payload.user === "object"
			? (payload.user as UserProfile)
			: (payload as UserProfile);
	if (!user || typeof user.email !== "string") return null;
	return user;
}

export async function patchProfile(input: ProfileUpdate): Promise<UserProfile> {
	// Skema server menolak string kosong untuk username/phone
	// (minLength 3 | null) — normalkan ke null di satu titik ini agar
	// semua pemanggil (nama, avatar, banner) tidak perlu mengingatnya.
	const response = await fetch(`${apiBase()}/api/auth/profile`, {
		method: "PATCH",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name: input.name,
			username: input.username?.trim() ? input.username.trim() : null,
			phone: input.phone?.trim() ? input.phone.trim() : null,
			image: input.image,
			headerImage: input.headerImage,
		}),
	});
	const payload = (await response.json().catch(() => ({}))) as {
		user?: unknown;
		error?: unknown;
		message?: unknown;
	} & Partial<UserProfile>;
	if (!response.ok) {
		const message =
			typeof payload.error === "string" && payload.error
				? payload.error
				: typeof payload.message === "string" && payload.message
					? payload.message
					: "Profil gagal disimpan.";
		throw new Error(message);
	}
	const saved =
		payload.user && typeof payload.user === "object"
			? (payload.user as UserProfile)
			: (payload as unknown as UserProfile);
	return saved;
}

export async function fetchLinkedAccounts(
	signal?: AbortSignal,
): Promise<LinkedAccount[]> {
	try {
		const response = await fetch(`${apiBase()}/api/auth/list-accounts`, {
			credentials: "include",
			signal,
		});
		if (!response.ok) return [];
		const payload: unknown = await response.json().catch(() => []);
		if (!Array.isArray(payload)) return [];
		return payload.filter(
			(item): item is LinkedAccount =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as LinkedAccount).id === "string" &&
				typeof (item as LinkedAccount).providerId === "string",
		);
	} catch {
		return [];
	}
}

export interface UserSession {
	id: string;
	userAgent?: string | null;
	ipAddress?: string | null;
	createdAt?: string;
	updatedAt?: string;
	expiresAt?: string;
	current: boolean;
}

/**
 * Daftar sesi milik sendiri (GET /api/auth/sessions).
 * Mengembalikan array kosong bila belum login (401).
 */
export async function fetchSessions(
	signal?: AbortSignal,
): Promise<UserSession[]> {
	const response = await fetch(`${apiBase()}/api/auth/sessions`, {
		credentials: "include",
		signal,
	});
	if (response.status === 401) return [];
	const payload = (await response.json().catch(() => ({}))) as {
		sessions?: unknown;
		error?: unknown;
	};
	if (!response.ok) {
		throw new Error(
			typeof payload.error === "string" && payload.error
				? payload.error
				: "Daftar sesi tidak dapat dimuat.",
		);
	}
	if (!Array.isArray(payload.sessions)) return [];
	return payload.sessions.filter(
		(item): item is UserSession =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as UserSession).id === "string",
	);
}

/** Cabut satu sesi milik sendiri (selain sesi saat ini). */
export async function revokeSessionById(sessionId: string): Promise<void> {
	const response = await fetch(`${apiBase()}/api/auth/sessions/revoke`, {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionId }),
	});
	if (!response.ok) {
		const payload = (await response.json().catch(() => ({}))) as {
			error?: unknown;
		};
		throw new Error(
			typeof payload.error === "string" && payload.error
				? payload.error
				: "Sesi gagal dicabut.",
		);
	}
}

export type UserMediaKind = "avatar" | "header";

/**
 * Unggah hasil crop (selalu JPEG dari CropImageModal) ke endpoint media
 * profil milik sendiri. Mengembalikan URL sajian relatif untuk disimpan
 * via `patchProfile`.
 */
async function uploadUserMedia(
	kind: UserMediaKind,
	blob: Blob,
): Promise<string> {
	const form = new FormData();
	form.append("file", blob, kind === "avatar" ? "avatar.jpg" : "header.jpg");
	const response = await fetch(`${apiBase()}/api/auth/media/${kind}`, {
		method: "POST",
		credentials: "include",
		body: form,
	});
	const payload = (await response.json().catch(() => ({}))) as {
		url?: unknown;
		error?: unknown;
		message?: unknown;
	};
	if (!response.ok) {
		const message =
			typeof payload.message === "string" && payload.message
				? payload.message
				: typeof payload.error === "string" && payload.error
					? payload.error
					: "Unggahan gambar gagal.";
		throw new Error(message);
	}
	if (typeof payload.url !== "string" || !payload.url) {
		throw new Error("Respons server tidak valid.");
	}
	return payload.url;
}

/** Unggah foto profil (≤2MB). */
export function uploadAvatar(blob: Blob): Promise<string> {
	return uploadUserMedia("avatar", blob);
}

/** Unggah banner profil (≤5MB). */
export function uploadHeader(blob: Blob): Promise<string> {
	return uploadUserMedia("header", blob);
}
