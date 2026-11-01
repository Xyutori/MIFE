import { apiBase, type BookmarkGroup, readJson } from "#lib/api.ts";
import type { BookmarkType } from "#lib/reader.ts";

function authError(status: number, fallback: string): Error {
	const error = new Error(fallback) as Error & { status?: number };
	error.status = status;
	return error;
}

/** Sampul grup/item bisa berupa URL absolut atau path relatif server. */
export function resolveBookmarkCover(value?: string | null): string | null {
	if (!value) return null;
	if (value.startsWith("/") && !value.startsWith("//"))
		return `${apiBase()}${value}`;
	return value;
}

export async function fetchBookmarkGroup(
	groupId: string,
	signal?: AbortSignal,
): Promise<BookmarkGroup> {
	const response = await fetch(
		`${apiBase()}/api/v1/bookmarks/groups/${encodeURIComponent(groupId)}`,
		{ credentials: "include", signal },
	);
	if (response.status === 401)
		throw authError(401, "Masuk untuk melihat library.");
	const payload = await readJson<{ group: BookmarkGroup }>(response);
	if (!payload.group) throw new Error("Library tidak ditemukan.");
	return payload.group;
}

export async function createBookmarkGroup(
	type: BookmarkType,
	name: string,
): Promise<BookmarkGroup> {
	const response = await fetch(`${apiBase()}/api/v1/bookmarks/groups`, {
		method: "POST",
		credentials: "include",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type, name: name.trim() }),
	});
	if (response.status === 401)
		throw authError(401, "Masuk untuk membuat library.");
	const payload = await readJson<{ group: BookmarkGroup }>(response);
	if (!payload.group) throw new Error("Library gagal dibuat.");
	return payload.group;
}

export async function renameBookmarkGroup(
	groupId: string,
	name: string,
): Promise<BookmarkGroup> {
	const response = await fetch(
		`${apiBase()}/api/v1/bookmarks/groups/${encodeURIComponent(groupId)}`,
		{
			method: "PATCH",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: name.trim() }),
		},
	);
	if (response.status === 401)
		throw authError(401, "Masuk untuk mengubah library.");
	const payload = await readJson<{ group: BookmarkGroup }>(response);
	if (!payload.group) throw new Error("Nama library gagal diubah.");
	return payload.group;
}

export async function deleteBookmarkGroup(groupId: string): Promise<void> {
	const response = await fetch(
		`${apiBase()}/api/v1/bookmarks/groups/${encodeURIComponent(groupId)}`,
		{ method: "DELETE", credentials: "include" },
	);
	if (response.status === 401)
		throw authError(401, "Masuk untuk menghapus library.");
	await readJson<unknown>(response);
}

export async function addBookmarkItem(
	groupId: string,
	seriesId: string,
): Promise<void> {
	const response = await fetch(
		`${apiBase()}/api/v1/bookmarks/groups/${encodeURIComponent(groupId)}/items`,
		{
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ seriesId }),
		},
	);
	if (response.status === 401)
		throw authError(401, "Masuk untuk menyimpan ke library.");
	await readJson<unknown>(response);
}

export async function removeBookmarkItem(
	groupId: string,
	itemId: string,
): Promise<void> {
	const response = await fetch(
		`${apiBase()}/api/v1/bookmarks/groups/${encodeURIComponent(groupId)}/items/${encodeURIComponent(itemId)}`,
		{ method: "DELETE", credentials: "include" },
	);
	if (response.status === 401)
		throw authError(401, "Masuk untuk mengubah library.");
	await readJson<unknown>(response);
}
