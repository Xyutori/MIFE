import { redirect } from "@sveltejs/kit";
import type { BetterFetchOption } from "better-auth/client";

import { authClient } from "#lib/auth-client.ts";

import type { PageLoad } from "./$types";

// The session cookie belongs to the separate API origin and is available in the browser.
export const ssr = false;

export const load = (async ({ fetch }) => {
  const fetchOptions = {
    customFetchImpl: fetch,
    throw: true,
  } satisfies BetterFetchOption;
  const session = await authClient.getSession({ fetchOptions });
  if (!session) redirect(307, "/login");
  return { user: session.user };
}) satisfies PageLoad;
