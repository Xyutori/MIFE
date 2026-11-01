<script lang="ts">
import { onMount } from "svelte";
import {
	formatDateTimeId,
	requestJson,
	type ScrapeEvent,
	type ScrapeRun,
} from "#lib/admin.ts";
import ScrapeControls from "#lib/components/admin/ScrapeControls.svelte";
import ScrapeHistoryList, {
	type ScrapeHistoryEvent,
} from "#lib/components/admin/ScrapeHistoryList.svelte";
import ScrapeSourceList from "#lib/components/admin/ScrapeSourceList.svelte";
import ScrapeWorkerList from "#lib/components/admin/ScrapeWorkerList.svelte";

type ScrapesPayload = {
	runs?: ScrapeRun[];
	sources?: Array<{
		sourceKey: string;
		sourceName: string;
		enabled: boolean;
		lastSuccessAt: string | null;
		lastFullAt: string | null;
	}>;
};
type RunDetail = { events?: ScrapeEvent[] };

let runs = $state<ScrapeRun[]>([]);
let scrapeSources = $state<ScrapesPayload["sources"]>([]);
let details = $state<Record<string, ScrapeHistoryEvent[]>>({});
let expandedRunId = $state("");
let busy = $state("");
let loading = $state(true);
let error = $state("");
let notice = $state("");

const activeRuns = $derived(
	runs.filter((run) => ["queued", "running", "paused"].includes(run.status)),
);
const historyRuns = $derived(
	runs.filter((run) => !["queued", "running", "paused"].includes(run.status)),
);

function progressOf(run: ScrapeRun): number {
	if (run.progressTotal <= 0) return 0;
	return Math.min(
		100,
		Math.round((run.progressCompleted / run.progressTotal) * 100),
	);
}

async function refresh(signal?: AbortSignal) {
	const scrapeData = await requestJson<ScrapesPayload>(
		"/api/admin/scrapes?limit=50&workspace=anime",
		{ signal },
	);
	runs = scrapeData.runs ?? [];
	scrapeSources = scrapeData.sources ?? [];
}

async function start(mode: "full" | "incremental") {
	busy = mode;
	error = "";
	notice = "";
	try {
		await requestJson("/api/admin/scrapes", {
			method: "POST",
			body: JSON.stringify({ mode, workspace: "anime" }),
		});
		await refresh();
		notice =
			mode === "full" ? "Scrape penuh dimulai." : "Scrape incremental dimulai.";
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "Scrape gagal dimulai.";
	} finally {
		busy = "";
	}
}

async function saveImages() {
	busy = "media";
	error = "";
	try {
		await requestJson("/api/admin/scrapes/images-download", {
			method: "POST",
			body: JSON.stringify({ workspace: "anime" }),
		});
		await refresh();
		notice = "Penyimpanan thumbnail dimulai.";
	} catch (cause) {
		error =
			cause instanceof Error
				? cause.message
				: "Penyimpanan thumbnail gagal dimulai.";
	} finally {
		busy = "";
	}
}

async function control(
	run: ScrapeRun,
	action: "pause" | "resume" | "cancel" | "retry",
) {
	busy = `${run.id}:${action}`;
	error = "";
	try {
		await requestJson(`/api/admin/scrapes/${run.id}/${action}`, {
			method: "POST",
		});
		await refresh();
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "Kontrol scrape gagal.";
	} finally {
		busy = "";
	}
}

function findRun(id: string): ScrapeRun | undefined {
	return runs.find((run) => run.id === id);
}

function toggleWorker(id: string) {
	const run = findRun(id);
	if (run) void control(run, run.status === "paused" ? "resume" : "pause");
}

function cancelWorker(id: string) {
	const run = findRun(id);
	if (run) void control(run, "cancel");
}

function retryRun(id: string) {
	const run = findRun(id);
	if (run) void control(run, "retry");
}

async function toggleDetails(runId: string) {
	if (expandedRunId === runId) {
		expandedRunId = "";
		return;
	}
	expandedRunId = runId;
	if (details[runId]) return;
	try {
		const payload = await requestJson<RunDetail>(`/api/admin/scrapes/${runId}`);
		details = {
			...details,
			[runId]: (payload.events ?? []).map((event) => ({
				id: event.id,
				level: event.level,
				message: event.message,
			})),
		};
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "Detail run gagal dimuat.";
	}
}

function runTitle(run: ScrapeRun): string {
	if (run.kind === "images") return "Simpan media";
	return `Metadata · ${run.sourceName} · ${run.mode === "full" ? "penuh" : "incremental"}`;
}

onMount(() => {
	let active = true;
	let timer: ReturnType<typeof setTimeout>;
	let controller: AbortController | null = null;
	const poll = async () => {
		controller = new AbortController();
		try {
			await refresh(controller.signal);
			if (active) error = "";
		} catch (cause) {
			if (active && (cause as Error)?.name !== "AbortError")
				error =
					cause instanceof Error ? cause.message : "Server belum tersambung.";
		} finally {
			if (active) {
				loading = false;
				timer = setTimeout(() => void poll(), 5000);
			}
		}
	};
	void poll();
	return () => {
		active = false;
		controller?.abort();
		clearTimeout(timer);
	};
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
		onIncremental={() => void start("incremental")}
		onFull={() => void start("full")}
		onSaveMedia={() => void saveImages()}
	/>

	{#if error}
		<p
			role="alert"
			class="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm"
		>
			{error}
		</p>
	{/if}
	{#if notice}
		<p
			role="status"
			class="mt-4 rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-primary text-sm"
		>
			{notice}
		</p>
	{/if}

	<div class="mt-5">
		<ScrapeWorkerList
			workers={activeRuns.map((run) => ({
				id: run.id,
				title: runTitle(run),
				subinfo: `${run.currentStep ?? run.status} · ${formatDateTimeId(run.createdAt)}`,
				progress: run.progressTotal > 0 ? progressOf(run) : null,
				paused: run.status === "paused",
				disabled: Boolean(busy),
			}))}
			onToggle={toggleWorker}
			onCancel={cancelWorker}
		/>
	</div>

	<div class="mt-5">
		<ScrapeHistoryList
			items={historyRuns.slice(0, 10).map((run) => ({
				id: run.id,
				title: runTitle(run),
				subinfo: `${run.status}${run.errorMessage ? ` · ${run.errorMessage}` : ""} · ${formatDateTimeId(run.createdAt)}`,
				canRetry: ["failed", "partial", "cancelled"].includes(run.status),
				disabled: Boolean(busy),
			}))}
			expandedId={expandedRunId}
			events={details}
			onToggleDetail={(id) => void toggleDetails(id)}
			onRetry={retryRun}
		/>
	</div>

	<div class="mt-5">
		<ScrapeSourceList
			sources={(scrapeSources ?? []).map((source) => ({
				key: source.sourceKey,
				name: source.sourceName,
				enabled: source.enabled,
				successLabel: formatDateTimeId(source.lastSuccessAt),
				fullLabel: formatDateTimeId(source.lastFullAt),
			}))}
		/>
	</div>
{/if}
