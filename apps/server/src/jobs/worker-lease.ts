import type { Database } from "@SyMi/db";
import { scrapeRuns } from "@SyMi/db/schema/index";
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../services";

export const WORKER_LEASE_DURATION_MS = 5 * 60 * 1_000;
const WORKER_HEARTBEAT_INTERVAL_MS = 30 * 1_000;

type ClaimMode = "start" | "resume" | "recovery";
type WorkerLease = { runId: string; token: string };

const activeRunWorkers = new Map<string, string>();
const workerLeaseContext = new AsyncLocalStorage<WorkerLease>();

function workerLeaseError(error: unknown) {
	const details = error as {
		name?: unknown;
		message?: unknown;
		code?: unknown;
	};
	const message =
		typeof details?.message === "string" ? details.message : String(error);
	return {
		name: typeof details?.name === "string" ? details.name : "Error",
		message: message
			.replace(/\b(?:libsql|https?):\/\/[^\s"'`]+/gi, "<database-url>")
			.replace(/\bpostgresql:\/\/[^\s"'`]+/gi, "<database-url>")
			.slice(0, 1_000),
		...(typeof details?.code === "string" || typeof details?.code === "number"
			? { code: details.code }
			: {}),
	};
}

export class RunSupersededError extends Error {
	constructor() {
		super("Worker scrape digantikan oleh proses resume baru");
		this.name = "RunSupersededError";
	}
}

function leaseDeadline(now: Date) {
	return new Date(now.getTime() + WORKER_LEASE_DURATION_MS);
}

/**
 * Atomically acquires an active run in the database. A local map is retained
 * only as a fast same-process ownership check; it is not the source of truth.
 */
export async function claimRunWorkerToken(
	runId: string,
	mode: ClaimMode = "start",
	database: Database = db,
) {
	const now = new Date();
	const workerToken = crypto.randomUUID();
	const expiredLease = or(
		isNull(scrapeRuns.workerToken),
		isNull(scrapeRuns.workerLeaseExpiresAt),
		lte(scrapeRuns.workerLeaseExpiresAt, now),
	);
	const claimableStatus =
		mode === "start"
			? eq(scrapeRuns.status, "queued")
			: mode === "resume"
				? or(
						eq(scrapeRuns.status, "queued"),
						eq(scrapeRuns.status, "paused"),
						and(eq(scrapeRuns.status, "running"), expiredLease),
					)
				: or(
						eq(scrapeRuns.status, "queued"),
						and(eq(scrapeRuns.status, "running"), expiredLease),
					);
	const claimed = await database
		.update(scrapeRuns)
		.set({
			status: "running",
			workerToken,
			workerLeaseExpiresAt: leaseDeadline(now),
			startedAt: now,
			finishedAt: null,
			updatedAt: now,
		})
		.where(and(eq(scrapeRuns.id, runId), claimableStatus, expiredLease))
		.returning({ id: scrapeRuns.id });
	if (!claimed[0]) return null;
	activeRunWorkers.set(runId, workerToken);
	return workerToken;
}

export function isRunWorkerCurrent(runId: string, token: string) {
	return activeRunWorkers.get(runId) === token;
}

export function currentRunWorkerLease(runId?: string) {
	const lease = workerLeaseContext.getStore();
	return lease && (!runId || lease.runId === runId) ? lease : null;
}

export async function renewRunWorkerLease(
	runId: string,
	token: string,
	database: Database = db,
) {
	const now = new Date();
	const renewed = await database
		.update(scrapeRuns)
		.set({
			workerLeaseExpiresAt: leaseDeadline(now),
			updatedAt: now,
		})
		.where(
			and(
				eq(scrapeRuns.id, runId),
				eq(scrapeRuns.status, "running"),
				eq(scrapeRuns.workerToken, token),
				gte(scrapeRuns.workerLeaseExpiresAt, now),
			),
		)
		.returning({ id: scrapeRuns.id });
	return Boolean(renewed[0]);
}

export async function renewRunWorkerLeaseWithDiagnostics(
	runId: string,
	token: string,
	database: Database = db,
) {
	try {
		return await renewRunWorkerLease(runId, token, database);
	} catch (error) {
		console.error("Run worker lease heartbeat failed", {
			runId,
			error: workerLeaseError(error),
		});
		return null;
	}
}

export function withRunWorkerLease<T>(
	runId: string,
	token: string,
	callback: () => Promise<T>,
	database: Database = db,
) {
	return workerLeaseContext.run({ runId, token }, async () => {
		let heartbeatInFlight = false;
		let reportedPendingHeartbeat = false;
		let heartbeatStopped = false;
		const heartbeat = setInterval(() => {
			if (heartbeatInFlight) {
				if (!reportedPendingHeartbeat) {
					reportedPendingHeartbeat = true;
					console.warn("Run worker lease heartbeat is still pending", {
						runId,
					});
				}
				return;
			}
			heartbeatInFlight = true;
			void renewRunWorkerLeaseWithDiagnostics(runId, token, database)
				.then((renewed) => {
					if (renewed === false) {
						activeRunWorkers.delete(runId);
						if (!heartbeatStopped)
							console.warn("Run worker lease ownership was lost", {
								runId,
							});
					}
				})
				.finally(() => {
					heartbeatInFlight = false;
					reportedPendingHeartbeat = false;
				});
		}, WORKER_HEARTBEAT_INTERVAL_MS);
		heartbeat.unref?.();
		try {
			return await callback();
		} finally {
			heartbeatStopped = true;
			clearInterval(heartbeat);
		}
	});
}

export async function releaseRunWorker(
	runId: string,
	token: string,
	database: Database = db,
) {
	if (activeRunWorkers.get(runId) === token) activeRunWorkers.delete(runId);
	const now = new Date();
	await database
		.update(scrapeRuns)
		.set({ workerToken: null, workerLeaseExpiresAt: null, updatedAt: now })
		.where(and(eq(scrapeRuns.id, runId), eq(scrapeRuns.workerToken, token)));
}

export async function updateOwnedRun(
	runId: string,
	token: string,
	values: Partial<typeof scrapeRuns.$inferInsert>,
	database: Database = db,
) {
	const now = new Date();
	const updated = await database
		.update(scrapeRuns)
		.set({
			...values,
			workerLeaseExpiresAt: leaseDeadline(now),
			updatedAt: now,
		})
		.where(
			and(
				eq(scrapeRuns.id, runId),
				eq(scrapeRuns.status, "running"),
				eq(scrapeRuns.workerToken, token),
				gte(scrapeRuns.workerLeaseExpiresAt, now),
			),
		)
		.returning({ id: scrapeRuns.id });
	return Boolean(updated[0]);
}

export async function finishOwnedRun(
	runId: string,
	token: string,
	values: Partial<typeof scrapeRuns.$inferInsert>,
	database: Database = db,
) {
	const now = new Date();
	const finished = await database
		.update(scrapeRuns)
		.set({
			...values,
			workerToken: null,
			workerLeaseExpiresAt: null,
			updatedAt: now,
		})
		.where(
			and(
				eq(scrapeRuns.id, runId),
				eq(scrapeRuns.status, "running"),
				eq(scrapeRuns.workerToken, token),
				gte(scrapeRuns.workerLeaseExpiresAt, now),
			),
		)
		.returning({ id: scrapeRuns.id });
	return Boolean(finished[0]);
}
