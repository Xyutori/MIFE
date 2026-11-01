<script lang="ts">
import { onMount } from "svelte";
import {
	formatDateTimeId,
	requestJson,
} from "#lib/admin.ts";
import ScrapeControls from "#lib/components/admin/ScrapeControls.svelte";
import ScrapeHistoryList from "#lib/components/admin/ScrapeHistoryList.svelte";
import ScrapeWorkerList from "#lib/components/admin/ScrapeWorkerList.svelte";

// Job Super Komik.
// Kontrak server MIFE (kanonis /api/admin untuk tulis; startMetadataScrapes
// dan startImageDownload mendukung workspace "superkomik"):
// - GET /api/admin/scrapes?limit=8&workspace=superkomik -> { runs, total }
//   (diadaptasi ke bentuk Job di bawah; tanpa ringkasan media)
// - POST /api/admin/scrapes { mode, workspace: "superkomik" }
// - POST /api/admin/scrapes/images-download { workspace: "superkomik" }
// - POST /api/admin/scrapes/:id/pause|resume|cancel|retry

type Job = {
	id: string;
	kind: "metadata" | "images";
	mode: string;
	status: string;
	progressTotal: number;
	progressCompleted: number;
	progressFailed: number;
	currentStep: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	errorMessage: string | null;
	summaryJson: string;
	createdAt: string;
	sourceName: string | null;
};

type ScrapeRunRow = {
	id: string;
	kind: "metadata" | "images";
	mode: string;
	status: string;
	progressTotal: number;
	progressCompleted: number;
	progressFailed: number;
	currentStep: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	errorMessage: string | null;
	summary?: unknown;
	summaryJson?: unknown;
	createdAt: string;
	sourceName: string | null;
};

const ACTIVE = new Set(["queued", "running", "paused"]);
const RETRYABLE = new Set(["partial", "failed", "cancelled"]);

function toSummaryJson(run: ScrapeRunRow): string {
	const value = run.summary ?? run.summaryJson ?? {};
	return typeof value === "string" ? value : JSON.stringify(value);
}

let jobs = $state<Job[]>([]);
let loading = $state(true);
let busy = $state("");
let error = $state("");

const activeJobs = $derived(jobs.filter((job) => ACTIVE.has(job.status)));
const historyJobs = $derived(jobs.filter((job) => !ACTIVE.has(job.status)));

function jobName(job: Job): string {
	return job.kind === "metadata"
		? `Metadata · ${job.mode === "full" ? "penuh" : "incremental"}`
		: "Simpan media";
}

function progressOf(job: Job): number {
	if (!job.progressTotal) return 0;
	return Math.min(
		100,
		Math.round((job.progressCompleted / job.progressTotal) * 100),
	);
}

function parseSummary(value: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function jobSubinfo(job: Job): string {
	const head = job.currentStep ?? job.errorMessage ?? job.status;
	const counts = `${job.progressCompleted}/${job.progressTotal} selesai · ${job.progressFailed} gagal`;
	const when = formatDateTimeId(job.startedAt ?? job.createdAt);
	if (job.kind === "metadata") {
		const summary = parseSummary(job.summaryJson);
		if (typeof summary.readerUrlAttempted === "number") {
			return `${head} · ${counts} · baca ${String(summary.readerUrlSucceeded ?? 0)}/${String(summary.readerUrlAttempted)} · ${when}`;
		}
	}
	if (job.kind === "images") {
		const summary = parseSummary(job.summaryJson);
		if (typeof summary.savedCount === "number") {
			return `${head} · ${counts} · tersimpan ${Number(summary.savedCount).toLocaleString("id-ID")} · ${when}`;
		}
	}
	return `${head} · ${counts} · ${when}`;
}

async function refresh() {
	try {
		const data = await requestJson<{ runs: ScrapeRunRow[] }>(
			"/api/admin/scrapes?limit=8&workspace=superkomik",
		);
		jobs = (data.runs ?? []).map((run) => ({
			id: run.id,
			kind: run.kind,
			mode: run.mode,
			status: run.status,
			progressTotal: run.progressTotal,
			progressCompleted: run.progressCompleted,
			progressFailed: run.progressFailed,
			currentStep: run.currentStep,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			errorMessage: run.errorMessage,
			summaryJson: toSummaryJson(run),
			createdAt: run.createdAt,
			sourceName: run.sourceName,
		}));
		error = "";
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "Status job gagal dimuat.";
	} finally {
		loading = false;
	}
}

async function request(path: string, body?: unknown, busyKey = "job") {
	busy = busyKey;
	try {
		await requestJson(path, {
			method: "POST",
			body: body ? JSON.stringify(body) : undefined,
		});
		error = "";
		await refresh();
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "Aksi job gagal.";
	} finally {
		busy = "";
	}
}

function findJob(id: string): Job | undefined {
	return jobs.find((job) => job.id === id);
}

function toggleWorker(id: string) {
	const job = findJob(id);
	if (job)
		void request(
			`/api/admin/scrapes/${encodeURIComponent(job.id)}/${job.status === "paused" ? "resume" : "pause"}`,
		);
}

function cancelWorker(id: string) {
	const job = findJob(id);
	if (job)
		void request(`/api/admin/scrapes/${encodeURIComponent(job.id)}/cancel`);
}

function retryJob(id: string) {
	const job = findJob(id);
	if (job)
		void request(`/api/admin/scrapes/${encodeURIComponent(job.id)}/retry`);
}

onMount(() => {
	void refresh();
	const timer = setInterval(() => void refresh(), 5000);
	return () => clearInterval(timer);
});
</script>

{#if loading}
	<div aria-busy="true">
		<div class="h-24 animate-pulse rounded-2xl bg-card" aria-hidden="true"></div>
		<div
			class="mt-4 h-48 animate-pulse rounded-2xl bg-card"
			aria-hidden="true"
		></div>
		<span class="sr-only" role="status">Memuat panel scrape</span>
	</div>
{:else}
	<ScrapeControls
		busy={busy}
		onIncremental={() =>
			void request(
				"/api/admin/scrapes",
				{ mode: "incremental", workspace: "superkomik" },
				"incremental",
			)}
		onFull={() =>
			void request(
				"/api/admin/scrapes",
				{ mode: "full", workspace: "superkomik" },
				"full",
			)}
		onSaveMedia={() =>
			void request(
				"/api/admin/scrapes/images-download",
				{ workspace: "superkomik" },
				"media",
			)}
	/>

	{#if error}
		<p
			role="alert"
			class="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm"
		>
			{error}
		</p>
	{/if}

	<div class="mt-5">
		<ScrapeWorkerList
			workers={activeJobs.map((job) => ({
				id: job.id,
				title: jobName(job),
				subinfo: jobSubinfo(job),
				progress: job.progressTotal > 0 ? progressOf(job) : null,
				paused: job.status === "paused",
				disabled: Boolean(busy),
			}))}
			onToggle={toggleWorker}
			onCancel={cancelWorker}
		/>
	</div>

	<div class="mt-5">
		<ScrapeHistoryList
			items={historyJobs.map((job) => ({
				id: job.id,
				title: jobName(job),
				subinfo: jobSubinfo(job),
				canRetry: RETRYABLE.has(job.status),
				disabled: Boolean(busy),
			}))}
			expandedId=""
			events={{}}
			showDetail={false}
			onToggleDetail={() => {}}
			onRetry={retryJob}
		/>
	</div>
{/if}
