import { createAuthClient } from "better-auth/svelte";

import { ENV } from "../env.generated";

export const authClient = createAuthClient({
  baseURL: ENV.PUBLIC_SERVER_URL,
});
