import { scrapeEvents, scrapeRuns } from "@SyMi/db/schema/index";
import { eq } from "drizzle-orm";
import { db } from "../services";
import {
	currentRunWorkerLease,
	finishOwnedRun,
	RunSupersededError,
	updateOwnedRun,
} from "./worker-lease";

export type RunKind = "metadata" | "images";
export type RunMode = "full" | "incremental";
export type RunTrigger = "manual" | "scheduler";
export type RunStatus =
	| "queued"
	| "running"
	| "paused"
	| "cancelled"
	| "completed"
	| "partial"
	| "failed";

export const now = () => new Date();

export async function beginRun(options: {
	workspaceId: string;
	sourceId?: string | null;
	jobKey: string;
	kind: RunKind;
	mode?: RunMode;
	triggeredBy: RunTrigger;
	summary?: unknown;
}) {
	const active = await db
		.select()
		.from(scrapeRuns)
		.where(eq(scrapeRuns.jobKey, options.jobKey))
		.limit(1);
	if (active[0]) return { run: active[0], created: false };

	const at = now();
	const runId = crypto.randomUUID();
	const rows = await db
		.insert(scrapeRuns)
		.values({
			id: runId,
			workspaceId: options.workspaceId,
			sourceId: options.sourceId ?? null,
			jobKey: options.jobKey,
			kind: options.kind,
			mode: options.mode ?? "incremental",
			status: "queued",
			triggeredBy: options.triggeredBy,
			progressTotal: 0,
			progressCompleted: 0,
			progressFailed: 0,
			currentStep: "Menunggu worker",
			summaryJson: safeJson(options.summary ?? {}),
			createdAt: at,
			updatedAt: at,
		})
		.onConflictDoNothing()
		.returning();

	if (rows[0]) return { run: rows[0], created: true };
	const raced = await db
		.select()
		.from(scrapeRuns)
		.where(eq(scrapeRuns.jobKey, options.jobKey))
		.limit(1);
	if (raced[0]) return { run: raced[0], created: false };
	throw new Error("Tidak dapat membuat scrape run");
}

export async function addRunEvent(
	runId: string,
	message: string,
	options: { level?: string; details?: unknown } = {},
) {
	const at = now();
	await db.insert(scrapeEvents).values({
		id: crypto.randomUUID(),
		runId,
		level: options.level ?? "info",
		message,
		detailsJson: safeJson(options.details ?? {}),
		createdAt: at,
		updatedAt: at,
	});
}

export function safeJson(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value))
		return value as Record<string, unknown>;
	try {
		const parsed = JSON.parse(JSON.stringify(value ?? {})) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** Read a jsonb column that may hold an object or a legacy JSON string. */
export function readJsonObject(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value))
		return value as Record<string, unknown>;
	if (typeof value === "string") {
		try {
			return readJsonObject(JSON.parse(value) as unknown);
		} catch {
			return {};
		}
	}
	return {};
}

export async function updateRun(
	runId: string,
	values: Partial<typeof scrapeRuns.$inferInsert>,
) {
	const lease = currentRunWorkerLease(runId);
	if (!lease) throw new RunSupersededError();
	if (!(await updateOwnedRun(runId, lease.token, values)))
		throw new RunSupersededError();
}

export async function finishRun(
	runId: string,
	status: Extract<RunStatus, "completed" | "partial" | "failed">,
	values: {
		errorMessage?: string | null;
		summary?: unknown;
		currentStep?: string;
	} = {},
) {
	const lease = currentRunWorkerLease(runId);
	if (!lease) throw new RunSupersededError();
	const finished = await finishOwnedRun(runId, lease.token, {
		status,
		jobKey: null,
		finishedAt: now(),
		errorMessage: values.errorMessage ?? null,
		currentStep:
			values.currentStep ??
			(status === "completed"
				? "Selesai"
				: status === "partial"
					? "Selesai dengan sebagian error"
					: "Gagal"),
		summaryJson: safeJson(values.summary ?? {}),
	});
	if (!finished) throw new RunSupersededError();
}
