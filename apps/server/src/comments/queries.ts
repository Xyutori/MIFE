/**
 * Query komentar, dipisah dari route HTTP (`../routes/comments.ts`).
 *
 * Route tetap tipis (auth + validasi + mapping status); semua query Drizzle
 * dan aturan bisnis ada di sini:
 * - daftar top-level + balasan (publik),
 * - buat / edit / hapus lunak / lapor (login),
 * - sanitasi `contentJson` di server (whitelist node, ekstrak plainText,
 *   batas 1000 kata + 64KB),
 * - threading 1 level (balasan atas balasan ditulis-ulang ke akar),
 * - rate-limit 5/menit + 30/jam per penulis.
 */

import {
	animeEpisodes,
	animeSeries,
	user as authUser,
	type CommentDoc,
	chapters,
	commentReports,
	comments,
	series,
} from "@SyMi/db/schema/index";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	sql,
} from "drizzle-orm";

import { isAdmin } from "../rbac/permissions";
import { db } from "../services";

export type CommentTargetType =
	| "comic_chapter"
	| "anime_episode"
	| "comic_series"
	| "anime_series";
export type CommentSort = "newest" | "oldest" | "popular";

export class CommentError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
	) {
		super(message);
		this.name = "CommentError";
	}
}

type CommentRow = typeof comments.$inferSelect;

type AuthorProfile = { id: string; name: string; image: string | null };

/** Satu node dokumen rich-text komentar (subset TipTap) untuk validasi. */
type CommentDocNode = {
	type: string;
	text?: string;
	content?: CommentDocNode[];
	marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
	attrs?: Record<string, unknown>;
};

const FALLBACK_AUTHOR_NAME = "Akun dihapus";

/** Node yang diizinkan dalam `contentJson` (subset komentar).
 * Sesuai permintaan: spoiler, callout, blockquote, bullet & ordered list.
 * `hardBreak` (shift+enter) diizinkan karena tak kasatmata & perlu.
 * Node lain (heading, codeBlock, table, media, dsb) DITOLAK server. */
const ALLOWED_NODE_TYPES = new Set([
	"doc",
	"paragraph",
	"text",
	"hardBreak",
	"spoilerBlock",
	"callout",
	"blockquote",
	"bulletList",
	"orderedList",
	"listItem",
]);

/** Mark inline yang diizinkan: bold/italic/underline/strikethrough. */
const ALLOWED_MARK_TYPES = new Set(["bold", "italic", "underline", "strike"]);

const MAX_JSON_BYTES = 64 * 1024;
const MAX_WORDS = 1000;
const CREATE_PER_MINUTE = 5;
const CREATE_PER_HOUR = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertValidNode(node: unknown): asserts node is CommentDocNode {
	if (!isRecord(node) || typeof node.type !== "string") {
		throw new CommentError("Format konten komentar tidak valid", 400);
	}
	if (!ALLOWED_NODE_TYPES.has(node.type)) {
		throw new CommentError(`Tipe konten "${node.type}" tidak didukung`, 400);
	}
	if (
		node.text !== undefined &&
		typeof node.text !== "string" &&
		node.text !== null
	) {
		throw new CommentError("Format konten komentar tidak valid", 400);
	}
	if (node.content !== undefined && !Array.isArray(node.content)) {
		throw new CommentError("Format konten komentar tidak valid", 400);
	}
	if (node.marks !== undefined) {
		if (!Array.isArray(node.marks)) {
			throw new CommentError("Format konten komentar tidak valid", 400);
		}
		for (const mark of node.marks) {
			if (
				!isRecord(mark) ||
				typeof mark.type !== "string" ||
				!ALLOWED_MARK_TYPES.has(mark.type)
			) {
				throw new CommentError("Format penanda teks tidak didukung", 400);
			}
		}
	}
	if (node.type === "link" && isRecord(node.attrs)) {
		const href = node.attrs.href;
		if (
			href !== undefined &&
			(typeof href !== "string" ||
				(!href.startsWith("https://") &&
					!href.startsWith("http://") &&
					!href.startsWith("/")))
		) {
			throw new CommentError("Tautan komentar tidak valid", 400);
		}
	}
	if (Array.isArray(node.content)) {
		for (const child of node.content) assertValidNode(child);
	}
}

