import type { Database } from "@SyMi/db";
import {
	account as authAccount,
	session as authSession,
	user as authUser,
	verification as authVerification,
} from "@SyMi/db/schema/auth";
import { bookmarkGroups } from "@SyMi/db/schema/bookmarks";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";

import {
	configureOAuthProviders,
	type OAuthEnvironment,
	type PublicOAuthProvider,
} from "./oauth-providers";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
	AUTH_BOOTSTRAP_ADMIN_EMAIL?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	BETTER_AUTH_TRUSTED_ORIGINS?: string;
	BETTER_AUTH_COOKIE_DOMAIN?: string;
};

export const authDiagnostics: { lastError: string | null } = {
	lastError: null,
};

export function getActiveOAuthProviders(
	env: OAuthEnvironment,
): PublicOAuthProvider[] {
	return configureOAuthProviders(env).providers;
}

export function isBannedSession(session: unknown) {
	if (typeof session !== "object" || session === null || !("user" in session))
		return false;
	const sessionUser = (session as { user: unknown }).user;
	return (
		typeof sessionUser === "object" &&
		sessionUser !== null &&
		"banned" in sessionUser &&
		(sessionUser as { banned: unknown }).banned === true
	);
}

function normalizeEmail(value: string) {
	const normalized = value.trim().toLowerCase();
	if (!normalized) throw new Error("Email address is required");
	return normalized;
}

function parseTrustedOrigins(value: string | undefined) {
	if (!value) return [];
	return value
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);
}

function validateCookieDomain(domain: string) {
	const normalized = domain.trim().toLowerCase().replace(/^\./, "");
	if (
		!normalized ||
		normalized.includes(":") ||
		normalized.includes("/") ||
		normalized === "localhost" ||
		!normalized.includes(".") ||
		!normalized
			.split(".")
			.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
	)
		throw new Error(
			"BETTER_AUTH_COOKIE_DOMAIN must be a registrable domain name",
		);
	return normalized;
}

function formatAuthError(error: unknown) {
	const name = error instanceof Error ? error.name : "Error";
	const message = error instanceof Error ? error.message : String(error);
	return `${name}: ${message}`.replace(
		/(client_secret|access_token|refresh_token|id_token|code_verifier|state)(=|%3D)[^&\s]+/gi,
		"$1=[redacted]",
	);
}

/**
 * Promote the freshly created user to `admin` when it matches
 * `AUTH_BOOTSTRAP_ADMIN_EMAIL` and no admin exists yet. Paritas dengan XyMI
 * (`databaseHooks.user.create.before`): user tidak perlu signup lalu restart
 * server. Tidak pernah throw — kegagalan (mis. tabel RBAC belum migrasi)
 * hanya warning agar signup tetap berhasil; `ensureBootstrapAdmin` saat boot
 * tetap jadi jalur recovery.
 */
