import { authDiagnostics, getActiveOAuthProviders } from "@SyMi/auth";
import { session as authSession, user as authUser } from "@SyMi/db/schema/auth";
import { userMedia } from "@SyMi/db/schema/index";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { isBannedSession } from "../auth/session";
import { ENV } from "../env.server";
import { userAvatarObjectKey, userHeaderObjectKey } from "../media/object-keys";
import { deleteUserMediaBlob } from "../media/user-media";
import { userRoleKeys } from "../rbac/permissions";
import { auth, db } from "../services";
import { getObjectBytes, putObject } from "../storage/s3";

const profilePatchSchema = t.Object(
	{
		name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
		image: t.Optional(t.Union([t.String({ maxLength: 2048 }), t.Null()])),
		headerImage: t.Optional(t.Union([t.String({ maxLength: 2048 }), t.Null()])),
		username: t.Optional(
			t.Union([
				t.String({
					minLength: 3,
					maxLength: 32,
					pattern: "^[a-zA-Z0-9_.-]+$",
				}),
				t.Null(),
			]),
		),
		phone: t.Optional(
			t.Union([
				t.String({
					minLength: 3,
					maxLength: 32,
					pattern: "^[+0-9(). -]+$",
				}),
				t.Null(),
			]),
		),
	},
	{ additionalProperties: false, minProperties: 1 },
);

type AuthInstance = typeof auth;

async function getActiveSession(headers: Headers) {
	const session = await auth.api.getSession({ headers });
	return isBannedSession(session) ? null : session;
}

async function handleAuthRequest(request: Request) {
	const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
	if (pathname.endsWith("/sign-in/social"))
		return runAuthHandler(request, pathname);
	let session: Awaited<ReturnType<AuthInstance["api"]["getSession"]>>;
	try {
		session = await auth.api.getSession({ headers: request.headers });
	} catch {
		return runAuthHandler(request, pathname);
	}
	if (isBannedSession(session)) {
		if (pathname.endsWith("/sign-out"))
			return runAuthHandler(request, pathname);
		if (request.method === "GET" && pathname.endsWith("/get-session"))
			return Response.json(null, {
				headers: { "cache-control": "no-store" },
			});
		return Response.json(
			{ error: "account_suspended" },
			{ status: 401, headers: { "cache-control": "no-store" } },
		);
	}
	return runAuthHandler(request, pathname);
}

async function runAuthHandler(request: Request, pathname: string) {
	authDiagnostics.lastError = null;
	try {
		const response = await auth.handler(request);
		if (response.status >= 500) {
			const body = await response
				.clone()
				.text()
				.catch(() => "");
			if (!body.trim())
				return Response.json(
					{
						error: "auth_internal_error",
						code: "AUTH_INTERNAL_ERROR",
						message: "Server auth gagal memulai OAuth.",
						...(process.env.NODE_ENV === "development" &&
						authDiagnostics.lastError
							? { debug: authDiagnostics.lastError }
							: {}),
					},
					{ status: response.status, headers: { "cache-control": "no-store" } },
				);
		}
		return response;
	} catch (error) {
		const debug =
			error instanceof Error
				? `${error.name}: ${error.message}`
				: "Unknown authentication error";
		console.error("Better Auth request failed", {
			method: request.method,
			path: pathname,
			debug,
		});
		return Response.json(
			{
				error: "auth_internal_error",
				code: "AUTH_INTERNAL_ERROR",
				message: "Server auth gagal memulai OAuth.",
				...(process.env.NODE_ENV === "development" ? { debug } : {}),
			},
			{ status: 500, headers: { "cache-control": "no-store" } },
		);
	}
}

function normalizeImageValue(value: string | null) {
	if (value === null) return null;
	const normalized = value.trim();
	if (!normalized) return null;
	if (hasControlCharacters(normalized)) return false;
	if (normalized.startsWith("/") && !normalized.startsWith("//"))
		return normalized;
	try {
		const url = new URL(normalized);
		if (url.protocol === "https:" || url.protocol === "http:")
			return normalized;
	} catch {
		// Invalid and non-HTTP image addresses are rejected below.
	}
	return false;
}

function hasControlCharacters(value: string) {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 0x20 || codePoint === 0x7f;
	});
}

function isUniqueConstraintError(error: unknown) {
	return error instanceof Error && /unique|constraint/i.test(error.message);
}

// --- Upload foto/banner profil (lane USER-MEDIA-UPLOAD) ---
// Crop/aspek (1:1 avatar, 3:1 header) sudah dikerjakan client via canvas;
// server hanya memvalidasi mime + ukuran, lalu menimpa blob deterministik.
const USER_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const HEADER_MAX_BYTES = 5 * 1024 * 1024;
const USER_MEDIA_USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type UserMediaKind = "avatar" | "header";

