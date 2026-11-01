import { error } from "@sveltejs/kit";
import { checkAdmin } from "#lib/admin.ts";

import type { LayoutLoad } from "./$types";

export const ssr = false;

export const load = (async () => {
	const state = await checkAdmin();
	if (state.kind !== "admin") throw error(404, "Tidak ditemukan");
	return {};
}) satisfies LayoutLoad;
