export function isBannedSession(session: unknown) {
	if (typeof session !== "object" || session === null || !("user" in session))
		return false;
	const sessionUser = (session as { user: unknown }).user;
	return (
		typeof sessionUser === "object" &&
		sessionUser !== null &&
		"banned" in sessionUser &&
		(sessionUser as { banned: unknown }).banned === true
	);
}