async function promoteBootstrapAdmin(
	db: Database,
	bootstrapEmail: string | undefined,
	created: { id: string; email: string },
) {
	try {
		const target = bootstrapEmail?.trim();
		if (!target) return;
		let matches = false;
		try {
			matches = normalizeEmail(created.email) === normalizeEmail(target);
		} catch {
			return;
		}
		if (!matches) return;
		const admins = await db.$client.query(
			"SELECT user_id FROM rbac_user_roles WHERE role_key = 'admin' LIMIT 1",
		);
		if (admins.rows.length > 0) return;
		await db.$client.query(
			"INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'admin') ON CONFLICT DO NOTHING",
			[created.id],
		);
	} catch (error) {
		console.warn("Bootstrap admin promotion skipped", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Buat grup default per tipe media bila belum ada: comic "Baca nanti",
 * anime "Tonton nanti", keduanya dengan `defaultKey: "default"`.
 * Idempoten via unique index `(user_id, media_type, default_key)` — dicek
 * by user+type, bukan by nama (nama bisa diubah user).
 * Tidak pernah throw: dipanggil dari hook signup (`create.after`) dan
 * sign-in (`validateUserInfo`); kegagalan (mis. tabel belum migrasi) hanya
 * warning agar auth tetap berhasil. User lama yang belum punya grup
 * dicakup oleh ensure di sisi server (`bookmarkRoutes.handle`).
 */
async function ensureDefaultBookmarkGroup(db: Database, userId: string) {
	try {
		const now = new Date();
		const defaults = [
			{ mediaType: "comic", name: "Baca nanti" },
			{ mediaType: "anime", name: "Tonton nanti" },
		] as const;
		await Promise.all(
			defaults.map(({ mediaType, name }) =>
				db
					.insert(bookmarkGroups)
					.values({
						id: crypto.randomUUID(),
						userId,
						mediaType,
						name,
						description: null,
						normalizedName: name.toLowerCase(),
						defaultKey: "default",
						customCoverUrl: null,
						orderIndex: 0,
						createdAt: now,
						updatedAt: now,
					})
					.onConflictDoNothing(),
			),
		);
	} catch (error) {
		console.warn("Default bookmark group ensure skipped", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export function createAuth(
	env: AuthConfig,
	database: Database,
	desktopOrigins: readonly string[] = [],
) {
	if (!env.BETTER_AUTH_SECRET.trim())
		throw new Error("BETTER_AUTH_SECRET must be configured");

	const oauth = configureOAuthProviders(env as OAuthEnvironment);
	const trustedOrigins = [
		env.CORS_ORIGIN,
		...desktopOrigins,
		...parseTrustedOrigins(env.BETTER_AUTH_TRUSTED_ORIGINS),
	];
	const cookieDomain = env.BETTER_AUTH_COOKIE_DOMAIN?.trim()
		? validateCookieDomain(env.BETTER_AUTH_COOKIE_DOMAIN)
		: undefined;

	return betterAuth({
		database: drizzleAdapter(database, {
			provider: "pg",
			schema: {
				user: authUser,
				session: authSession,
				account: authAccount,
				verification: authVerification,
			},
		}),
		trustedOrigins,
		emailAndPassword: { enabled: false },
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		socialProviders: oauth.socialProviders,
		onAPIError: {
			onError: (error) => {
				const detail = formatAuthError(error);
				authDiagnostics.lastError = detail;
				console.error("Better Auth API error", { error: detail });
			},
		},
		user: {
			changeEmail: { enabled: false },
			additionalFields: {
				banned: {
					type: "boolean",
					defaultValue: false,
					required: true,
					input: false,
				},
				banReason: {
					type: "string",
					required: false,
					input: false,
					returned: false,
				},
				headerImage: { type: "string", required: false, input: false },
				username: { type: "string", required: false, input: false },
				phone: { type: "string", required: false, input: false },
			},
			validateUserInfo: async ({ user: profile, source }) => {
				const userId = typeof profile.id === "string" ? profile.id : null;
				const profileEmail =
					typeof profile.email === "string" ? profile.email : null;
				const [storedUser] =
					source.action === "create-user" || !userId
						? []
						: await database
								.select({ email: authUser.email, banned: authUser.banned })
								.from(authUser)
								.where(eq(authUser.id, userId))
								.limit(1);
				if (storedUser?.banned === true) {
					return {
						error: "account_suspended",
						errorDescription: "This account is suspended",
					};
				}

				if (source.action === "create-user") {
					if (!profileEmail || profile.emailVerified !== true) {
						return {
							error: "verified_email_required",
							errorDescription:
								"A verified email address is required to create an account",
						};
					}
					return;
				}

				if (source.action === "link-account") {
					const oauthProfile = source.oauth?.profile;
					const providerEmail =
						typeof oauthProfile?.email === "string" ? oauthProfile.email : null;
					if (
						!userId ||
						!profileEmail ||
						!providerEmail ||
						oauthProfile?.emailVerified !== true
					) {
						return {
							error: "oauth_identity_not_allowed",
							errorDescription:
								"Link an OAuth identity with the same verified email as this account",
						};
					}
					let emailsMatch = false;
					try {
						emailsMatch =
							normalizeEmail(providerEmail) === normalizeEmail(profileEmail);
					} catch {
						// Invalid OAuth email data is treated as an untrusted identity.
					}
					if (!emailsMatch) {
						return {
							error: "oauth_identity_not_allowed",
							errorDescription:
								"Link an OAuth identity with the same verified email as this account",
						};
					}
					return;
				}

				if (source.action === "sign-in") {
					if (storedUser && userId)
						await ensureDefaultBookmarkGroup(database, userId);
				}
			},
		},
		account: {
			encryptOAuthTokens: true,
			accountLinking: {
				enabled: true,
				disableImplicitLinking: true,
				allowDifferentEmails: false,
			},
		},
		databaseHooks: {
			user: {
				create: {
					before: async (incoming) => {
						const email =
							typeof incoming.email === "string" ? incoming.email : "";
						if (!email || incoming.emailVerified !== true)
							throw new APIError("FORBIDDEN", {
								message: "A verified email is required to create an account",
							});
						return {
							data: {
								...incoming,
								email: normalizeEmail(email),
							},
						};
					},
					after: async (created) => {
						if (
							typeof created.email !== "string" ||
							typeof created.id !== "string"
						)
							throw new Error("OAuth user is missing its verified email or id");
						await ensureDefaultBookmarkGroup(database, created.id);
						await promoteBootstrapAdmin(
							database,
							env.AUTH_BOOTSTRAP_ADMIN_EMAIL,
							{
								id: created.id,
								email: created.email,
							},
						);
					},
				},
			},
			session: {
				create: {
					before: async (session) => {
						const [owner] = await database
							.select({ banned: authUser.banned })
							.from(authUser)
							.where(eq(authUser.id, session.userId))
							.limit(1);
						if (!owner || owner.banned)
							throw new APIError("FORBIDDEN", {
								message: "This account is suspended",
							});
					},
				},
			},
		},
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
			...(cookieDomain
				? {
						crossSubDomainCookies: {
							enabled: true,
							domain: cookieDomain,
						},
					}
				: {}),
		},
		plugins: [],
	});
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];

export type { OAuthEnvironment, PublicOAuthProvider };
