/**
 * Shared email normalization for auth-adjacent code (bootstrapping, lookups).
 * Mirrors XyMI `apps/server/src/auth/email.ts`.
 */
export function normalizeEmail(email: string): string {
	const normalized = email.trim().toLowerCase();
	if (!normalized) throw new Error("Email address is required");
	return normalized;
}
