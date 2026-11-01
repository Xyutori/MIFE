/**
 * Bookmark queries, separated from the HTTP route (`../routes/bookmarks.ts`).
 *
 * The route stays thin (validation + status mapping); every Drizzle query
 * lives here. `listGroups` is deliberately N+1-free: one groups query plus
 * one batched items query per media type, joined in JS. Single-group reads
 * (`getGroup`, `getItems`) keep one query per table, which is optimal for a
 * single group. Reorders use one `CASE`-based UPDATE instead of N updates.
 */

import {
	animeBookmarkEntries,
	animeSeries,
	animeSources,
	animeThumbnails,
	bookmarkGroups,
	comicBookmarkEntries,
	series,
} from "@SyMi/db/schema/index";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "../services";

export type BookmarkMediaType = "comic" | "anime";

export const DEFAULT_GROUP_NAME = "Baca nanti";
export const DEFAULT_ANIME_GROUP_NAME = "Tonton nanti";
export const DEFAULT_GROUP_KEY = "default";

/** Nama grup default per tipe media: comic "Baca nanti", anime "Tonton nanti". */
export function defaultGroupName(mediaType: BookmarkMediaType) {
	return mediaType === "anime" ? DEFAULT_ANIME_GROUP_NAME : DEFAULT_GROUP_NAME;
}

export class BookmarkError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 401 | 404 | 409 | 422,
	) {
		super(message);
		this.name = "BookmarkError";
	}
}

