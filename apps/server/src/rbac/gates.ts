import type { createAuth } from "@SyMi/auth";
import type { Database } from "@SyMi/db";
import { Elysia } from "elysia";

import { isAdmin } from "./permissions";

type Auth = ReturnType<typeof createAuth>;

export type AdminPrincipal = {
	id: string;
};

export type GateOptions = {
	db: Database;
	auth: Auth;
	/** Path prefixes protected by this gate. Defaults to `adminPathPrefixes`. */
	prefixes?: readonly string[];
};

/**
 * Prefixes whose routes require an admin grant. `/api/v1` is intentionally
 * NOT listed yet: reserve it here when v1 admin routes land instead of
 * creating dummy routes.
 */
export const adminPathPrefixes = ["/api/admin"] as const;

export function isProtectedPath(
	pathname: string,
	prefixes: readonly string[] = adminPathPrefixes,
): boolean {
	return prefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

/**
 * Resolve the signed-in user id via Better Auth. Returns `null` for
 * anonymous, expired, or otherwise unresolvable sessions — never throws.
 */
export async function resolvePrincipalId(
	auth: Auth,
	request: Request,
): Promise<string | null> {
	try {
		const session = await auth.api.getSession({ headers: request.headers });
		const id = session?.user?.id;
		return typeof id === "string" && id.length > 0 ? id : null;
	} catch {
		return null;
	}
}

/**
 * Mount with `.use(adminGate({ db, auth }))` BEFORE any admin router so every
 * `/api/admin/*` request is checked. Non-admin paths pass through untouched;
 * `OPTIONS` preflights pass through so CORS keeps working. Denials are an
 * explicit 403 (unlike XyMI's 404-obscured gates) per the MIFE contract.
 */
export function adminGate({
	db,
	auth,
	prefixes = adminPathPrefixes,
}: GateOptions) {
	return new Elysia({ name: "admin-gate" }).onBeforeHandle(
		async ({ request, status }) => {
			const { pathname } = new URL(request.url);
			if (!isProtectedPath(pathname, prefixes)) return;
			if (request.method === "OPTIONS") return;

			const userId = await resolvePrincipalId(auth, request);
			if (!userId || !(await isAdmin(db, userId))) {
				return status(403, {
					error: "forbidden",
					message: "Admin access required",
				});
			}
		},
	);
}