async function uploadUserMedia(
	request: Request,
	kind: UserMediaKind,
): Promise<{ status: number; body: unknown }> {
	const session = await getActiveSession(request.headers);
	if (!session) {
		return {
			status: 401,
			body: {
				error: "unauthorized",
				message: "Masuk terlebih dahulu untuk mengunggah gambar.",
			},
		};
	}
	const userId = session.user.id;
	const maxBytes = kind === "avatar" ? AVATAR_MAX_BYTES : HEADER_MAX_BYTES;
	const kindLabel = kind === "avatar" ? "Foto profil" : "Banner";

	let form: Awaited<ReturnType<Request["formData"]>>;
	try {
		form = await request.formData();
	} catch {
		return {
			status: 400,
			body: {
				error: "invalid_form",
				message:
					"Kirim gambar sebagai multipart/form-data dengan field “file”.",
			},
		};
	}
	const file = form.get("file");
	if (
		!file ||
		typeof file !== "object" ||
		typeof (file as File).arrayBuffer !== "function"
	) {
		return {
			status: 400,
			body: {
				error: "missing_file",
				message: "File gambar tidak ditemukan. Sertakan field “file”.",
			},
		};
	}
	const upload = file as File;
	const contentType =
		(upload.type || "").toLowerCase().split(";")[0]?.trim() ?? "";
	if (!USER_MEDIA_MIME_TYPES.includes(contentType)) {
		return {
			status: 400,
			body: {
				error: "invalid_mime",
				message: "Format gambar harus JPEG, PNG, atau WebP.",
			},
		};
	}
	if (upload.size <= 0) {
		return {
			status: 400,
			body: { error: "empty_file", message: "File gambar kosong." },
		};
	}
	if (upload.size > maxBytes) {
		return {
			status: 413,
			body: {
				error: "file_too_large",
				message: `${kindLabel} maksimal ${kind === "avatar" ? "2MB" : "5MB"}.`,
			},
		};
	}
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await upload.arrayBuffer());
	} catch {
		return {
			status: 400,
			body: {
				error: "unreadable_file",
				message: "File gambar tidak dapat dibaca.",
			},
		};
	}
	if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
		return {
			status: 413,
			body: {
				error: "file_too_large",
				message: `${kindLabel} maksimal ${kind === "avatar" ? "2MB" : "5MB"}.`,
			},
		};
	}

	const mediaType = kind === "avatar" ? "profile_avatar" : "profile_header";
	const objectKey =
		kind === "avatar"
			? userAvatarObjectKey(userId, contentType)
			: userHeaderObjectKey(userId, contentType);
	const sha256 = createHash("sha256").update(bytes).digest("hex");

	try {
		await putObject(objectKey, bytes, contentType);
	} catch (error) {
		console.error("Upload user media ke storage gagal", {
			kind,
			reason: error instanceof Error ? error.message : "unknown",
		});
		return {
			status: 500,
			body: {
				error: "upload_failed",
				message: "Gagal menyimpan gambar. Coba lagi.",
			},
		};
	}

	let previousKey: string | null = null;
	try {
		const [existing] = await db
			.select({ objectKey: userMedia.objectKey })
			.from(userMedia)
			.where(
				and(
					eq(userMedia.ownerUserId, userId),
					eq(userMedia.mediaType, mediaType),
					eq(userMedia.ownerId, userId),
				),
			)
			.limit(1);
		previousKey = existing?.objectKey ?? null;
	} catch {
		previousKey = null;
	}
	try {
		await db
			.insert(userMedia)
			.values({
				id: crypto.randomUUID(),
				ownerUserId: userId,
				mediaType,
				ownerId: userId,
				objectKey,
				contentType,
				byteSize: bytes.byteLength,
				sha256,
			})
			.onConflictDoUpdate({
				target: [userMedia.ownerUserId, userMedia.mediaType, userMedia.ownerId],
				set: {
					objectKey,
					contentType,
					byteSize: bytes.byteLength,
					sha256,
					updatedAt: new Date(),
				},
			});
	} catch (error) {
		console.error("Upsert user_media gagal", {
			kind,
			reason: error instanceof Error ? error.message : "unknown",
		});
		return {
			status: 500,
			body: {
				error: "upload_failed",
				message: "Gagal menyimpan data gambar. Coba lagi.",
			},
		};
	}
	if (previousKey && previousKey !== objectKey)
		await deleteUserMediaBlob(previousKey);

	const url = `/api/auth/media/${kind}/${encodeURIComponent(userId)}`;
	try {
		await db
			.update(authUser)
			.set({
				...(kind === "avatar" ? { image: url } : { headerImage: url }),
				updatedAt: new Date(),
			})
			.where(eq(authUser.id, userId));
	} catch (error) {
		console.error("Update foto profil pengguna gagal", {
			kind,
			reason: error instanceof Error ? error.message : "unknown",
		});
		return {
			status: 500,
			body: {
				error: "upload_failed",
				message: "Gambar tersimpan tetapi profil gagal diperbarui. Coba lagi.",
			},
		};
	}
	return { status: 200, body: { url } };
}

