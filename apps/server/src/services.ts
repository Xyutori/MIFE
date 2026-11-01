import { createAuth } from "@SyMi/auth";
import { createDb } from "@SyMi/db";
import { sourceScrapeState, sources, workspaces } from "@SyMi/db/schema/index";

import { cache } from "./cache/index";
import { desktopOrigins, ENV } from "./env.server";
import * as s3 from "./storage/s3";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db, desktopOrigins);
export { cache, s3 };

/**
 * Seed comic/anime workspaces, sources, and scrape-state rows.
 * Adapted from XyMI `seedMifeWorkspace` / `seedSuperKomikWorkspace` /
 * `seedAnimeWorkspace` (`apps/server/src/services.ts`): same IDs, slugs,
 * base URLs, and delays so bookmarks and scraper cursors stay compatible.
 * Idempotent (`onConflictDoNothing`); safe to run on every boot.
 */
export async function seedWorkspaceSources() {
	const now = new Date();
	const workspaceSeeds = [
		{ id: "comic", slug: "comic", name: "Comic" },
		{ id: "superkomik", slug: "superkomik", name: "Super Komik" },
		{ id: "anime", slug: "anime", name: "Anime" },
	];
	for (const workspace of workspaceSeeds) {
		await db
			.insert(workspaces)
			.values({
				id: workspace.id,
				slug: workspace.slug,
				name: workspace.name,
				enabled: true,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();
	}

	const sourceSeeds = [
		{
			id: "comic:shinigami",
			workspaceId: "comic",
			key: "shinigami",
			name: "Shinigami",
			baseUrl: "https://api.shngm.io",
			prefix: "/v1",
			requestDelayMs: 800,
		},
		{
			id: "comic:komikcast",
			workspaceId: "comic",
			key: "komikcast",
			name: "KomikCast",
			baseUrl: "https://komikcast.info",
			prefix: "",
			requestDelayMs: 800,
		},
		{
			id: "superkomik:superkomik",
			workspaceId: "superkomik",
			key: "superkomik",
			name: "Super Komik",
			baseUrl: "https://doujin.desu.xxx",
			prefix: "",
			requestDelayMs: 1_200,
		},
		{
			id: "anime:otakudesu",
			workspaceId: "anime",
			key: "otakudesu",
			name: "Otakudesu",
			baseUrl: "https://otakudesu.blog",
			prefix: "",
			requestDelayMs: 1_400,
		},
		{
			id: "anime:kuramanime",
			workspaceId: "anime",
			key: "kuramanime",
			name: "Kuramanime",
			baseUrl: "https://kuramanime.ing",
			prefix: "",
			requestDelayMs: 1_400,
		},
		{
			id: "anime:oploverz",
			workspaceId: "anime",
			key: "oploverz",
			name: "Oploverz",
			baseUrl: "https://oploverz.am",
			prefix: "",
			requestDelayMs: 1_400,
		},
		{
			id: "anime:samehadaku",
			workspaceId: "anime",
			key: "samehadaku",
			name: "Samehadaku",
			baseUrl: "https://v1.samehadaku.how",
			prefix: "",
			requestDelayMs: 1_400,
		},
	];
	const enabledByDefault = new Set([
		"comic:shinigami",
		"comic:komikcast",
		"superkomik:superkomik",
		"anime:otakudesu",
		"anime:kuramanime",
		"anime:oploverz",
	]);
	for (const source of sourceSeeds) {
		const enabled = enabledByDefault.has(source.id);
		await db
			.insert(sources)
			.values({
				...source,
				enabled,
				configJson:
					source.id === "anime:samehadaku"
						? { note: "Source ini dinonaktifkan di konfigurasi aplikasi" }
						: {},
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();
		await db
			.insert(sourceScrapeState)
			.values({
				id: crypto.randomUUID(),
				sourceId: source.id,
				cursorJson: {},
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();
	}
}
