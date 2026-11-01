/**
 * Bookmark CRUD, ported from XyMI `routes/bookmarks.ts` (+ `bookmarks/store.ts`).
 *
 * Paths and response shapes are identical to XyMI: groups carry
 * `{ id, type, mediaType, name, description, isDefault, orderIndex,
 * customCoverUrl, coverUrl, itemCount, items[], createdAt, updatedAt }` and
 * items carry `{ id, seriesId, title, coverUrl, href, orderIndex, addedAt }`.
 * Comic hrefs use `/komik/<slug>`, anime hrefs use `/anime/<id>`.
 *
 * All endpoints require a Better Auth session (401 otherwise). The default
 * group per media type (comic "Baca nanti", anime "Tonton nanti") is
 * auto-created on first use (create-or-read, safe to retry).
 *
 * Deviation: MIFE `timestamptz` columns expect `Date` (XyMI used ISO strings);
 * JSON output serializes them to ISO strings, same wire shape.
 *
 * This file stays thin: auth + validation + status mapping only. All queries
 * live in `../bookmarks/queries.ts` (batched, N+1-free listing).
 */

import { Elysia, t } from "elysia";

import {
	addItemToGroup,
	BookmarkError,
	type BookmarkMediaType,
	createGroup,
	deleteGroup,
	deleteItem,
	ensureDefaultGroup,
	getGroup,
	getOwnedGroup,
	listGroups,
	patchGroup,
	reorderGroups,
	reorderItems,
} from "../bookmarks/queries";
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
		// GET-yang-menulis untuk ensure-default adalah pola yang diterima di
		// sini: setiap request terautentikasi memastikan kedua grup default
		// ada dulu (comic "Baca nanti", anime "Tonton nanti"), sehingga user
		// lama yang belum punya grup tetap tercakup. Idempoten via unique
		// index (user_id, media_type, default_key) — dicek by user+type,
		// bukan by nama, karena nama bisa diubah user.
		await Promise.all([
			ensureDefaultGroup(userId, "comic"),
			ensureDefaultGroup(userId, "anime"),
		]);
		return await action(userId);
	} catch (error) {
		if (error instanceof BookmarkError) {
			set.status = error.status;
			return { error: error.message };
		}
		throw error;
	}
}

const typeSchema = t.Union([t.Literal("comic"), t.Literal("anime")]);
const groupParams = t.Object({
	groupId: t.String({ minLength: 1, maxLength: 128 }),
});
const itemParams = t.Object({
	groupId: t.String({ minLength: 1, maxLength: 128 }),
	itemId: t.String({ minLength: 1, maxLength: 128 }),
});

export const bookmarkRoutes = new Elysia({ name: "bookmark-routes" })
	.get(
		"/api/v1/bookmarks",
		(context) =>
			handle(context, async (userId) => {
				const mediaType = context.query.type as BookmarkMediaType;
				return { groups: await listGroups(userId, mediaType) };
			}),
		{ query: t.Object({ type: typeSchema }) },
	)
	.put(
		"/api/v1/bookmarks/groups/order",
		(context) =>
			handle(context, async (userId) => {
				const mediaType = context.body.type as BookmarkMediaType;
				return {
					groups: await reorderGroups(userId, mediaType, context.body.groupIds),
				};
			}),
		{
			body: t.Object({
				type: typeSchema,
				groupIds: t.Array(t.String({ minLength: 1, maxLength: 128 })),
			}),
		},
	)
	.post(
		"/api/v1/bookmarks/groups",
		(context) =>
			handle(context, async (userId) => {
				const mediaType = context.body.type as BookmarkMediaType;
				return {
					group: await createGroup(
						userId,
						mediaType,
						context.body.name,
						context.body.description,
					),
				};
			}),
		{
			body: t.Object({
				type: typeSchema,
				name: t.String({ minLength: 1, maxLength: 160 }),
				description: t.Optional(t.String({ maxLength: 500 })),
			}),
		},
	)
	.get(
		"/api/v1/bookmarks/groups/:groupId",
		(context) =>
			handle(context, async (userId) => {
				const owned = await getOwnedGroup(userId, context.params.groupId);
				return {
					group: await getGroup(
						userId,
						owned.mediaType as BookmarkMediaType,
						context.params.groupId,
					),
				};
			}),
		{ params: groupParams },
	)
	.patch(
		"/api/v1/bookmarks/groups/:groupId",
		(context) =>
			handle(context, async (userId) => {
				const owned = await getOwnedGroup(userId, context.params.groupId);
				const mediaType = owned.mediaType as BookmarkMediaType;
				return {
					group: await patchGroup(userId, mediaType, context.params.groupId, {
						name: context.body.name,
						description: context.body.description,
						customCoverUrl: context.body.customCoverUrl,
					}),
				};
			}),
		{
			params: groupParams,
			body: t.Object(
				{
					name: t.Optional(t.String({ minLength: 1, maxLength: 160 })),
					description: t.Optional(
						t.Union([t.String({ maxLength: 500 }), t.Null()]),
					),
					customCoverUrl: t.Optional(
						t.Union([t.String({ maxLength: 2_048 }), t.Null()]),
					),
				},
				{ minProperties: 1 },
			),
		},
	)
	.delete(
		"/api/v1/bookmarks/groups/:groupId",
		(context) =>
			handle(context, async (userId) => {
				const owned = await getOwnedGroup(userId, context.params.groupId);
				const mediaType = owned.mediaType as BookmarkMediaType;
				await deleteGroup(userId, mediaType, context.params.groupId);
				return { ok: true };
			}),
		{ params: groupParams },
	)
	.post(
		"/api/v1/bookmarks/groups/:groupId/items",
		(context) =>
			handle(context, async (userId) => {
				const owned = await getOwnedGroup(userId, context.params.groupId);
				const mediaType = owned.mediaType as BookmarkMediaType;
				return addItemToGroup(
					userId,
					mediaType,
					context.params.groupId,
					context.body.seriesId,
				);
			}),
		{
			params: groupParams,
			body: t.Object({
				seriesId: t.String({ minLength: 1, maxLength: 128 }),
			}),
		},
	)
	.put(
		"/api/v1/bookmarks/groups/:groupId/items/order",
		(context) =>
			handle(context, async (userId) => {
				const owned = await getOwnedGroup(userId, context.params.groupId);
				const mediaType = owned.mediaType as BookmarkMediaType;
				return {
					group: await reorderItems(
						userId,
						mediaType,
						context.params.groupId,
						context.body.itemIds,
					),
				};
			}),
		{
			params: groupParams,
			body: t.Object({
				itemIds: t.Array(t.String({ minLength: 1, maxLength: 128 })),
			}),
		},
	)
	.delete(
		"/api/v1/bookmarks/groups/:groupId/items/:itemId",
		(context) =>
			handle(context, async (userId) => {
				const owned = await getOwnedGroup(userId, context.params.groupId);
				const mediaType = owned.mediaType as BookmarkMediaType;
				await deleteItem(
					userId,
					mediaType,
					context.params.groupId,
					context.params.itemId,
				);
				return { ok: true };
			}),
		{ params: itemParams },
	);