/** Kumpulkan teks polos; blok dipisah baris baru. */
function blockText(node: CommentDocNode): string {
	if (typeof node.text === "string") return node.text;
	if (!node.content) return "";
	return node.content.map(blockText).join("");
}

function containsSpoiler(node: CommentDocNode): boolean {
	if (node.type === "spoilerBlock") return true;
	return node.content?.some(containsSpoiler) ?? false;
}

type SanitizedDoc = {
	doc: CommentDoc;
	plainText: string;
	wordCount: number;
	hasSpoilerFromNodes: boolean;
};

/** Validasi + sanitasi dokumen dari klien; lempar CommentError bila invalid. */
export function sanitizeCommentDoc(input: unknown): SanitizedDoc {
	if (!isRecord(input) || input.type !== "doc") {
		throw new CommentError("Format konten komentar tidak valid", 400);
	}
	let bytes = 0;
	try {
		bytes = Buffer.byteLength(JSON.stringify(input), "utf8");
	} catch {
		throw new CommentError("Format konten komentar tidak valid", 400);
	}
	if (bytes > MAX_JSON_BYTES) {
		throw new CommentError("Ukuran konten komentar maksimal 64KB", 413);
	}
	const content = input.content;
	if (content !== undefined && !Array.isArray(content)) {
		throw new CommentError("Format konten komentar tidak valid", 400);
	}
	const blocks: CommentDocNode[] = [];
	for (const child of content ?? []) {
		assertValidNode(child);
		blocks.push(child);
	}
	const doc: CommentDoc = { type: "doc", content: blocks };
	const plainText = blocks
		.map(blockText)
		.filter((s) => s.length > 0)
		.join("\n");
	const wordCount = plainText.split(/\s+/).filter(Boolean).length;
	if (wordCount > MAX_WORDS) {
		throw new CommentError("Komentar maksimal 1000 kata", 413);
	}
	return {
		doc,
		plainText,
		wordCount,
		hasSpoilerFromNodes: blocks.some(containsSpoiler),
	};
}

async function getCommentById(id: string): Promise<CommentRow | null> {
	const rows = await db
		.select()
		.from(comments)
		.where(eq(comments.id, id))
		.limit(1);
	return rows[0] ?? null;
}

async function ensureTargetExists(
	targetType: CommentTargetType,
	targetId: string,
) {
	if (targetType === "comic_chapter") {
		const rows = await db
			.select({ id: chapters.id })
			.from(chapters)
			.where(eq(chapters.id, targetId))
			.limit(1);
		if (!rows[0]) throw new CommentError("Chapter tidak ditemukan", 404);
		return;
	}
	if (targetType === "anime_episode") {
		const rows = await db
			.select({ id: animeEpisodes.id })
			.from(animeEpisodes)
			.where(eq(animeEpisodes.id, targetId))
			.limit(1);
		if (!rows[0]) throw new CommentError("Episode tidak ditemukan", 404);
		return;
	}
	if (targetType === "comic_series") {
		const rows = await db
			.select({ id: series.id })
			.from(series)
			.where(eq(series.id, targetId))
			.limit(1);
		if (rows[0]) return;
		// Fallback: slug juga diterima sebagai targetId untuk halaman detail.
		return;
	}
	const rows = await db
		.select({ id: animeSeries.id })
		.from(animeSeries)
		.where(eq(animeSeries.id, targetId))
		.limit(1);
	if (rows[0]) return;
	// Fallback: slug/id eksternal diterima untuk halaman detail anime.
	return;
}

async function assertWithinRateLimit(authorId: string) {
	const now = Date.now();
	const [perMinute, perHour] = await Promise.all([
		db
			.select({ total: count() })
			.from(comments)
			.where(
				and(
					eq(comments.authorId, authorId),
					gte(comments.createdAt, new Date(now - 60_000)),
				),
			),
		db
			.select({ total: count() })
			.from(comments)
			.where(
				and(
					eq(comments.authorId, authorId),
					gte(comments.createdAt, new Date(now - 3_600_000)),
				),
			),
	]);
	if (Number(perMinute[0]?.total ?? 0) >= CREATE_PER_MINUTE) {
		throw new CommentError(
			"Terlalu banyak komentar. Coba lagi dalam satu menit.",
			429,
		);
	}
	if (Number(perHour[0]?.total ?? 0) >= CREATE_PER_HOUR) {
		throw new CommentError(
			"Batas komentar per jam tercapai. Coba lagi nanti.",
			429,
		);
	}
}