type UserMediaResult =
	| { bytes: Uint8Array; contentType: string }
	| { missing: true }
	| { unavailable: true };

async function serveUserMedia(
	userId: string,
	mediaType: "profile_avatar" | "profile_header",
): Promise<UserMediaResult> {
	if (!USER_MEDIA_USER_ID_PATTERN.test(userId)) return { missing: true };
	try {
		const [row] = await db
			.select({
				objectKey: userMedia.objectKey,
				contentType: userMedia.contentType,
			})
			.from(userMedia)
			.where(
				and(
					eq(userMedia.ownerUserId, userId),
					eq(userMedia.mediaType, mediaType),
					eq(userMedia.ownerId, userId),
				),
			)
			.limit(1);
		if (!row) return { missing: true };
		try {
			const bytes = await getObjectBytes(row.objectKey);
			return { bytes, contentType: row.contentType };
		} catch (error) {
			// Baris DB ada tapi object S3/MinIO tidak terbaca: laporkan 502
			// (bukan 404) agar client/log tidak mengira "belum diunggah".
			console.error("Gagal membaca user media dari storage", {
				userId,
				mediaType,
				objectKey: row.objectKey,
				reason: error instanceof Error ? error.message : "unknown",
			});
			return { unavailable: true };
		}
	} catch {
		return { missing: true };
	}
}

function userMediaFailureMessage(
	result: { missing: true } | { unavailable: true },
	kindLabel: string,
): { status: number; error: string } {
	if ("missing" in result)
		return { status: 404, error: `${kindLabel} tidak ditemukan.` };
	return {
		status: 502,
		error: `${kindLabel} tidak dapat dibaca dari penyimpanan.`,
	};
}

