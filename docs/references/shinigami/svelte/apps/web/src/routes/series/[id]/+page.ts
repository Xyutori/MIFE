import { error } from "@sveltejs/kit";
import { getSeriesById, getSeriesChapters } from "../../_mock";

import type { PageLoad } from "./$types";

export const ssr = false;

export const load = (async ({ params }) => {
	const series = getSeriesById(params.id);
	if (!series) throw error(404, "Series tidak ditemukan");
	return {
		series,
		chapters: getSeriesChapters(params.id),
	};
}) satisfies PageLoad;
