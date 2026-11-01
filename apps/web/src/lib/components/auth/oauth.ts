import { apiBase } from "#lib/api.ts";

export interface OAuthProvider {
	id: string;
	name: string;
}

export function providerDisplayName(id: string | null | undefined): string {
	if (id === "google") return "Google";
	if (id === "github") return "GitHub";
	if (id === "discord") return "Discord";
	if (!id) return "OAuth";
	return id.charAt(0).toUpperCase() + id.slice(1);
}

export async function fetchOAuthProviders(
	signal?: AbortSignal,
): Promise<OAuthProvider[]> {
	const response = await fetch(`${apiBase()}/api/auth/providers`, {
		credentials: "include",
		signal,
	});
	const payload = (await response.json().catch(() => ({}))) as {
		providers?: unknown;
		error?: unknown;
	};
	if (!response.ok) {
		throw new Error(
			typeof payload.error === "string" && payload.error
				? payload.error
				: "Provider tidak dapat dimuat.",
		);
	}
	if (!Array.isArray(payload.providers)) return [];
	return payload.providers.filter(
		(item): item is OAuthProvider =>
			typeof item === "object" &&
			item !== null &&
			typeof (item as OAuthProvider).id === "string" &&
			typeof (item as OAuthProvider).name === "string",
	);
}

export function errorCallbackUrl(providerId: string): string {
	const url = new URL("/", window.location.origin);
	url.searchParams.set("provider", providerId);
	return url.toString();
}

/** Memulai login sosial ala XyMI: POST lalu redirect ke URL OAuth server. */
export async function signInWithProvider(
	provider: OAuthProvider,
	callbackPath: string,
): Promise<void> {
	const response = await fetch(`${apiBase()}/api/auth/sign-in/social`, {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			provider: provider.id,
			callbackURL: new URL(callbackPath, window.location.origin).toString(),
			errorCallbackURL: errorCallbackUrl(provider.id),
		}),
	});
	const payload = (await response.json().catch(() => ({}))) as {
		url?: unknown;
		code?: unknown;
		error?: unknown;
		message?: unknown;
	};
	if (!response.ok) {
		throw new Error(
			oauthErrorMessage(
				typeof payload.code === "string"
					? payload.code
					: typeof payload.error === "string"
						? payload.error
						: null,
				typeof payload.message === "string" ? payload.message : null,
				response.status,
				provider.name,
			),
		);
	}
	if (typeof payload.url === "string") {
		window.location.assign(payload.url);
		return;
	}
	throw new Error("Server auth tidak mengembalikan URL login.");
}

export function oauthErrorMessage(
	code?: string | null,
	description?: string | null,
	status?: number,
	providerLabel = "OAuth",
): string {
	const messages: Record<string, string> = {
		oauth: `Login ${providerLabel} gagal. Coba lagi.`,
		access_denied: "Login dibatalkan.",
		invalid_origin: "Origin aplikasi tidak cocok dengan konfigurasi auth.",
		invalid_callback_url: "URL callback OAuth tidak diizinkan server.",
		invalid_error_callback_url:
			"URL callback error OAuth tidak diizinkan server.",
		oauth_provider_not_found: `Provider ${providerLabel} belum aktif. Periksa konfigurasi OAuth di server.`,
		provider_not_found: `Provider ${providerLabel} belum aktif. Periksa konfigurasi OAuth di server.`,
		state_not_found: "Sesi login kedaluwarsa. Coba masuk kembali.",
		state_mismatch: "Sesi login tidak cocok. Coba masuk kembali.",
		state_expired: "Sesi login kedaluwarsa. Coba masuk kembali.",
		invalid_code: `${providerLabel} menolak kode login. Coba masuk kembali.`,
		unable_to_get_user_info: `Data akun ${providerLabel} tidak dapat dibaca. Periksa izin email dan profil OAuth.`,
		email_not_found: `Akun ${providerLabel} tidak memberikan alamat email. Periksa izin email OAuth.`,
		user_email_not_found: `Akun ${providerLabel} tidak memberikan alamat email. Periksa izin email OAuth.`,
		email_not_verified: `Email akun ${providerLabel} belum terverifikasi.`,
		oauth_identity_not_allowed: `Email akun ${providerLabel} tidak cocok dengan akun yang sudah terhubung.`,
		account_already_linked_to_different_user: `Akun ${providerLabel} sudah terhubung ke pengguna lain.`,
		redirect_uri_mismatch:
			"Redirect URI tidak cocok. Samakan URL callback di console provider dengan URL callback server.",
		invalid_client:
			"Kredensial OAuth tidak valid. Periksa client ID dan client secret provider.",
		unauthorized_client: "Aplikasi OAuth belum diizinkan oleh provider.",
		account_suspended: "Akun ini sedang dinonaktifkan.",
		auth_internal_error: "Server auth gagal memulai OAuth. Periksa log server.",
		internal_server_error:
			"Server auth gagal memulai OAuth. Periksa log server.",
	};
	const normalizedCode = code?.trim().toLowerCase();
	if (normalizedCode && messages[normalizedCode])
		return messages[normalizedCode];
	if (status && status >= 500)
		return "Server auth gagal memulai OAuth. Periksa log server.";
	if (normalizedCode)
		return `Login gagal (${normalizedCode}). Periksa konfigurasi OAuth.`;
	if (description?.toLowerCase().includes("trusted"))
		return "Origin aplikasi tidak cocok dengan konfigurasi auth.";
	return "Login gagal. Periksa konfigurasi OAuth lalu coba lagi.";
}
