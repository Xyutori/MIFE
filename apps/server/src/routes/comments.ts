/**
 * Komentar: baca publik, tulis butuh login.
 *
 * Pola sama seperti `bookmarks.ts`: route tipis (auth + validasi +
 * mapping status), semua query di `../comments/queries.ts`.
 *
 * - GET    /api/v1/comments (publik, paginasi cursor)
 * - GET    /api/v1/comments/:id/replies (publik)
 * - POST   /api/v1/comments (login)
 * - PATCH  /api/v1/comments/:id (login, pemilik + admin)
 * - DELETE /api/v1/comments/:id (login, pemilik + admin, hapus lunak)
 * - POST   /api/v1/comments/:id/report (login)
 *
 * File ini TIDAK didaftarkan di `index.ts` (orchestrator yang memasang
 * `.use(commentRoutes)` setelah rekonsiliasi).
 */

import { Elysia, t } from "elysia";

import {
	CommentError,
	type CommentSort,
	createComment,
	editComment,
	listReplies,
	listTopLevel,
	reportComment,
	softDeleteComment,
} from "../comments/queries";
import { auth } from "../services";

async function resolveUserId(request: Request): Promise<string | null> {
	try {
		const session = await auth.api.getSession({ headers: request.headers });
		const id = session?.user?.id;
		return typeof id === "string" && id.length > 0 ? id : null;
	} catch {
		return null;
	}
}

type HandlerContext = {
	request: Request;
	set: { status?: number | string };
};

function toErrorResponse(set: HandlerContext["set"], error: unknown) {
	if (error instanceof CommentError) {
		set.status = error.status;
		return { error: error.message };
	}
	throw error;
}

async function handle(
	{ request, set }: HandlerContext,
	action: (userId: string) => Promise<unknown>,
) {
	let userId: string | null = null;
	try {
		userId = await resolveUserId(request);
	} catch {
		userId = null;
	}
	if (!userId) {
		set.status = 401;
		return { error: "Autentikasi diperlukan" };
	}
	try {
		return await action(userId);
	} catch (error) {
		return toErrorResponse(set, error);
	}
}

async function handlePublic(
	{ set }: HandlerContext,
	action: () => Promise<unknown>,
) {
	try {
		return await action();
	} catch (error) {
		return toErrorResponse(set, error);
	}
}

function parseLimit(raw: string | undefined, max: number, fallback: number) {
	if (raw === undefined) return fallback;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
		throw new CommentError(`Parameter limit harus antara 1 sampai ${max}`, 400);
	}
	return parsed;
}

function parsePage(raw: string | undefined) {
	if (raw === undefined) return 1;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
		throw new CommentError("Parameter page tidak valid", 400);
	}
	return parsed;
}

const targetTypeSchema = t.Union([
	t.Literal("comic_chapter"),
	t.Literal("anime_episode"),
	t.Literal("comic_series"),
	t.Literal("anime_series"),
]);
const idParams = t.Object({
	id: t.String({ minLength: 1, maxLength: 128 }),
});
const contentBody = {
	contentJson: t.Any(),
	hasSpoiler: t.Optional(t.Boolean()),
};

export const commentRoutes = new Elysia({ name: "comment-routes" })
	.get(
		"/api/v1/comments",
		(context) =>
			handlePublic(context, async () => {
				const sort = (context.query.sort ?? "newest") as CommentSort;
				return listTopLevel({
					targetType: context.query.targetType,
					targetId: context.query.targetId,
					sort,
					page: parsePage(context.query.page),
					limit: parseLimit(context.query.limit, 50, 10),
				});
			}),
		{
			query: t.Object({
				targetType: targetTypeSchema,
				targetId: t.String({ minLength: 1, maxLength: 128 }),
				sort: t.Optional(
					t.Union([
						t.Literal("newest"),
						t.Literal("oldest"),
						t.Literal("popular"),
					]),
				),
				page: t.Optional(t.String({ maxLength: 8 })),
				limit: t.Optional(t.String({ maxLength: 8 })),
			}),
		},
	)
	.get(
		"/api/v1/comments/:id/replies",
		(context) =>
			handlePublic(context, async () =>
				listReplies(
					context.params.id,
					parseLimit(context.query.limit, 100, 50),
				),
			),
		{
			params: idParams,
			query: t.Object({
				limit: t.Optional(t.String({ maxLength: 8 })),
			}),
		},
	)
	.post(
		"/api/v1/comments",
		(context) =>
			handle(context, async (userId) =>
				createComment(userId, {
					targetType: context.body.targetType,
					targetId: context.body.targetId,
					parentId: context.body.parentId ?? null,
					replyToCommentId: context.body.replyToCommentId ?? null,
					contentJson: context.body.contentJson as unknown,
					hasSpoiler: context.body.hasSpoiler,
				}),
			),
		{
			body: t.Object({
				targetType: targetTypeSchema,
				targetId: t.String({ minLength: 1, maxLength: 128 }),
				parentId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
				replyToCommentId: t.Optional(
					t.String({ minLength: 1, maxLength: 128 }),
				),
				...contentBody,
			}),
		},
	)
	.patch(
		"/api/v1/comments/:id",
		(context) =>
			handle(context, async (userId) =>
				editComment(userId, context.params.id, {
					contentJson: context.body.contentJson as unknown,
					hasSpoiler: context.body.hasSpoiler,
				}),
			),
		{
			params: idParams,
			body: t.Object({ ...contentBody }),
		},
	)
	.delete(
		"/api/v1/comments/:id",
		(context) =>
			handle(context, async (userId) =>
				softDeleteComment(userId, context.params.id),
			),
		{ params: idParams },
	)
	.post(
		"/api/v1/comments/:id/report",
		(context) =>
			handle(context, async (userId) =>
				reportComment(userId, context.params.id, context.body.reason),
			),
		{
			params: idParams,
			body: t.Object({
				reason: t.Optional(t.String({ maxLength: 500 })),
			}),
		},
	);