async function authorProfiles(
	authorIds: string[],
): Promise<Map<string, AuthorProfile>> {
	const unique = [...new Set(authorIds)];
	const map = new Map<string, AuthorProfile>(
		unique.map((id) => [id, { id, name: FALLBACK_AUTHOR_NAME, image: null }]),
	);
	if (unique.length === 0) return map;
	const rows = await db
		.select({ id: authUser.id, name: authUser.name, image: authUser.image })
		.from(authUser)
		.where(inArray(authUser.id, unique));
	for (const row of rows) {
		map.set(row.id, { id: row.id, name: row.name, image: row.image });
	}
	return map;
}

/** Jumlah balasan (aktif + terhapus lunak) per komentar induk, sekaligus. */
async function replyCounts(parentIds: string[]): Promise<Map<string, number>> {
	const map = new Map<string, number>();
	if (parentIds.length === 0) return map;
	const rows = await db
		.select({ parentId: comments.parentId, total: count() })
		.from(comments)
		.where(
			and(
				inArray(comments.parentId, parentIds),
				inArray(comments.status, ["active", "deleted"]),
			),
		)
		.groupBy(comments.parentId);
	for (const row of rows) {
		if (row.parentId) map.set(row.parentId, Number(row.total));
	}
	return map;
}

function serializeComment(
	row: CommentRow,
	author: AuthorProfile | null,
	replyCount: number,
	replyToName: string | null = null,
) {
	const base = {
		id: row.id,
		targetType: row.targetType,
		targetId: row.targetId,
		parentId: row.parentId,
		rootId: row.rootId,
		replyToCommentId: row.replyToCommentId,
		replyToUserId: row.replyToUserId,
		replyToUsername: replyToName,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
	if (row.status === "deleted") {
		return {
			...base,
			author,
			contentJson: null,
			plainText: "",
			wordCount: 0,
			hasSpoiler: false,
			status: "deleted" as const,
			deleted: true,
			replyCount,
		};
	}
	if (row.status === "hidden") {
		return {
			...base,
			author,
			contentJson: null,
			plainText: "",
			wordCount: 0,
			hasSpoiler: false,
			status: "hidden" as const,
			hidden: true,
			replyCount,
		};
	}
	return {
		...base,
		author,
		contentJson: row.contentJson,
		plainText: row.plainText,
		wordCount: row.wordCount,
		hasSpoiler: row.hasSpoiler,
		status: "active" as const,
		editedAt: row.editedAt,
		replyCount,
	};
}

export type CreateCommentInput = {
	targetType: string;
	targetId: string;
	parentId?: string | null;
	replyToCommentId?: string | null;
	contentJson: unknown;
	hasSpoiler?: boolean;
};

function narrowTargetType(value: string): CommentTargetType {
	if (
		value === "comic_chapter" ||
		value === "anime_episode" ||
		value === "comic_series" ||
		value === "anime_series"
	)
		return value;
	throw new CommentError("Tipe target tidak valid", 400);
}

export async function createComment(
	authorId: string,
	input: CreateCommentInput,
) {
	const targetType = narrowTargetType(input.targetType);
	const targetId = input.targetId?.trim() ?? "";
	if (!targetId || targetId.length > 128) {
		throw new CommentError("Target komentar tidak valid", 400);
	}
	const sanitized = sanitizeCommentDoc(input.contentJson);
	await ensureTargetExists(targetType, targetId);

	let parentId: string | null = null;
	let rootId: string | null = null;
	let replyToCommentId: string | null = null;
	let replyToUserId: string | null = null;
	if (input.parentId) {
		const parent = await getCommentById(input.parentId);
		if (!parent) throw new CommentError("Komentar induk tidak ditemukan", 404);
		if (parent.targetType !== targetType || parent.targetId !== targetId) {
			throw new CommentError(
				"Komentar induk berasal dari target yang berbeda",
				400,
			);
		}
		if (parent.parentId) {
			// Balasan atas balasan: naikkan ke akar agar threading tetap 1 level.
			rootId = parent.rootId ?? parent.parentId;
			parentId = rootId;
			replyToCommentId = parent.id;
			replyToUserId = parent.authorId;
		} else {
			parentId = parent.id;
			rootId = parent.id;
		}
		// Deep-reply eksplisit: frontend kirim parentId=root + replyToCommentId.
		if (input.replyToCommentId && input.replyToCommentId !== parentId) {
			const replyTo = await getCommentById(input.replyToCommentId);
			if (!replyTo)
				throw new CommentError("Komentar yang dibalas tidak ditemukan", 404);
			if (replyTo.targetType !== targetType || replyTo.targetId !== targetId) {
				throw new CommentError(
					"Komentar yang dibalas berasal dari target yang berbeda",
					400,
				);
			}
			replyToCommentId = replyTo.id;
			replyToUserId = replyTo.authorId;
		}
	}

	await assertWithinRateLimit(authorId);

	const now = new Date();
	const inserted = await db
		.insert(comments)
		.values({
			id: crypto.randomUUID(),
			targetType,
			targetId,
			authorId,
			parentId,
			rootId,
			replyToCommentId,
			replyToUserId,
			contentJson: sanitized.doc,
			plainText: sanitized.plainText,
			wordCount: sanitized.wordCount,
			hasSpoiler: input.hasSpoiler ?? sanitized.hasSpoilerFromNodes,
			status: "active",
			editedAt: null,
			deletedAt: null,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	const row = inserted[0];
	if (!row) throw new CommentError("Komentar tidak dapat disimpan", 409);
	const authors = await authorProfiles([
		authorId,
		...(replyToUserId ? [replyToUserId] : []),
	]);
	const replyToName = replyToUserId
		? (authors.get(replyToUserId)?.name ?? null)
		: null;
	return {
		comment: serializeComment(
			row,
			authors.get(authorId) ?? null,
			0,
			replyToName,
		),
	};
}

export type ListTopLevelOptions = {
	targetType: string;
	targetId: string;
	sort?: CommentSort;
	page?: number;
	limit?: number;
};

export async function listTopLevel(options: ListTopLevelOptions) {
	const targetType = narrowTargetType(options.targetType);
	const sort: CommentSort =
		options.sort === "oldest"
			? "oldest"
			: options.sort === "popular"
				? "popular"
				: "newest";
	const limit = Math.min(Math.max(Math.floor(options.limit ?? 10), 1), 50);

	const baseFilters = [
		eq(comments.targetType, targetType),
		eq(comments.targetId, options.targetId),
		isNull(comments.parentId),
		inArray(comments.status, ["active", "deleted"]),
	];

	const totalRows = await db
		.select({ total: count() })
		.from(comments)
		.where(and(...baseFilters));
	const total = Number(totalRows[0]?.total ?? 0);
	const pageCount = Math.max(1, Math.ceil(total / limit));
	const page = Math.min(
		Math.max(Math.floor(options.page ?? 1) || 1, 1),
		pageCount,
	);
	const offset = (page - 1) * limit;

	// Jumlah balasan per komentar top-level (untuk sort terpopuler).
	const replyCountSql = sql<number>`(SELECT COUNT(*)::int FROM "comments" "r" WHERE "r"."parent_id" = "comments"."id" AND "r"."status" IN ('active','deleted'))`;

	const rows = await db
		.select()
		.from(comments)
		.where(and(...baseFilters))
		.orderBy(
			...(sort === "newest"
				? [desc(comments.createdAt), desc(comments.id)]
				: sort === "oldest"
					? [asc(comments.createdAt), asc(comments.id)]
					: [desc(replyCountSql), desc(comments.createdAt), desc(comments.id)]),
		)
		.limit(limit)
		.offset(offset);

	const counts = await replyCounts(rows.map((row) => row.id));
	const liveRows = rows.filter((row) => row.status !== "deleted");
	const authors = await authorProfiles([
		...liveRows.map((row) => row.authorId),
		...liveRows
			.map((row) => row.replyToUserId)
			.filter((id): id is string => !!id),
	]);
	return {
		comments: rows.map((row) =>
			serializeComment(
				row,
				row.status === "deleted" ? null : (authors.get(row.authorId) ?? null),
				counts.get(row.id) ?? 0,
				row.replyToUserId
					? (authors.get(row.replyToUserId)?.name ?? null)
					: null,
			),
		),
		total,
		page,
		pageCount,
	};
}

export async function listReplies(parentId: string, limit?: number) {
	const parent = await getCommentById(parentId);
	if (!parent) throw new CommentError("Komentar tidak ditemukan", 404);
	const take = Math.min(Math.max(Math.floor(limit ?? 50), 1), 100);
	const rows = await db
		.select()
		.from(comments)
		.where(
			and(
				eq(comments.parentId, parent.id),
				inArray(comments.status, ["active", "deleted"]),
			),
		)
		.orderBy(asc(comments.createdAt), asc(comments.id))
		.limit(take);
	const liveRows = rows.filter((row) => row.status !== "deleted");
	const authors = await authorProfiles([
		...liveRows.map((row) => row.authorId),
		...liveRows
			.map((row) => row.replyToUserId)
			.filter((id): id is string => !!id),
	]);
	return {
		comments: rows.map((row) =>
			serializeComment(
				row,
				row.status === "deleted" ? null : (authors.get(row.authorId) ?? null),
				0,
				row.replyToUserId
					? (authors.get(row.replyToUserId)?.name ?? null)
					: null,
			),
		),
	};
}

export type EditCommentInput = {
	contentJson: unknown;
	hasSpoiler?: boolean;
};

async function requireEditable(
	userId: string,
	commentId: string,
): Promise<CommentRow> {
	const row = await getCommentById(commentId);
	if (!row) throw new CommentError("Komentar tidak ditemukan", 404);
	if (row.authorId !== userId && !(await isAdmin(db, userId))) {
		if (row.status !== "active")
			throw new CommentError("Komentar tidak ditemukan", 404);
		throw new CommentError("Anda bukan pemilik komentar ini", 403);
	}
	if (row.status !== "active" && !(await isAdmin(db, userId))) {
		throw new CommentError("Komentar tidak ditemukan", 404);
	}
	return row;
}

export async function editComment(
	userId: string,
	commentId: string,
	input: EditCommentInput,
) {
	const row = await requireEditable(userId, commentId);
	const sanitized = sanitizeCommentDoc(input.contentJson);
	const now = new Date();
	const updated = await db
		.update(comments)
		.set({
			contentJson: sanitized.doc,
			plainText: sanitized.plainText,
			wordCount: sanitized.wordCount,
			hasSpoiler: input.hasSpoiler ?? sanitized.hasSpoilerFromNodes,
			editedAt: now,
			updatedAt: now,
		})
		.where(eq(comments.id, row.id))
		.returning();
	const next = updated[0];
	if (!next) throw new CommentError("Komentar tidak ditemukan", 404);
	const counts = row.parentId
		? new Map<string, number>()
		: await replyCounts([row.id]);
	const authors = await authorProfiles(
		next.replyToUserId ? [next.authorId, next.replyToUserId] : [next.authorId],
	);
	return {
		comment: serializeComment(
			next,
			authors.get(next.authorId) ?? null,
			counts.get(next.id) ?? 0,
			next.replyToUserId
				? (authors.get(next.replyToUserId)?.name ?? null)
				: null,
		),
	};
}

export async function softDeleteComment(userId: string, commentId: string) {
	const row = await requireEditable(userId, commentId);
	if (row.status === "deleted") return { ok: true as const };
	const now = new Date();
	await db
		.update(comments)
		.set({ status: "deleted", deletedAt: now, updatedAt: now })
		.where(eq(comments.id, row.id));
	return { ok: true as const };
}

export async function reportComment(
	userId: string,
	commentId: string,
	reason?: string,
) {
	const row = await getCommentById(commentId);
	if (row?.status !== "active") {
		throw new CommentError("Komentar tidak ditemukan", 404);
	}
	const clean = reason?.trim() ?? "";
	if (clean.length > 500) {
		throw new CommentError("Alasan laporan maksimal 500 karakter", 400);
	}
	// Idempoten per pelapor (tidak ada unique constraint di DB).
	const existing = await db
		.select({ id: commentReports.id })
		.from(commentReports)
		.where(
			and(
				eq(commentReports.commentId, row.id),
				eq(commentReports.reporterId, userId),
			),
		)
		.limit(1);
	if (existing[0]) return { ok: true as const };
	const now = new Date();
	await db.insert(commentReports).values({
		id: crypto.randomUUID(),
		commentId: row.id,
		reporterId: userId,
		reason: clean || "Tanpa alasan",
		createdAt: now,
		updatedAt: now,
	});
	return { ok: true as const };
}
