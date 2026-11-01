import type { PageLoad } from "./$types";

export const load = (({ params }) => ({ params })) satisfies PageLoad;
