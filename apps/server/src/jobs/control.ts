import { scrapeEvents, scrapeRuns } from "@SyMi/db/schema/index";
import { and, eq, gte } from "drizzle-orm";
import { db } from "../services";
import { now } from "./common";
import {
	claimRunWorkerToken,
	currentRunWorkerLease,
	isRunWorkerCurrent,
	RunSupersededError,
	releaseRunWorker,
	renewRunWorkerLease,
} from "./worker-lease";

type ActiveRequest = { controller: AbortController; release: () => void };
const activeRequests = new Map<string, Set<ActiveRequest>>();

export { isRunWorkerCurrent, RunSupersededError, releaseRunWorker };

export class RunCancelledError extends Error {
	constructor() {
		super("Scrape dibatalkan pengguna");
		this.name = "RunCancelledError";
	}
}

export class RunStoppedError extends Error {
	constructor(status: string) {
		super(`Scrape tidak aktif (status: ${status})`);
		this.name = "RunStoppedError";
	}
}

export function isRunControlError(error: unknown) {
	return (
		error instanceof RunCancelledError ||
		error instanceof RunStoppedError ||
		error instanceof RunSupersededError
	);
}

export async function claimRunWorker(
	runId: string,
	mode: "start" | "resume" | "recovery" = "start",
) {
	clearRetryNotice(runId);
	return claimRunWorkerToken(runId, mode);
}

export function registerRunRequest(runId: string): ActiveRequest {
	const request: ActiveRequest = {
		controller: new AbortController(),
		release: () => {},
	};
	const requests = activeRequests.get(runId) ?? new Set<ActiveRequest>();
	requests.add(request);
	activeRequests.set(runId, requests);
	request.release = () => {
		requests.delete(request);
		if (requests.size === 0) activeRequests.delete(runId);
	};
	return request;
}

export function interruptRunRequests(runId: string, reason: string) {
	for (const request of activeRequests.get(runId) ?? []) {
		request.controller.abort(new Error(reason));
	}
}

export async function waitForRunResume(
	runId: string,
	workerToken?: string,
	options: { timeoutMs?: number } = {},
) {
	// Worker yang parkir saat paused tidak boleh gantung selamanya (mis. run
	// di-pause lalu server restart tanpa recovery): resume via API selalu
	// men-spawn worker baru, jadi keluar setelah timeout adalah aman.
	const timeoutMs = options.timeoutMs ?? 30 * 60 * 1_000;
	const deadline = Date.now() + timeoutMs;
	while (true) {
		const token = workerToken ?? currentRunWorkerLease(runId)?.token;
		if (token && !isRunWorkerCurrent(runId, token))
			throw new RunSupersededError();
		const rows = await db
			.select({
				status: scrapeRuns.status,
				workerToken: scrapeRuns.workerToken,
			})
			.from(scrapeRuns)
			.where(eq(scrapeRuns.id, runId))
			.limit(1);
		const status = rows[0]?.status;
		if (status === "running" || status === "queued") {
			if (token && rows[0]?.workerToken !== token)
				throw new RunSupersededError();
			if (token && !(await renewRunWorkerLease(runId, token)))
				throw new RunSupersededError();
			return;
		}
		if (status === "cancelled") throw new RunCancelledError();
		if (status !== "paused") throw new RunStoppedError(status ?? "not found");
		// Pause/cancel selalu membersihkan workerToken di DB (pauseRun/cancelRun
		// di routes/scrapes.ts), jadi worker lama yang token-nya sudah tidak
		// cocok — termasuk token yang di-null-kan — harus BERHENTI, bukan parkir.
		// Parkir hanya aman bila DB masih memegang token kita (tidak terjadi
		// pada jeda normal); resume selalu men-spawn worker baru sehingga worker
		// lama wajib keluar agar tidak duplikat dan log berhenti.
		if (token && rows[0]?.workerToken !== token) throw new RunSupersededError();
		if (Date.now() >= deadline)
			throw new RunStoppedError("paused: batas tunggu resume terlampaui");
		await Bun.sleep(750);
	}
}

const lastRetryNotice = new Map<string, { attempt: number; at: number }>();

export async function reportNetworkRetry(
	runId: string,
	sourceName: string,
	attempt: number,
	delayMs: number,
	maxRetries: number,
	reason?: string,
) {
	const at = Date.now();
	const key = `${runId}:${sourceName}`;
	const previous = lastRetryNotice.get(key);
	if (previous && attempt % 5 !== 0 && at - previous.at < 60_000) {
		lastRetryNotice.set(key, { attempt, at: previous.at });
		return;
	}
	lastRetryNotice.set(key, { attempt, at });

	const detail = reason ? ` (${reason})` : "";
	const message = `Koneksi ke ${sourceName} bermasalah${detail}; percobaan ${attempt}/${maxRetries + 1}, mencoba lagi`;
	const timestamp = now();
	const lease = currentRunWorkerLease(runId);
	if (!lease) return;
	// Pelaporan progres tidak boleh menggagalkan retry jaringan — tapi error
	// DB tidak boleh ditelan diam-diam: catat via console agar terlihat.
	try {
		const active = await db
			.update(scrapeRuns)
			.set({
				currentStep: message,
				workerLeaseExpiresAt: new Date(Date.now() + 2 * 60 * 1_000),
				updatedAt: timestamp,
			})
			.where(
				and(
					eq(scrapeRuns.id, runId),
					eq(scrapeRuns.status, "running"),
					eq(scrapeRuns.workerToken, lease.token),
					gte(scrapeRuns.workerLeaseExpiresAt, timestamp),
				),
			)
			.returning({ id: scrapeRuns.id });
		if (!active[0]) return;
		await db.insert(scrapeEvents).values({
			id: crypto.randomUUID(),
			runId,
			level: "warning",
			message,
			detailsJson: {
				attempt,
				maxAttempts: maxRetries + 1,
				retryInMs: delayMs,
				reason,
			},
			createdAt: timestamp,
			updatedAt: timestamp,
		});
	} catch (error) {
		console.warn("Network retry progress report failed", {
			runId,
			source: sourceName,
			error:
				error instanceof Error
					? error.message.slice(0, 500)
					: String(error).slice(0, 500),
		});
	}
}

export function clearRetryNotice(runId: string, sourceName?: string) {
	if (sourceName) {
		lastRetryNotice.delete(`${runId}:${sourceName}`);
		return;
	}
	for (const key of lastRetryNotice.keys()) {
		if (key.startsWith(`${runId}:`)) lastRetryNotice.delete(key);
	}
}
