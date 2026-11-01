import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { initLogger } from "evlog";
import {
	type BetterAuthInstance,
	createAuthMiddleware,
} from "evlog/better-auth";
import { evlog } from "evlog/elysia";
import { createFsDrain } from "evlog/fs";

import { desktopOrigins, ENV } from "./env.server";
import { ensureBootstrapAdmin } from "./rbac/bootstrap";
import { adminGate } from "./rbac/gates";
import { ensureRbacSeed } from "./rbac/seed";
// Side effect: registers anime site adapters (otakudesu/kuramanime/oploverz).
import "./anime/sources";
import { startBackgroundJobs } from "./jobs/scheduler";
import { adminRoutes } from "./routes/admin";
import { animeRoutes } from "./routes/anime";
import { archiveRoutes } from "./routes/archive";
import { authRoutes } from "./routes/auth";
import { bookmarkRoutes } from "./routes/bookmarks";
import { comicRoutes } from "./routes/comic";
import { commentRoutes } from "./routes/comments";
import { imagesRoutes } from "./routes/images";
import { libraryAdminRoutes } from "./routes/library-admin";
import { preferenceRoutes } from "./routes/preferences";
import { scrapesRoutes } from "./routes/scrapes";
import { auth, db, seedWorkspaceSources } from "./services";

initLogger({
	env: { service: "MIFE-server" },
});

// Seed the RBAC catalog first (roles, permissions, admin grants), then
// promote AUTH_BOOTSTRAP_ADMIN_EMAIL when no admin exists yet.
// Single call site by design (see apps/server/src/rbac/seed.ts); never throws.
await ensureRbacSeed(db);
await ensureBootstrapAdmin(db, ENV.AUTH_BOOTSTRAP_ADMIN_EMAIL);
await seedWorkspaceSources();

const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
	exclude: ["/api/auth/**"],
	maskEmail: true,
});

new Elysia()
	.use(
		evlog({
			drain:
				process.env.NODE_ENV === "production" ? undefined : createFsDrain(),
		}),
	)
	.derive(async ({ request, log }) => {
		await identifyUser(log, request.headers, new URL(request.url).pathname);
		return {};
	})
	.use(
		cors({
			origin: [ENV.CORS_ORIGIN, ...desktopOrigins],
			methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowedHeaders: ["Content-Type", "Authorization"],
			credentials: true,
		}),
	)
	.use(adminGate({ db, auth }))
	.use(comicRoutes)
	.use(animeRoutes)
	.use(bookmarkRoutes)
	.use(commentRoutes)
	.use(preferenceRoutes)
	.use(scrapesRoutes)
	.use(imagesRoutes)
	.use(libraryAdminRoutes)
	.use(archiveRoutes)
	.use(adminRoutes)
	.use(authRoutes)
	.get("/", () => "OK")
	.listen(ENV.PORT, () => {
		console.log(`Server is running on http://localhost:${ENV.PORT}`);
	});

startBackgroundJobs();
