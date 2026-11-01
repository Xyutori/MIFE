import { apiBase, readJson } from "#lib/api.ts";

// TODO(backend): samakan kontrak dengan lane backend paralel.
// GET /api/v1/comments?targetType&targetId&sort&cursor&limit -> {items,nextCursor,total}
// GET /api/v1/comments/:id/replies
// POST /api/v1/comments {targetType,targetId,parentId?,replyToCommentId?,contentJson}
// PATCH / DELETE /api/v1/comments/:id ; POST /api/v1/comments/:id/report

export type CommentTargetType =
	| "comic_chapter"
	| "anime_episode"
	| "comic_series"
	| "anime_series";
export type CommentSort = "new" | "old" | "popular";

export interface CommentItem {
	id: string;
	authorId: string;
	authorName?: string | null;
	author?: { id: string; name: string; image: string | null } | null;
	parentId: string | null;
	rootId: string | null;
	replyToCommentId: string | null;
	replyToUsername?: string | null;
	contentJson?: unknown;
	plainText: string;
	hasSpoiler: boolean;
	status: "active" | "deleted" | "hidden" | string;
	deleted?: boolean;
	hidden?: boolean;
	createdAt: string;
	replyCount?: number | null;
}

export interface CommentListResponse {
	items: CommentItem[];
	total: number;
	page: number;
	pageCount: number;
}

export interface RepliesResponse {
	items: CommentItem[];
	nextCursor?: string | null;
}

function base(): string {
	// Pakai apiBase() dari lib agar origin API (bukan origin web) yang dipanggil.
	// TODO: bila base URL pindah ke env terpusat lain, ganti satu titik ini saja.
	try {
		return `${apiBase()}/api/v1/comments`;
	} catch {
		return "/api/v1/comments";
	}
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(url, { credentials: "include", ...init });
	return readJson<T>(response);
}

export async function listComments(params: {
	targetType: CommentTargetType;
	targetId: string;
	sort?: CommentSort;
	page?: number;
	limit?: number;
	signal?: AbortSignal;
}): Promise<CommentListResponse> {
	const search = new URLSearchParams({
		targetType: params.targetType,
		targetId: params.targetId,
		sort:
			params.sort === "old"
				? "oldest"
				: params.sort === "popular"
					? "popular"
					: "newest",
		page: String(params.page ?? 1),
		limit: String(params.limit ?? 10),
	});
	const payload = await request<{
		comments?: CommentItem[];
		items?: CommentItem[];
		total?: number;
		page?: number;
		pageCount?: number;
	}>(`${base()}?${search}`, { signal: params.signal });
	const items = payload.comments ?? payload.items ?? [];
	return {
		items: items.map(normalizeItem),
		total: payload.total ?? items.length,
		page: payload.page ?? params.page ?? 1,
		pageCount: payload.pageCount ?? 1,
	};
}

function normalizeItem(raw: CommentItem): CommentItem {
	const authorName =
		raw.authorName ?? (raw.author ? raw.author.name : null) ?? null;
	return { ...raw, authorName };
}

export async function listReplies(
	commentId: string,
	limit = 50,
	signal?: AbortSignal,
): Promise<CommentItem[]> {
	const payload = await request<
		RepliesResponse | CommentItem[] | { comments: CommentItem[] }
	>(`${base()}/${encodeURIComponent(commentId)}/replies?limit=${limit}`, {
		signal,
	});
	if (Array.isArray(payload)) return payload.map(normalizeItem);
	if ("comments" in payload && Array.isArray(payload.comments))
		return payload.comments.map(normalizeItem);
	const items = (payload as RepliesResponse).items ?? [];
	return items.map(normalizeItem);
}

export async function createComment(body: {
	targetType: CommentTargetType;
	targetId: string;
	parentId?: string | null;
	replyToCommentId?: string | null;
	contentJson: unknown;
	hasSpoiler?: boolean;
}): Promise<CommentItem> {
	const raw = await request<{ comment: CommentItem } | CommentItem>(base(), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			targetType: body.targetType,
			targetId: body.targetId,
			parentId: body.parentId ?? undefined,
			replyToCommentId: body.replyToCommentId ?? undefined,
			contentJson: body.contentJson,
			hasSpoiler: body.hasSpoiler ?? false,
		}),
	});
	const item =
		"comment" in raw && raw.comment ? raw.comment : (raw as CommentItem);
	return normalizeItem(item);
}

export async function updateComment(
	commentId: string,
	body: { contentJson: unknown; hasSpoiler?: boolean },
): Promise<CommentItem> {
	const raw = await request<{ comment: CommentItem } | CommentItem>(
		`${base()}/${encodeURIComponent(commentId)}`,
		{
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				contentJson: body.contentJson,
				hasSpoiler: body.hasSpoiler ?? false,
			}),
		},
	);
	const item =
		"comment" in raw && raw.comment ? raw.comment : (raw as CommentItem);
	return normalizeItem(item);
}

export async function deleteComment(commentId: string): Promise<void> {
	await request<unknown>(`${base()}/${encodeURIComponent(commentId)}`, {
		method: "DELETE",
	});
}

export async function reportComment(
	commentId: string,
	reason?: string,
): Promise<void> {
	await request<unknown>(`${base()}/${encodeURIComponent(commentId)}/report`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(reason ? { reason } : {}),
	});
}
