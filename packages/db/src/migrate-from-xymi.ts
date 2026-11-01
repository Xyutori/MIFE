#!/usr/bin/env bun

/**
 * One-shot data migration from a legacy XyMI SQLite database to MIFE Postgres.
 *
 * NOT part of the runtime. Run explicitly:
 *   XYMI_SQLITE_PATH=/path/to/local.db DATABASE_URL=... \
 *     bun ./src/migrate-from-xymi.ts [--dry-run] [--overwrite]
 *
 * - Default source: `/home/xyutori/Projects/private/XyMI/.data/local.db`
 *   (override with `XYMI_SQLITE_PATH`). A missing file or an empty source
 *   (0 rows everywhere) is a normal no-op: the script reports per-table row
 *   counts and exits 0 without touching Postgres.
 * - Idempotent: if any target table already holds rows, the script skips the
 *   copy and exits 0 (report tells you to pass `--overwrite`). `--overwrite`
 *   truncates ONLY the 31 ported tables (never the better-auth `user` table)
 *   with a single `TRUNCATE ... CASCADE`, then copies.
 * - `--dry-run` reports source/target row counts without writing anything.
 * - Value mapping mirrors the schema port: ISO-8601 TEXT -> timestamptz
 *   (`Date`), `0/1` -> boolean, TEXT-encoded JSON -> `jsonb`. Unparseable
 *   dates become NULL (counted in the report); unparseable JSON falls back to
 *   the column default (counted too).
 * - `series.search_vector` / `anime_series.search_vector` are backfilled with
 *   the same `to_tsvector('simple', ...)` expression the app uses on write.
 * - `user_preferences` rows whose `user_id` has no matching better-auth `user`
 *   in Postgres are skipped (FK would reject them); skipped IDs are reported.
 */

import { Database as SqliteDatabase } from "bun:sqlite";
import { existsSync } from "node:fs";
import { Client } from "pg";

const DEFAULT_SQLITE_PATH =
	"/home/xyutori/Projects/private/XyMI/.data/local.db";

type Row = Record<string, unknown>;

type TableSpec = {
	/** Postgres (and legacy SQLite) table name. */
	table: string;
	/** Columns holding ISO-8601 datetime text in SQLite. */
	dates?: string[];
	/** Columns holding 0/1 (or true/false) in SQLite. */
	bools?: string[];
	/** Columns holding JSON text in SQLite. */
	jsons?: string[];
	/** Fallback when a source value is NULL/unparseable (NOT NULL columns). */
	fallbacks?: Record<string, unknown>;
};

const TS = ["created_at", "updated_at"];

const TABLES: TableSpec[] = [
	{
		table: "workspaces",
		dates: TS,
		bools: ["enabled"],
		fallbacks: { enabled: true },
	},
	{
		table: "sources",
		dates: TS,
		bools: ["enabled"],
		jsons: ["config_json"],
		fallbacks: {
			enabled: true,
			prefix: "",
			request_delay_ms: 700,
			config_json: {},
		},
	},
	{
		table: "series",
		dates: ["latest_chapter_at", "source_updated_at", ...TS],
		bools: ["is_featured", "is_recommended", "is_visible"],
		jsons: ["authors_json", "artists_json", "genres_json", "formats_json"],
		fallbacks: {
			is_visible: true,
			authors_json: [],
			artists_json: [],
			genres_json: [],
			formats_json: [],
		},
	},
	{ table: "series_aliases", dates: TS },
	{ table: "series_genres" },
	{
		table: "series_sources",
		dates: ["source_updated_at", "last_scraped_at", "last_hydrated_at", ...TS],
		bools: ["needs_hydration"],
		jsons: ["raw_payload"],
		fallbacks: { needs_hydration: true, raw_payload: {} },
	},
	{ table: "chapters", dates: ["published_at", ...TS] },
	{
		table: "chapter_sources",
		dates: ["reader_urls_scraped_at", "published_at", "last_scraped_at", ...TS],
		jsons: ["raw_payload"],
		fallbacks: {
			reader_url_status: "pending",
			reader_url_count: 0,
			raw_payload: {},
		},
	},
	{ table: "image_blobs", dates: TS },
	{
		table: "chapter_pages",
		dates: ["downloaded_at", ...TS],
		bools: ["is_active"],
		fallbacks: {
			is_active: true,
			download_status: "remote",
			download_attempts: 0,
		},
	},
	{ table: "image_variants", dates: TS },
	{
		table: "media_assets",
		dates: ["downloaded_at", "last_verified_at", ...TS],
		fallbacks: {
			download_status: "remote",
			integrity_status: "unchecked",
			download_attempts: 0,
		},
	},
	{
		table: "scrape_runs",
		dates: ["worker_lease_expires_at", "started_at", "finished_at", ...TS],
		jsons: ["summary_json"],
		fallbacks: {
			mode: "incremental",
			status: "queued",
			triggered_by: "manual",
			progress_total: 0,
			progress_completed: 0,
			progress_failed: 0,
			summary_json: {},
		},
	},
	{
		table: "scrape_events",
		dates: TS,
		jsons: ["details_json"],
		fallbacks: { level: "info", details_json: {} },
	},
	{
		table: "source_scrape_state",
		dates: ["last_full_at", "last_success_at", "last_attempt_at", ...TS],
		jsons: ["cursor_json"],
		fallbacks: { cursor_json: {} },
	},
	{ table: "app_settings", dates: TS },
	{
		table: "anime_series",
		dates: ["latest_episode_at", ...TS],
		bools: ["is_visible"],
		jsons: ["genres_json", "metadata_json"],
		fallbacks: { is_visible: true, genres_json: [], metadata_json: {} },
	},
	{ table: "anime_series_genres" },
	{
		table: "anime_sources",
		dates: ["last_scraped_at", ...TS],
		jsons: ["raw_payload"],
		fallbacks: { raw_payload: {} },
	},
	{ table: "anime_episodes", dates: ["released_at", ...TS] },
	{
		table: "anime_episode_sources",
		dates: ["last_scraped_at", ...TS],
		jsons: ["stream_links_json", "download_links_json", "raw_payload"],
		fallbacks: {
			stream_links_json: [],
			download_links_json: [],
			raw_payload: {},
		},
	},
	{
		table: "anime_thumbnails",
		dates: ["downloaded_at", ...TS],
		fallbacks: { download_status: "remote" },
	},
	{
		table: "bookmark_groups",
		dates: TS,
		fallbacks: { order_index: 0 },
	},
	{
		table: "comic_bookmark_entries",
		dates: TS,
		fallbacks: { order_index: 0 },
	},
	{
		table: "anime_bookmark_entries",
		dates: TS,
		fallbacks: { order_index: 0 },
	},
	{
		table: "rbac_roles",
		dates: TS,
		bools: ["is_system"],
		fallbacks: { is_system: false },
	},
	{
		table: "rbac_permissions",
		dates: TS,
		bools: ["is_system"],
		fallbacks: { is_system: false },
	},
	{ table: "rbac_role_permissions" },
	{ table: "rbac_user_roles", dates: ["created_at"] },
	{ table: "user_media", dates: TS },
	{ table: "user_preferences", dates: ["updated_at"] },
];

