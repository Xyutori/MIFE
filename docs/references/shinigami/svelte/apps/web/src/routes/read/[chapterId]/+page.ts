import { error } from "@sveltejs/kit";
import { getChapterContext } from "../../_mock";

import type { PageLoad } from "./$types";

export const ssr = false;

export const load = (async ({ params }) => {
	const context = getChapterContext(params.chapterId);
	if (!context) throw error(404, "Chapter tidak ditemukan");
	return context;
}) satisfies PageLoad;
