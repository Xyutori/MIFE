import { redirect } from "@sveltejs/kit";

import type { PageLoad } from "./$types";

export const load = (({ url }) => {
	redirect(307, `/library${url.search}`);
}) satisfies PageLoad;