function toDate(value: unknown): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const d = value instanceof Date ? value : new Date(String(value));
	return Number.isNaN(d.getTime()) ? null : d;
}

function toBool(value: unknown): boolean | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		if (value === "1" || value.toLowerCase() === "true") return true;
		if (value === "0" || value === "" || value.toLowerCase() === "false")
			return false;
	}
	return null;
}

function toJson(value: unknown): unknown {
	if (value === null || value === undefined || value === "") return undefined;
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

async function main(): Promise<void> {
	const args = new Set(process.argv.slice(2));
	const dryRun = args.has("--dry-run");
	const overwrite = args.has("--overwrite");

	const sqlitePath = process.env.XYMI_SQLITE_PATH ?? DEFAULT_SQLITE_PATH;
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.error("DATABASE_URL is not set. Nothing was migrated.");
		process.exitCode = 1;
		return;
	}

	if (!existsSync(sqlitePath)) {
		console.log(
			`Source SQLite file not found at ${sqlitePath} (XYMI_SQLITE_PATH).`,
		);
		console.log("Nothing to migrate: all table row counts are 0.");
		for (const spec of TABLES) {
			console.log(`  ${spec.table}: 0 rows`);
		}
		return;
	}

	const sqlite = new SqliteDatabase(sqlitePath, { readonly: true });
	const existing = new Set(
		sqlite
			.query<{ name: string }, []>(
				"SELECT name FROM sqlite_master WHERE type = 'table'",
			)
			.all()
			.map((r) => r.name),
	);

	const sourceCounts = new Map<string, number>();
	for (const spec of TABLES) {
		if (!existing.has(spec.table)) {
			sourceCounts.set(spec.table, 0);
			continue;
		}
		const row = sqlite
			.query<{ count: number }, []>(
				`SELECT COUNT(*) AS count FROM "${spec.table}"`,
			)
			.get();
		sourceCounts.set(spec.table, row?.count ?? 0);
	}
	sqlite.close();

	const totalSource = [...sourceCounts.values()].reduce((a, b) => a + b, 0);
	console.log(`Source: ${sqlitePath}`);
	for (const spec of TABLES) {
		console.log(`  ${spec.table}: ${sourceCounts.get(spec.table) ?? 0} rows`);
	}
	if (totalSource === 0) {
		console.log(
			"Source database is empty (0 rows in every table). Nothing to migrate.",
		);
		return;
	}

	const pg = new Client({ connectionString: databaseUrl });
	await pg.connect();
	try {
		const targetCounts = new Map<string, number>();
		for (const spec of TABLES) {
			const res = await pg.query(
				`SELECT COUNT(*)::int AS count FROM "${spec.table}"`,
			);
			targetCounts.set(spec.table, (res.rows[0] as Row).count as number);
		}
		const totalTarget = [...targetCounts.values()].reduce((a, b) => a + b, 0);
		console.log(
			`Target: ${totalTarget} rows total across ${TABLES.length} tables.`,
		);

		if (dryRun) {
			console.log("Dry run: no rows written.");
			return;
		}

		if (totalTarget > 0 && !overwrite) {
			console.log(
				"Target tables already contain data. Skipping copy (idempotent no-op).",
			);
			console.log(
				"Re-run with --overwrite to truncate the ported tables and re-copy.",
			);
			return;
		}

		if (totalTarget > 0 && overwrite) {
			const names = TABLES.map((s) => `"${s.table}"`).join(", ");
			await pg.query(`TRUNCATE TABLE ${names} CASCADE`);
			console.log(
				"Overwrote: truncated all ported tables (better-auth user table untouched).",
			);
		}

		const sqliteRw = new SqliteDatabase(sqlitePath, { readonly: true });
		let badDates = 0;
		let badJson = 0;
		let skippedPrefs = 0;
		let knownUserIds: Set<string> | null = null;

		for (const spec of TABLES) {
			const expected = sourceCounts.get(spec.table) ?? 0;
			if (expected === 0 || !existing.has(spec.table)) {
				console.log(`  ${spec.table}: 0 rows copied`);
				continue;
			}
			const cols = sqliteRw
				.query<{ name: string }, []>(`PRAGMA table_info("${spec.table}")`)
				.all()
				.map((c) => c.name);
			const rows = sqliteRw
				.query(`SELECT * FROM "${spec.table}"`)
				.all() as Row[];

			const dateCols = new Set(spec.dates ?? []);
			const boolCols = new Set(spec.bools ?? []);
			const jsonCols = new Set(spec.jsons ?? []);

			let filtered = rows;
			if (spec.table === "user_preferences") {
				if (!knownUserIds) {
					const res = await pg.query<{ id: string }>('SELECT id FROM "user"');
					knownUserIds = new Set(res.rows.map((r) => r.id));
				}
				const allowed = knownUserIds;
				filtered = rows.filter((r) => {
					const ok = allowed.has(String(r.user_id));
					if (!ok) skippedPrefs += 1;
					return ok;
				});
			}

			const values: unknown[][] = filtered.map((row) =>
				cols.map((col) => {
					const raw = row[col];
					if (dateCols.has(col)) {
						const d = toDate(raw);
						if (raw !== null && raw !== undefined && raw !== "" && d === null)
							badDates += 1;
						return d;
					}
					if (boolCols.has(col)) {
						const b = toBool(raw);
						if (b === null) return spec.fallbacks?.[col] ?? null;
						return b;
					}
					if (jsonCols.has(col)) {
						// NOTE: node-postgres serialises JS arrays as Postgres ARRAY
						// literals (invalid for jsonb), so always send a JSON string.
						const j = toJson(raw);
						if (j === undefined) {
							if (raw !== null && raw !== undefined && raw !== "") badJson += 1;
							const fallback = spec.fallbacks?.[col] ?? null;
							return fallback === null ? null : JSON.stringify(fallback);
						}
						return JSON.stringify(j);
					}
					if (
						(raw === null || raw === undefined) &&
						spec.fallbacks &&
						col in spec.fallbacks
					) {
						return spec.fallbacks[col];
					}
					return raw ?? null;
				}),
			);

			const quoted = cols.map((c) => `"${c}"`).join(", ");
			const CHUNK = 250;
			let inserted = 0;
			for (let i = 0; i < values.length; i += CHUNK) {
				const chunk = values.slice(i, i + CHUNK);
				const placeholders = chunk
					.map(
						(rowVals, r) =>
							`(${rowVals.map((_, c) => `$${r * rowVals.length + c + 1}`).join(", ")})`,
					)
					.join(", ");
				await pg.query(
					`INSERT INTO "${spec.table}" (${quoted}) VALUES ${placeholders}`,
					chunk.flat(),
				);
				inserted += chunk.length;
			}
			console.log(`  ${spec.table}: ${inserted} rows copied`);
		}
		sqliteRw.close();

		await pg.query(
			`UPDATE "series" SET "search_vector" = to_tsvector('simple', coalesce("title",'') || ' ' || coalesce("alternative_title",'') || ' ' || coalesce("description",''))`,
		);
		await pg.query(
			`UPDATE "anime_series" SET "search_vector" = to_tsvector('simple', coalesce("title",'') || ' ' || coalesce("alternative_title",'') || ' ' || coalesce("synopsis",''))`,
		);
		console.log("Backfilled search_vector for series + anime_series.");

		console.log(
			`Done. Unparseable dates coerced to NULL: ${badDates}. JSON fallbacks used: ${badJson}. user_preferences skipped (unknown user): ${skippedPrefs}.`,
		);
	} finally {
		await pg.end();
	}
}

await main();