export const authRoutes = new Elysia({ name: "auth-routes" })
	.get("/api/auth/providers", () => ({
		providers: getActiveOAuthProviders(ENV),
	}))
	.get("/api/auth/profile", async ({ request, set }) => {
		const session = await getActiveSession(request.headers);
		if (!session) {
			set.status = 401;
			return { error: "unauthorized" };
		}
		const [profile] = await db
			.select({
				id: authUser.id,
				name: authUser.name,
				email: authUser.email,
				image: authUser.image,
				headerImage: authUser.headerImage,
				username: authUser.username,
				phone: authUser.phone,
			})
			.from(authUser)
			.where(eq(authUser.id, session.user.id))
			.limit(1);
		if (!profile) {
			set.status = 401;
			return { error: "unauthorized" };
		}
		const roles = await userRoleKeys(db, session.user.id);
		const admin = roles.includes("admin");
		return {
			user: {
				...profile,
				role: admin ? ("admin" as const) : ("user" as const),
				isAdmin: admin,
			},
		};
	})
	.patch(
		"/api/auth/profile",
		async ({ body, request, set }) => {
			const session = await getActiveSession(request.headers);
			if (!session) {
				set.status = 401;
				return { error: "unauthorized" };
			}

			const updates: Partial<typeof authUser.$inferInsert> = {
				updatedAt: new Date(),
			};
			if (body.name !== undefined) {
				const name = body.name.trim();
				if (!name || hasControlCharacters(name)) {
					set.status = 400;
					return { error: "invalid_profile" };
				}
				updates.name = name;
			}
			if (body.image !== undefined) {
				const image = normalizeImageValue(body.image);
				if (image === false) {
					set.status = 400;
					return { error: "invalid_profile" };
				}
				updates.image = image;
			}
			if (body.headerImage !== undefined) {
				const image = normalizeImageValue(body.headerImage);
				if (image === false) {
					set.status = 400;
					return { error: "invalid_profile" };
				}
				updates.headerImage = image;
			}
			if (body.username !== undefined) {
				updates.username = body.username?.trim().toLowerCase() || null;
			}
			if (body.phone !== undefined) {
				updates.phone = body.phone?.trim() || null;
			}

			try {
				const [profile] = await db
					.update(authUser)
					.set(updates)
					.where(eq(authUser.id, session.user.id))
					.returning({
						id: authUser.id,
						name: authUser.name,
						email: authUser.email,
						image: authUser.image,
						headerImage: authUser.headerImage,
						username: authUser.username,
						phone: authUser.phone,
					});
				if (!profile) {
					set.status = 401;
					return { error: "unauthorized" };
				}
				const roles = await userRoleKeys(db, session.user.id);
				const admin = roles.includes("admin");
				return {
					user: {
						...profile,
						role: admin ? ("admin" as const) : ("user" as const),
						isAdmin: admin,
					},
				};
			} catch (error) {
				if (isUniqueConstraintError(error)) {
					set.status = 409;
					return { error: "username_taken" };
				}
				throw error;
			}
		},
		{ body: profilePatchSchema },
	)
	// Upload + sajian foto/banner profil milik sendiri (userId dari sesi,
	// BUKAN dari body). Didaftarkan sebelum catch-all better-auth di bawah.
	.post(
		"/api/auth/media/avatar",
		async ({ request, set }) => {
			const result = await uploadUserMedia(request, "avatar");
			set.status = result.status;
			return result.body;
		},
		{ parse: "none" },
	)
	.post(
		"/api/auth/media/header",
		async ({ request, set }) => {
			const result = await uploadUserMedia(request, "header");
			set.status = result.status;
			return result.body;
		},
		{ parse: "none" },
	)
	// Disajikan via proxy (bucket privat) mengikuti pola
	// `/api/v1/super-komik/media/*`: URL relatif tersimpan di user.image /
	// user.headerImage sehingga lolos validasi profil + bisa dicache browser
	// tanpa kredensial S3. `private, no-store` agar foto baru langsung
	// terlihat setelah upload ulang (URL stabil per pengguna).
	.get(
		"/api/auth/media/avatar/:userId",
		async ({ params, set }) => {
			const asset = await serveUserMedia(params.userId, "profile_avatar");
			if (!("bytes" in asset)) {
				const failure = userMediaFailureMessage(asset, "Foto profil");
				set.status = failure.status;
				return { error: failure.error };
			}
			set.headers["content-type"] = asset.contentType;
			set.headers["cache-control"] = "private, no-store";
			return new Response(asset.bytes);
		},
		{ params: t.Object({ userId: t.String() }) },
	)
	.get(
		"/api/auth/media/header/:userId",
		async ({ params, set }) => {
			const asset = await serveUserMedia(params.userId, "profile_header");
			if (!("bytes" in asset)) {
				const failure = userMediaFailureMessage(asset, "Banner profil");
				set.status = failure.status;
				return { error: failure.error };
			}
			set.headers["content-type"] = asset.contentType;
			set.headers["cache-control"] = "private, no-store";
			return new Response(asset.bytes);
		},
		{ params: t.Object({ userId: t.String() }) },
	)
	.all(
		"/api/auth",
		async ({ request, status }) => {
			if (!["GET", "POST"].includes(request.method)) return status(405);
			return handleAuthRequest(request);
		},
		{ parse: "none" },
	)
	// Sesi milik sendiri (tanpa permission baru): daftar + cabut per sesi.
	// better-auth bawaan memakai token di body; padanan ini memakai id sesi
	// dari DB agar token httpOnly tidak perlu diekspos ke client.
	.get("/api/auth/sessions", async ({ request, set }) => {
		const session = await getActiveSession(request.headers);
		if (!session) {
			set.status = 401;
			return { error: "unauthorized" };
		}
		const rows = await db
			.select({
				id: authSession.id,
				userAgent: authSession.userAgent,
				ipAddress: authSession.ipAddress,
				createdAt: authSession.createdAt,
				updatedAt: authSession.updatedAt,
				expiresAt: authSession.expiresAt,
			})
			.from(authSession)
			.where(eq(authSession.userId, session.user.id))
			.orderBy(desc(authSession.createdAt));
		return {
			sessions: rows.map((row) => ({
				...row,
				current: row.id === session.session.id,
			})),
		};
	})
	.post(
		"/api/auth/sessions/revoke",
		async ({ body, request, set }) => {
			const session = await getActiveSession(request.headers);
			if (!session) {
				set.status = 401;
				return { error: "unauthorized" };
			}
			if (!body.sessionId || body.sessionId === session.session.id) {
				set.status = 400;
				return { error: "cannot_revoke_current" };
			}
			const [row] = await db
				.select({ id: authSession.id })
				.from(authSession)
				.where(
					and(
						eq(authSession.id, body.sessionId),
						eq(authSession.userId, session.user.id),
					),
				)
				.limit(1);
			if (!row) {
				set.status = 404;
				return { error: "session_not_found" };
			}
			await db.delete(authSession).where(eq(authSession.id, body.sessionId));
			return { revoked: true };
		},
		{ body: t.Object({ sessionId: t.String({ minLength: 1 }) }) },
	)
	.all(
		"/api/auth/*",
		async ({ request, status }) => {
			if (!["GET", "POST"].includes(request.method)) return status(405);
			return handleAuthRequest(request);
		},
		{ parse: "none" },
	);
