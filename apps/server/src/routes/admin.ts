import { user } from "@SyMi/db/schema/auth";
import { mediaAssets, userMedia } from "@SyMi/db/schema/index";
import { createHash } from "node:crypto";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { userAvatarObjectKey, userHeaderObjectKey } from "../media/object-keys";
import { deleteUserMediaBlob } from "../media/user-media";
import { resolvePrincipalId } from "../rbac/gates";
import {
	builtInPermissions,
	builtInRoles,
	hasPermission,
	userRoleKeys,
} from "../rbac/permissions";
import { auth, db } from "../services";
import { putObject } from "../storage/s3";

async function requirePermission(
	request: Request,
	permissionKey: string,
): Promise<{ userId: string } | { error: string; status: 401 | 403 }> {
	const userId = await resolvePrincipalId(auth, request);
	if (!userId) return { error: "Autentikasi diperlukan", status: 401 };
	if (!(await hasPermission(db, userId, permissionKey)))
		return { error: `Izin "${permissionKey}" diperlukan`, status: 403 };
	return { userId };
}

async function adminCount(excludeUserId?: string) {
	const rows = await db.$client.query(
		excludeUserId
			? "SELECT COUNT(*)::int AS total FROM rbac_user_roles WHERE role_key = 'admin' AND user_id <> $1"
			: "SELECT COUNT(*)::int AS total FROM rbac_user_roles WHERE role_key = 'admin'",
		excludeUserId ? [excludeUserId] : [],
	);
	return Number((rows.rows[0] as { total?: number })?.total ?? 0);
}

// --- Edit data pengguna (lane admin) ---------------------------------------
// Email sengaja read-only: better-auth mengelola pergantian email lewat alur
// verifikasi (`changeEmail` + token); update langsung di DB akan membuat
// `email` dan `emailVerified` tidak konsisten dan bisa mengunci pengguna.
// Nama, avatar, dan banner aman diubah langsung karena kolom milik sendiri.

function hasControlCharacters(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 0x20 || codePoint === 0x7f;
	});
}

function normalizeAdminImageValue(value: string | null): string | null | false {
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
		// Alamat non-HTTP ditolak di bawah.
	}
	return false;
}

const ADMIN_USER_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ADMIN_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const ADMIN_HEADER_MAX_BYTES = 5 * 1024 * 1024;

type AdminUserMediaKind = "avatar" | "header";

async function clearUserMediaFor(
	targetUserId: string,
	mediaType: "profile_avatar" | "profile_header",
): Promise<void> {
	try {
		const [existing] = await db
			.select({ objectKey: userMedia.objectKey })
			.from(userMedia)
			.where(
				and(
					eq(userMedia.ownerUserId, targetUserId),
					eq(userMedia.mediaType, mediaType),
					eq(userMedia.ownerId, targetUserId),
				),
			)
			.limit(1);
		if (!existing) return;
		await db
			.delete(userMedia)
			.where(
				and(
					eq(userMedia.ownerUserId, targetUserId),
					eq(userMedia.mediaType, mediaType),
					eq(userMedia.ownerId, targetUserId),
				),
			);
		await deleteUserMediaBlob(existing.objectKey);
	} catch {
		// Best-effort: kolom user sudah dinull-kan oleh caller.
	}
}

/**
 * Unggah avatar/header untuk pengguna LAIN (oleh admin). Mirror dari
 * `uploadUserMedia` di `routes/auth.ts` — bedanya `ownerUserId`/`ownerId`
 * adalah target, bukan sesi. Validasi mime + ukuran identik.
 */