export function normalizeGroupName(name: string) {
	return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function validateGroupName(name: string) {
	const clean = name.normalize("NFKC").trim().replace(/\s+/g, " ");
	if (!clean || clean.length > 80)
		throw new BookmarkError(
			"Nama grup wajib diisi (maksimal 80 karakter)",
			422,
		);
	return { name: clean, normalizedName: normalizeGroupName(clean) };
}

export function validateCustomCoverUrl(value: string | null) {
	if (value === null) return null;
	const normalized = value.trim();
	const hasControlOrBackslash = [...normalized].some(
		(char) => char <= "\u001f" || char === "\\",
	);
	const relative =
		normalized.startsWith("/api/v1/") &&
		!normalized.startsWith("//") &&
		normalized.length <= 2_048 &&
		!hasControlOrBackslash;
	let absolute = false;
	try {
		const url = new URL(normalized);
		absolute = url.protocol === "https:" && !url.username && !url.password;
	} catch {
		absolute = false;
	}
	if (!relative && !absolute)
		throw new BookmarkError(
			"URL sampul harus berupa aset HTTPS atau path aset API",
			422,
		);
	return normalized;
}

export async function ensureDefaultGroup(
	userId: string,
	mediaType: BookmarkMediaType,
) {
	const now = new Date();
	const name = defaultGroupName(mediaType);
	await db
		.insert(bookmarkGroups)
		.values({
			id: crypto.randomUUID(),
			userId,
			mediaType,
			name,
			description: null,
			normalizedName: normalizeGroupName(name),
			defaultKey: DEFAULT_GROUP_KEY,
			customCoverUrl: null,
			orderIndex: 0,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing();
	const rows = await db
		.select()
		.from(bookmarkGroups)
		.where(
			and(
				eq(bookmarkGroups.userId, userId),
				eq(bookmarkGroups.mediaType, mediaType),
				eq(bookmarkGroups.defaultKey, DEFAULT_GROUP_KEY),
			),
		)
		.limit(1);
	if (!rows[0]) throw new Error("Default bookmark group could not be created");
	return rows[0];
}

export type BookmarkGroup = typeof bookmarkGroups.$inferSelect;

export type BookmarkItem = {
	entryId: string;
	groupId: string;
	seriesId: string;
	title: string;
	coverImageUrl: string | null;
	href: string;
	orderIndex: number;
	createdAt: Date;
};

export function ownedGroupWhere(
	userId: string,
	mediaType: BookmarkMediaType,
	groupId: string,
) {
	return and(
		eq(bookmarkGroups.id, groupId),
		eq(bookmarkGroups.userId, userId),
		eq(bookmarkGroups.mediaType, mediaType),
	);
}

export async function requireOwnedGroup(
	userId: string,
	mediaType: BookmarkMediaType,
	groupId: string,
) {
	const rows = await db
		.select()
		.from(bookmarkGroups)
		.where(ownedGroupWhere(userId, mediaType, groupId))
		.limit(1);
	if (!rows[0]) throw new BookmarkError("Grup bookmark tidak ditemukan", 404);
	return rows[0];
}

export async function getOwnedGroup(userId: string, groupId: string) {
	const rows = await db
		.select()
		.from(bookmarkGroups)
		.where(
			and(eq(bookmarkGroups.id, groupId), eq(bookmarkGroups.userId, userId)),
		)
		.limit(1);
	if (!rows[0]) throw new BookmarkError("Grup bookmark tidak ditemukan", 404);
	return rows[0];
}

function comicHref(normalizedTitle: string) {
	return `/komik/${encodeURIComponent(normalizedTitle.replace(/\s+/g, "-"))}`;
}

async function comicItemsForGroups(
	groupIds: string[],
): Promise<Map<string, BookmarkItem[]>> {
	const grouped = new Map<string, BookmarkItem[]>();
	if (groupIds.length === 0) return grouped;
	const rows = await db
		.select({
			entryId: comicBookmarkEntries.id,
			groupId: comicBookmarkEntries.groupId,
			seriesId: comicBookmarkEntries.seriesId,
			title: series.title,
			normalizedTitle: series.normalizedTitle,
			coverImageUrl: series.coverImageUrl,
			orderIndex: comicBookmarkEntries.orderIndex,
			createdAt: comicBookmarkEntries.createdAt,
		})
		.from(comicBookmarkEntries)
		.innerJoin(series, eq(comicBookmarkEntries.seriesId, series.id))
		.where(inArray(comicBookmarkEntries.groupId, groupIds))
		.orderBy(
			asc(comicBookmarkEntries.orderIndex),
			asc(comicBookmarkEntries.createdAt),
		);
	for (const row of rows) {
		const list = grouped.get(row.groupId) ?? [];
		list.push({ ...row, href: comicHref(row.normalizedTitle) });
		grouped.set(row.groupId, list);
	}
	return grouped;
}

async function animeItemsForGroups(
	groupIds: string[],
): Promise<Map<string, BookmarkItem[]>> {
	const grouped = new Map<string, BookmarkItem[]>();
	if (groupIds.length === 0) return grouped;
	const rows = await db
		.select({
			entryId: animeBookmarkEntries.id,
			groupId: animeBookmarkEntries.groupId,
			seriesId: animeBookmarkEntries.animeId,
			title: animeSeries.title,
			orderIndex: animeBookmarkEntries.orderIndex,
			createdAt: animeBookmarkEntries.createdAt,
		})
		.from(animeBookmarkEntries)
		.innerJoin(animeSeries, eq(animeBookmarkEntries.animeId, animeSeries.id))
		.where(inArray(animeBookmarkEntries.groupId, groupIds))
		.orderBy(
			asc(animeBookmarkEntries.orderIndex),
			asc(animeBookmarkEntries.createdAt),
		);
	const ids = [...new Set(rows.map((row) => row.seriesId))];
	const coverByAnime = new Map<string, string>();
	if (ids.length > 0) {
		const covers = await db
			.select({
				animeId: animeSources.animeId,
				cover: animeThumbnails.externalUrl,
				poster: animeSources.posterUrl,
			})
			.from(animeSources)
			.leftJoin(
				animeThumbnails,
				and(
					eq(animeThumbnails.animeSourceId, animeSources.id),
					ne(animeThumbnails.downloadStatus, "stale"),
				),
			)
			.where(inArray(animeSources.animeId, ids))
			.orderBy(asc(animeSources.updatedAt), asc(animeSources.id));
		for (const row of covers) {
			const cover = row.cover ?? row.poster;
			if (cover && !coverByAnime.has(row.animeId))
				coverByAnime.set(row.animeId, cover);
		}
	}
	for (const row of rows) {
		const list = grouped.get(row.groupId) ?? [];
		list.push({
			...row,
			coverImageUrl: coverByAnime.get(row.seriesId) ?? null,
			href: `/anime/${encodeURIComponent(row.seriesId)}`,
		});
		grouped.set(row.groupId, list);
	}
	return grouped;
}

export function groupResponse(group: BookmarkGroup, items: BookmarkItem[]) {
	return {
		id: group.id,
		type: group.mediaType,
		mediaType: group.mediaType,
		name: group.name,
		description: group.description,
		isDefault: group.defaultKey === DEFAULT_GROUP_KEY,
		orderIndex: group.orderIndex,
		customCoverUrl: group.customCoverUrl,
		coverUrl: group.customCoverUrl ?? items[0]?.coverImageUrl ?? null,
		itemCount: items.length,
		items: items.map((item) => ({
			id: item.entryId,
			seriesId: item.seriesId,
			title: item.title,
			coverUrl: item.coverImageUrl,
			href: item.href,
			orderIndex: item.orderIndex,
			addedAt: item.createdAt,
		})),
		createdAt: group.createdAt,
		updatedAt: group.updatedAt,
	};
}

/**
 * N+1-free group listing: 1 groups query + 1 batched items query
 * (anime adds 1 batched cover query), joined in JS.
 */
export async function listGroups(userId: string, mediaType: BookmarkMediaType) {
	const groups = await db
		.select()
		.from(bookmarkGroups)
		.where(
			and(
				eq(bookmarkGroups.userId, userId),
				eq(bookmarkGroups.mediaType, mediaType),
			),
		)
		.orderBy(asc(bookmarkGroups.orderIndex), asc(bookmarkGroups.createdAt));
	if (groups.length === 0) return [];
	const byGroup =
		mediaType === "comic"
			? await comicItemsForGroups(groups.map((group) => group.id))
			: await animeItemsForGroups(groups.map((group) => group.id));
	return groups.map((group) =>
		groupResponse(group, byGroup.get(group.id) ?? []),
	);
}

export async function getItems(
	mediaType: BookmarkMediaType,
	groupId: string,
): Promise<BookmarkItem[]> {
	const byGroup =
		mediaType === "comic"
			? await comicItemsForGroups([groupId])
			: await animeItemsForGroups([groupId]);
	return byGroup.get(groupId) ?? [];
}

export async function getGroup(
	userId: string,
	mediaType: BookmarkMediaType,
	groupId: string,
) {
	const group = await requireOwnedGroup(userId, mediaType, groupId);
	return groupResponse(group, await getItems(mediaType, group.id));
}

export async function countGroups(
	userId: string,
	mediaType: BookmarkMediaType,
) {
	const total = await db
		.select({ count: count() })
		.from(bookmarkGroups)
		.where(
			and(
				eq(bookmarkGroups.userId, userId),
				eq(bookmarkGroups.mediaType, mediaType),
			),
		);
	return total[0]?.count ?? 0;
}

export async function createGroup(
	userId: string,
	mediaType: BookmarkMediaType,
	name: string,
	description?: string,
) {
	const { name: clean, normalizedName } = validateGroupName(name);
	const existing = await db
		.select({ id: bookmarkGroups.id })
		.from(bookmarkGroups)
		.where(
			and(
				eq(bookmarkGroups.userId, userId),
				eq(bookmarkGroups.mediaType, mediaType),
				eq(bookmarkGroups.normalizedName, normalizedName),
			),
		)
		.limit(1);
	if (existing[0]) throw new BookmarkError("Nama grup sudah digunakan", 409);
	const timestamp = new Date();
	const inserted = await db
		.insert(bookmarkGroups)
		.values({
			id: crypto.randomUUID(),
			userId,
			mediaType,
			name: clean,
			description: description?.trim() || null,
			normalizedName,
			defaultKey: null,
			customCoverUrl: null,
			orderIndex: await countGroups(userId, mediaType),
			createdAt: timestamp,
			updatedAt: timestamp,
		})
		.returning();
	if (!inserted[0]) throw new BookmarkError("Grup tidak dapat dibuat", 409);
	return groupResponse(inserted[0], []);
}

export type GroupPatch = {
	name?: string;
	description?: string | null;
	customCoverUrl?: string | null;
};

export async function patchGroup(
	userId: string,
	mediaType: BookmarkMediaType,
	groupId: string,
	patch: GroupPatch,
) {
	const group = await requireOwnedGroup(userId, mediaType, groupId);
	const update: Partial<typeof bookmarkGroups.$inferInsert> = {
		updatedAt: new Date(),
	};
	if (patch.name !== undefined) {
		if (group.defaultKey === DEFAULT_GROUP_KEY)
			throw new BookmarkError("Nama grup default tidak dapat diubah", 409);
		const normalized = validateGroupName(patch.name);
		const duplicate = await db
			.select({ id: bookmarkGroups.id })
			.from(bookmarkGroups)
			.where(
				and(
					eq(bookmarkGroups.userId, userId),
					eq(bookmarkGroups.mediaType, mediaType),
					eq(bookmarkGroups.normalizedName, normalized.normalizedName),
				),
			)
			.limit(1);
		if (duplicate[0] && duplicate[0].id !== groupId)
			throw new BookmarkError("Nama grup sudah digunakan", 409);
		update.name = normalized.name;
		update.normalizedName = normalized.normalizedName;
	}
	if (patch.description !== undefined) {
		const description = patch.description?.trim() ?? "";
		if (description.length > 500)
			throw new BookmarkError("Deskripsi grup maksimal 500 karakter", 422);
		update.description = description || null;
	}
	if (patch.customCoverUrl !== undefined)
		update.customCoverUrl = validateCustomCoverUrl(patch.customCoverUrl);
	const rows = await db
		.update(bookmarkGroups)
		.set(update)
		.where(ownedGroupWhere(userId, mediaType, groupId))
		.returning();
	if (!rows[0]) throw new BookmarkError("Grup bookmark tidak ditemukan", 404);
	return groupResponse(rows[0], await getItems(mediaType, groupId));
}

export async function deleteGroup(
	userId: string,
	mediaType: BookmarkMediaType,
	groupId: string,
) {
	const group = await requireOwnedGroup(userId, mediaType, groupId);
	if (group.defaultKey === DEFAULT_GROUP_KEY)
		throw new BookmarkError("Grup default tidak dapat dihapus", 409);
	await db
		.delete(bookmarkGroups)
		.where(ownedGroupWhere(userId, mediaType, groupId));
}

function orderCase(column: typeof bookmarkGroups.orderIndex, ids: string[]) {
	return sql`CASE ${sql.join(
		ids.map(
			(id, index) => sql`WHEN ${bookmarkGroups.id} = ${id} THEN ${index}`,
		),
		sql` `,
	)} ELSE ${column} END`;
}

/** Single-statement reorder guarded by ownership checks. */
export async function reorderGroups(
	userId: string,
	mediaType: BookmarkMediaType,
	groupIds: string[],
) {
	const groups = await db
		.select({ id: bookmarkGroups.id })
		.from(bookmarkGroups)
		.where(
			and(
				eq(bookmarkGroups.userId, userId),
				eq(bookmarkGroups.mediaType, mediaType),
			),
		);
	if (new Set(groupIds).size !== groupIds.length)
		throw new BookmarkError("ID grup tidak boleh berulang", 400);
	const ownedIds = new Set(groups.map((group) => group.id));
	if (groupIds.some((id) => !ownedIds.has(id)))
		throw new BookmarkError("Grup bookmark tidak ditemukan", 404);
	if (groupIds.length !== groups.length)
		throw new BookmarkError("Urutan harus memuat semua grup", 400);
	await db
		.update(bookmarkGroups)
		.set({
			orderIndex: orderCase(bookmarkGroups.orderIndex, groupIds),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(bookmarkGroups.userId, userId),
				eq(bookmarkGroups.mediaType, mediaType),
			),
		);
	return listGroups(userId, mediaType);
}

export async function addItemToGroup(
	userId: string,
	mediaType: BookmarkMediaType,
	groupId: string,
	seriesId: string,
) {
	await requireOwnedGroup(userId, mediaType, groupId);
	const timestamp = new Date();
	if (mediaType === "comic") {
		const catalogRows = await db
			.select({ id: series.id })
			.from(series)
			.where(eq(series.id, seriesId))
			.limit(1);
		if (!catalogRows[0])
			throw new BookmarkError("Seri komik tidak ditemukan", 404);
		const orderRows = await db
			.select({ count: count() })
			.from(comicBookmarkEntries)
			.where(eq(comicBookmarkEntries.groupId, groupId));
		const inserted = await db
			.insert(comicBookmarkEntries)
			.values({
				id: crypto.randomUUID(),
				groupId,
				seriesId,
				orderIndex: orderRows[0]?.count ?? 0,
				createdAt: timestamp,
				updatedAt: timestamp,
			})
			.onConflictDoNothing()
			.returning();
		const found =
			inserted[0] ??
			(
				await db
					.select()
					.from(comicBookmarkEntries)
					.where(
						and(
							eq(comicBookmarkEntries.groupId, groupId),
							eq(comicBookmarkEntries.seriesId, seriesId),
						),
					)
					.limit(1)
			)[0];
		if (!found) throw new BookmarkError("Bookmark tidak dapat disimpan", 409);
		const items = await getItems(mediaType, groupId);
		return {
			item: items.find((item) => item.entryId === found.id) ?? null,
			alreadyPresent: inserted.length === 0,
		};
	}
	const catalogRows = await db
		.select({ id: animeSeries.id })
		.from(animeSeries)
		.where(eq(animeSeries.id, seriesId))
		.limit(1);
	if (!catalogRows[0])
		throw new BookmarkError("Seri anime tidak ditemukan", 404);
	const orderRows = await db
		.select({ count: count() })
		.from(animeBookmarkEntries)
		.where(eq(animeBookmarkEntries.groupId, groupId));
	const inserted = await db
		.insert(animeBookmarkEntries)
		.values({
			id: crypto.randomUUID(),
			groupId,
			animeId: seriesId,
			orderIndex: orderRows[0]?.count ?? 0,
			createdAt: timestamp,
			updatedAt: timestamp,
		})
		.onConflictDoNothing()
		.returning();
	const found =
		inserted[0] ??
		(
			await db
				.select()
				.from(animeBookmarkEntries)
				.where(
					and(
						eq(animeBookmarkEntries.groupId, groupId),
						eq(animeBookmarkEntries.animeId, seriesId),
					),
				)
				.limit(1)
		)[0];
	if (!found) throw new BookmarkError("Bookmark tidak dapat disimpan", 409);
	const items = await getItems(mediaType, groupId);
	return {
		item: items.find((item) => item.entryId === found.id) ?? null,
		alreadyPresent: inserted.length === 0,
	};
}

/** Single-statement item reorder guarded by ownership checks. */
export async function reorderItems(
	userId: string,
	mediaType: BookmarkMediaType,
	groupId: string,
	itemIds: string[],
) {
	await requireOwnedGroup(userId, mediaType, groupId);
	if (new Set(itemIds).size !== itemIds.length)
		throw new BookmarkError("ID bookmark tidak boleh berulang", 400);
	const entryTable =
		mediaType === "comic" ? comicBookmarkEntries : animeBookmarkEntries;
	const entries = await db
		.select({ id: entryTable.id })
		.from(entryTable)
		.where(eq(entryTable.groupId, groupId));
	const ownedIds = new Set(entries.map((entry) => entry.id));
	if (itemIds.some((id) => !ownedIds.has(id)))
		throw new BookmarkError("Bookmark tidak ditemukan", 404);
	if (itemIds.length !== entries.length)
		throw new BookmarkError("Urutan harus memuat semua bookmark", 400);
	const ordering = sql.join(
		itemIds.map(
			(id, index) => sql`WHEN ${entryTable.id} = ${id} THEN ${index}`,
		),
		sql` `,
	);
	await db
		.update(entryTable)
		.set({
			orderIndex: sql`CASE ${ordering} ELSE ${entryTable.orderIndex} END`,
			updatedAt: new Date(),
		})
		.where(eq(entryTable.groupId, groupId));
	return getGroup(userId, mediaType, groupId);
}

export async function deleteItem(
	userId: string,
	mediaType: BookmarkMediaType,
	groupId: string,
	itemId: string,
) {
	await requireOwnedGroup(userId, mediaType, groupId);
	const entryTable =
		mediaType === "comic" ? comicBookmarkEntries : animeBookmarkEntries;
	const rows = await db
		.delete(entryTable)
		.where(and(eq(entryTable.groupId, groupId), eq(entryTable.id, itemId)))
		.returning({ id: entryTable.id });
	if (!rows[0]) throw new BookmarkError("Bookmark tidak ditemukan", 404);
}