async function uploadUserMediaFor(
	targetUserId: string,
	kind: AdminUserMediaKind,
	request: Request,
): Promise<{ status: number; body: unknown }> {
	const maxBytes =
		kind === "avatar" ? ADMIN_AVATAR_MAX_BYTES : ADMIN_HEADER_MAX_BYTES;
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
	if (!ADMIN_USER_MEDIA_MIME_TYPES.includes(contentType)) {
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
			? userAvatarObjectKey(targetUserId, contentType)
			: userHeaderObjectKey(targetUserId, contentType);
	const sha256 = createHash("sha256").update(bytes).digest("hex");

	try {
		await putObject(objectKey, bytes, contentType);
	} catch (error) {
		console.error("Upload user media oleh admin ke storage gagal", {
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
					eq(userMedia.ownerUserId, targetUserId),
					eq(userMedia.mediaType, mediaType),
					eq(userMedia.ownerId, targetUserId),
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
				ownerUserId: targetUserId,
				mediaType,
				ownerId: targetUserId,
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
		console.error("Upsert user_media oleh admin gagal", {
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

	const url = `/api/auth/media/${kind}/${encodeURIComponent(targetUserId)}`;
	try {
		await db
			.update(user)
			.set({
				...(kind === "avatar" ? { image: url } : { headerImage: url }),
				updatedAt: new Date(),
			})
			.where(eq(user.id, targetUserId));
	} catch (error) {
		console.error("Update foto pengguna oleh admin gagal", {
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

export const adminRoutes = new Elysia({ name: "admin-routes" })
	.get(
		"/api/admin/users",
		async ({ query, request, set }) => {
			const gate = await requirePermission(request, "users.read");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
			const offset = Math.max(query.offset ?? 0, 0);
			const where = query.search
				? or(
						ilike(user.email, `%${query.search}%`),
						ilike(user.name, `%${query.search}%`),
					)
				: undefined;
			const rows = await db
				.select()
				.from(user)
				.where(where)
				.orderBy(desc(user.createdAt))
				.limit(limit)
				.offset(offset);
			const total = await db.select({ total: count() }).from(user).where(where);
			// Aktivitas terakhir: sesi terbaru per pengguna dari tabel `session`
			// (MAX(updated_at); nullila belum ada sesi). `updated_at` hanya
			// berubah bila baris sesi ditulis ulang, jadi ini perkiraan
			// "terakhir terlihat", bukan heartbeat presisi.
			const lastActive = new Map<string, string>();
			if (rows.length > 0) {
				try {
					const ids = rows.map((row) => row.id);
					const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
					const activity = await db.$client.query(
						`SELECT user_id, MAX(updated_at) AS last_active FROM "session" WHERE user_id IN (${placeholders}) GROUP BY user_id`,
						ids,
					);
					for (const activityRow of activity.rows as Array<{
						user_id?: unknown;
						last_active?: unknown;
					}>) {
						if (
							typeof activityRow.user_id !== "string" ||
							!activityRow.last_active
						)
							continue;
						const at = new Date(activityRow.last_active as string | Date);
						if (!Number.isNaN(at.valueOf()))
							lastActive.set(activityRow.user_id, at.toISOString());
					}
				} catch {
					// Best-effort: tabel session mungkin belum termigrasi.
				}
			}
			const users = await Promise.all(
				rows.map(async (row) => ({
					id: row.id,
					name: row.name,
					email: row.email,
					emailVerified: row.emailVerified,
					image: row.image,
					headerImage: row.headerImage,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
					roles: await userRoleKeys(db, row.id),
					lastActiveAt: lastActive.get(row.id) ?? null,
				})),
			);
			return { users, total: total[0]?.total ?? 0, limit, offset };
		},
		{
			query: t.Object({
				search: t.Optional(t.String()),
				limit: t.Optional(t.Number()),
				offset: t.Optional(t.Number()),
			}),
		},
	)
	.get(
		"/api/admin/users/:id",
		async ({ params, request, set }) => {
			const gate = await requirePermission(request, "users.read");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			const rows = await db
				.select()
				.from(user)
				.where(eq(user.id, params.id))
				.limit(1);
			if (!rows[0]) {
				set.status = 404;
				return { error: "Pengguna tidak ditemukan" };
			}
			return { ...rows[0], roles: await userRoleKeys(db, params.id) };
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.patch(
		"/api/admin/users/:id/role",
		async ({ params, body, request, set }) => {
			const gate = await requirePermission(request, "users.manage");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			const rows = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.id, params.id))
				.limit(1);
			if (!rows[0]) {
				set.status = 404;
				return { error: "Pengguna tidak ditemukan" };
			}
			if (gate.userId === params.id && body.role !== "admin") {
				set.status = 409;
				return { error: "Anda tidak dapat mencabut peran admin sendiri" };
			}
			if (body.role === "admin") {
				await db.$client.query(
					"INSERT INTO rbac_user_roles (user_id, role_key) VALUES ($1, 'admin') ON CONFLICT DO NOTHING",
					[params.id],
				);
			} else {
				if ((await adminCount(params.id)) === 0) {
					set.status = 409;
					return {
						error: "Administrator terakhir tidak dapat diturunkan perannya",
					};
				}
				await db.$client.query(
					"DELETE FROM rbac_user_roles WHERE user_id = $1 AND role_key = 'admin'",
					[params.id],
				);
			}
			return { id: params.id, roles: await userRoleKeys(db, params.id) };
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				role: t.Union([t.Literal("admin"), t.Literal("user")]),
			}),
		},
	)
	.patch(
		"/api/admin/users/:id",
		async ({ params, body, request, set }) => {
			const gate = await requirePermission(request, "users.manage");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			const existing = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.id, params.id))
				.limit(1);
			if (!existing[0]) {
				set.status = 404;
				return { error: "Pengguna tidak ditemukan" };
			}
			const patch: Partial<typeof user.$inferInsert> = {
				updatedAt: new Date(),
			};
			if (body.name !== undefined) {
				const name = body.name.trim();
				if (!name || name.length > 120 || hasControlCharacters(name)) {
					set.status = 400;
					return { error: "Nama tidak valid" };
				}
				patch.name = name;
			}
			if (body.image !== undefined) {
				const image = normalizeAdminImageValue(body.image);
				if (image === false) {
					set.status = 400;
					return { error: "URL foto profil tidak valid" };
				}
				patch.image = image;
				if (image === null)
					await clearUserMediaFor(params.id, "profile_avatar");
			}
			if (body.headerImage !== undefined) {
				const headerImage = normalizeAdminImageValue(body.headerImage);
				if (headerImage === false) {
					set.status = 400;
					return { error: "URL banner tidak valid" };
				}
				patch.headerImage = headerImage;
				if (headerImage === null)
					await clearUserMediaFor(params.id, "profile_header");
			}
			const [updated] = await db
				.update(user)
				.set(patch)
				.where(eq(user.id, params.id))
				.returning({
					id: user.id,
					name: user.name,
					email: user.email,
					emailVerified: user.emailVerified,
					image: user.image,
					headerImage: user.headerImage,
					createdAt: user.createdAt,
					updatedAt: user.updatedAt,
				});
			if (!updated) {
				set.status = 404;
				return { error: "Pengguna tidak ditemukan" };
			}
			return { ...updated, roles: await userRoleKeys(db, params.id) };
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object(
				{
					name: t.Optional(t.String({ maxLength: 120 })),
					image: t.Optional(t.Union([t.String({ maxLength: 2048 }), t.Null()])),
					headerImage: t.Optional(
						t.Union([t.String({ maxLength: 2048 }), t.Null()]),
					),
				},
				{ minProperties: 1 },
			),
		},
	)
	.post(
		"/api/admin/users/:id/avatar",
		async ({ params, request, set }) => {
			const gate = await requirePermission(request, "users.manage");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			const target = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.id, params.id))
				.limit(1);
			if (!target[0]) {
				set.status = 404;
				return { error: "Pengguna tidak ditemukan" };
			}
			const result = await uploadUserMediaFor(params.id, "avatar", request);
			set.status = result.status;
			return result.body;
		},
		{ params: t.Object({ id: t.String() }), parse: "none" },
	)
	.post(
		"/api/admin/users/:id/header",
		async ({ params, request, set }) => {
			const gate = await requirePermission(request, "users.manage");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			const target = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.id, params.id))
				.limit(1);
			if (!target[0]) {
				set.status = 404;
				return { error: "Pengguna tidak ditemukan" };
			}
			const result = await uploadUserMediaFor(params.id, "header", request);
			set.status = result.status;
			return result.body;
		},
		{ params: t.Object({ id: t.String() }), parse: "none" },
	)
	.delete(
		"/api/admin/users/:id/sessions",
		async ({ params, request, set }) => {
			const gate = await requirePermission(request, "users.manage");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			// Tanpa kolom penangguhan di skema auth, pencabutan semua sesi adalah
			// mekanisme penangguhan: pengguna dipaksa keluar dari semua perangkat.
			await db.$client.query('DELETE FROM "session" WHERE user_id = $1', [
				params.id,
			]);
			return { id: params.id, revoked: true };
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.delete(
		"/api/admin/users/:id",
		async ({ params, request, set }) => {
			const gate = await requirePermission(request, "users.manage");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			if (gate.userId === params.id) {
				set.status = 409;
				return { error: "Anda tidak dapat menghapus akun sendiri" };
			}
			const rows = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.id, params.id))
				.limit(1);
			if (!rows[0]) {
				set.status = 404;
				return { error: "Pengguna tidak ditemukan" };
			}
			const targetRoles = await userRoleKeys(db, params.id);
			if (
				targetRoles.includes("admin") &&
				(await adminCount(params.id)) === 0
			) {
				set.status = 409;
				return { error: "Administrator terakhir tidak dapat dihapus" };
			}
			await db.$client.query('DELETE FROM "session" WHERE user_id = $1', [
				params.id,
			]);
			await db.$client.query("DELETE FROM rbac_user_roles WHERE user_id = $1", [
				params.id,
			]);
			await db.delete(user).where(eq(user.id, params.id));
			return { id: params.id, deleted: true };
		},
		{ params: t.Object({ id: t.String() }) },
	)
	.get("/api/admin/roles", async ({ request, set }) => {
		const gate = await requirePermission(request, "rbac.roles.read");
		if ("error" in gate) {
			set.status = gate.status;
			return { error: gate.error };
		}
		// Baca dari tabel (seed memastikan built-in ada): label/deskripsi hasil
		// edit admin ikut terbaca tanpa tabel override tambahan.
		try {
			const [roleRows, grantRows, permissionRows, memberRows] =
				await Promise.all([
					db.$client.query(
						"SELECT key, label, description FROM rbac_roles ORDER BY key",
					),
					db.$client.query(
						"SELECT role_key, permission_key FROM rbac_role_permissions",
					),
					db.$client.query(
						"SELECT key, label FROM rbac_permissions ORDER BY key",
					),
					db.$client.query(
						"SELECT role_key, COUNT(*)::int AS total FROM rbac_user_roles GROUP BY role_key",
					),
				]);
			const permissionLabel = new Map(
				(permissionRows.rows as Array<{ key?: unknown; label?: unknown }>).map(
					(row) => [String(row.key), String(row.label ?? row.key)],
				),
			);
			const grants = new Map<string, string[]>();
			for (const row of grantRows.rows as Array<{
				role_key?: unknown;
				permission_key?: unknown;
			}>) {
				const roleKey = String(row.role_key);
				const list = grants.get(roleKey) ?? [];
				list.push(String(row.permission_key));
				grants.set(roleKey, list);
			}
			const counts = new Map(
				(memberRows.rows as Array<{ role_key?: unknown; total?: unknown }>).map(
					(row) => [String(row.role_key), Number(row.total ?? 0)],
				),
			);
			return {
				roles: (
					roleRows.rows as Array<{
						key?: unknown;
						label?: unknown;
						description?: unknown;
					}>
				).map((row) => {
					const key = String(row.key);
					const permissionKeys = grants.get(key) ?? [];
					return {
						key,
						label: String(row.label ?? key),
						description:
							typeof row.description === "string" ? row.description : null,
						members: counts.get(key) ?? 0,
						permissions: permissionKeys.sort().map((permissionKey) => ({
							key: permissionKey,
							label: permissionLabel.get(permissionKey) ?? permissionKey,
						})),
					};
				}),
			};
		} catch {
			// Fallback bila tabel RBAC belum termigrasi: kontrak lama.
			const members = await db.$client
				.query(
					"SELECT role_key, COUNT(*)::int AS total FROM rbac_user_roles GROUP BY role_key",
				)
				.catch(() => ({ rows: [] as unknown[] }));
			const counts = new Map(
				(members.rows as Array<{ role_key: string; total: number }>).map(
					(row) => [row.role_key, row.total],
				),
			);
			return {
				roles: builtInRoles.map((role) => ({
					...role,
					members: counts.get(role.key) ?? 0,
				})),
			};
		}
	})
	.patch(
		"/api/admin/roles/:key",
		async ({ params, body, request, set }) => {
			const gate = await requirePermission(request, "rbac.roles.manage");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			const key = params.key;
			const existing = await db.$client.query(
				"SELECT key FROM rbac_roles WHERE key = $1",
				[key],
			);
			if (existing.rows.length === 0) {
				set.status = 404;
				return { error: "Role tidak ditemukan" };
			}
			let label: string | undefined;
			if (body.label !== undefined) {
				label = body.label.trim();
				if (!label || label.length > 120) {
					set.status = 400;
					return { error: "Label role tidak valid" };
				}
			}
			const description =
				body.description === undefined
					? undefined
					: body.description === null || !body.description.trim()
						? null
						: body.description.trim().slice(0, 500);
			let permissionKeys: string[] | undefined;
			if (body.permissions !== undefined) {
				permissionKeys = [
					...new Set(body.permissions.map((p) => p.trim())),
				].filter((p) => p.length > 0);
				if (permissionKeys.length > 0) {
					const placeholders = permissionKeys
						.map((_, i) => `$${i + 1}`)
						.join(", ");
					const found = await db.$client.query(
						`SELECT key FROM rbac_permissions WHERE key IN (${placeholders})`,
						permissionKeys,
					);
					if (found.rows.length !== permissionKeys.length) {
						set.status = 400;
						return { error: "Ada permission yang tidak dikenal" };
					}
				}
			}
			if (label !== undefined || description !== undefined) {
				const sets: string[] = ["updated_at = NOW()"];
				const values: Array<string | null> = [key];
				if (label !== undefined) {
					sets.push(`label = $${values.length + 1}`);
					values.push(label);
				}
				if (description !== undefined) {
					sets.push(`description = $${values.length + 1}`);
					values.push(description);
				}
				try {
					await db.$client.query(
						`UPDATE rbac_roles SET ${sets.join(", ")} WHERE key = $1`,
						values,
					);
				} catch (error) {
					if (
						error instanceof Error &&
						/unique|constraint/i.test(error.message)
					) {
						set.status = 409;
						return { error: "Label role sudah dipakai role lain" };
					}
					throw error;
				}
			}
			if (permissionKeys !== undefined) {
				await db.$client.query(
					"DELETE FROM rbac_role_permissions WHERE role_key = $1",
					[key],
				);
				for (const permissionKey of permissionKeys) {
					await db.$client.query(
						"INSERT INTO rbac_role_permissions (role_key, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
						[key, permissionKey],
					);
				}
			}
			const [roleRow, grantRows] = await Promise.all([
				db.$client.query(
					"SELECT key, label, description FROM rbac_roles WHERE key = $1",
					[key],
				),
				db.$client.query(
					`SELECT grant_row.permission_key AS permission_key, perm.label AS label
					 FROM rbac_role_permissions AS grant_row
					 LEFT JOIN rbac_permissions AS perm ON perm.key = grant_row.permission_key
					 WHERE grant_row.role_key = $1 ORDER BY grant_row.permission_key`,
					[key],
				),
			]);
			const row = roleRow.rows[0] as
				| { key?: unknown; label?: unknown; description?: unknown }
				| undefined;
			if (!row) {
				set.status = 404;
				return { error: "Role tidak ditemukan" };
			}
			return {
				key: String(row.key),
				label: String(row.label ?? key),
				description:
					typeof row.description === "string" ? row.description : null,
				permissions: (
					grantRows.rows as Array<{ permission_key?: unknown; label?: unknown }>
				).map((grant) => ({
					key: String(grant.permission_key),
					label: String(grant.label ?? grant.permission_key),
				})),
			};
		},
		{
			params: t.Object({ key: t.String({ minLength: 1 }) }),
			body: t.Object({
				label: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
				description: t.Optional(
					t.Union([t.String({ maxLength: 500 }), t.Null()]),
				),
				permissions: t.Optional(t.Array(t.String({ minLength: 1 }))),
			}),
		},
	)
	.get("/api/admin/permissions", async ({ request, set }) => {
		const gate = await requirePermission(request, "rbac.permissions.read");
		if ("error" in gate) {
			set.status = gate.status;
			return { error: gate.error };
		}
		return { permissions: builtInPermissions };
	})
	.get(
		"/api/admin/media",
		async ({ query, request, set }) => {
			const gate = await requirePermission(request, "media.read");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
			const offset = Math.max(query.offset ?? 0, 0);
			const conditions = [];
			if (query.assetType)
				conditions.push(eq(mediaAssets.assetType, query.assetType));
			if (query.status)
				conditions.push(eq(mediaAssets.downloadStatus, query.status));
			if (query.ownerId)
				conditions.push(eq(mediaAssets.ownerId, query.ownerId));
			const rows = await db
				.select()
				.from(mediaAssets)
				.where(conditions.length > 0 ? and(...conditions) : undefined)
				.orderBy(desc(mediaAssets.updatedAt))
				.limit(limit)
				.offset(offset);
			const total = await db
				.select({ total: count() })
				.from(mediaAssets)
				.where(conditions.length > 0 ? and(...conditions) : undefined);
			return { assets: rows, total: total[0]?.total ?? 0, limit, offset };
		},
		{
			query: t.Object({
				assetType: t.Optional(t.String()),
				status: t.Optional(t.String()),
				ownerId: t.Optional(t.String()),
				limit: t.Optional(t.Number()),
				offset: t.Optional(t.Number()),
			}),
		},
	)
	.patch(
		"/api/admin/media/:id/requeue",
		async ({ params, request, set }) => {
			const gate = await requirePermission(request, "media.manage");
			if ("error" in gate) {
				set.status = gate.status;
				return { error: gate.error };
			}
			const rows = await db
				.update(mediaAssets)
				.set({
					downloadStatus: "remote",
					integrityStatus: "unchecked",
					lastError: null,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(mediaAssets.id, params.id),
						or(
							eq(mediaAssets.downloadStatus, "failed"),
							eq(mediaAssets.downloadStatus, "remote"),
						),
					),
				)
				.returning();
			if (!rows[0]) {
				set.status = 404;
				return {
					error: "Aset media tidak ditemukan atau tidak dapat diantre ulang",
				};
			}
			return rows[0];
		},
		{ params: t.Object({ id: t.String() }) },
	);
