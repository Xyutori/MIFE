<script lang="ts">
	import { onMount } from "svelte";
	import {
		formatDateTimeId,
		type MediaSummary,
		requestJson,
	} from "#lib/admin.ts";
	import AdminNotice from "#lib/components/admin/AdminNotice.svelte";
	import ErrorState from "#lib/components/admin/ErrorState.svelte";
	import MediaIntegrityOverview from "#lib/components/admin/MediaIntegrityOverview.svelte";
	import ScrapeControls from "#lib/components/admin/ScrapeControls.svelte";
	import ScrapeHistoryList from "#lib/components/admin/ScrapeHistoryList.svelte";
	import ScrapeSourceList from "#lib/components/admin/ScrapeSourceList.svelte";
	import ScrapeWorkerList from "#lib/components/admin/ScrapeWorkerList.svelte";

	type Run = {
		id: string;
		kind: string;
		mode: string;
		status: string;
		currentStep: string | null;
		progressTotal: number;
		progressCompleted: number;
		progressFailed: number;
		createdAt: string;
		finishedAt: string | null;
		errorMessage: string | null;
		sourceKey: string | null;
		sourceName: string | null;
	};

	type ScrapeData = {
		runs: Run[];
		activeRunCount?: number;
		totalTitles: number | null;
		pendingImages: number | null;
		mediaSummary: MediaSummary | null;
		sources: Array<{
			sourceKey: string;
			sourceName: string;
			enabled: boolean;
			lastFullAt: string | null;
			lastSuccessAt: string | null;
			lastAttemptAt: string | null;
		}>;
	};

	const ACTIVE = new Set(["running", "queued", "paused"]);

	let scrapeData = $state<ScrapeData>({
		runs: [],
		totalTitles: null,
		pendingImages: null,
		mediaSummary: null,
		sources: [],
	});
	let expandedRunId = $state("");
	let runEvents = $state<Record<string, Array<{ id: string; level: string; message: string }>>>({});
	let loading = $state(true);
	let error = $state("");
	let notice = $state("");
	let busyAction = $state("");

	const activeRuns = $derived(
		scrapeData.runs.filter((run) => ACTIVE.has(run.status)),
	);
	const historyRuns = $derived(
		scrapeData.runs.filter((run) => !ACTIVE.has(run.status)).slice(0, 6),
	);
	const controlsBusy = $derived(
		busyAction === "scrape-incremental"
			? "incremental"
			: busyAction === "scrape-full"
				? "full"
				: busyAction === "images"
					? "media"
					: busyAction,
	);

	function progressOf(run: Run): number {
		if (run.progressTotal <= 0) return 0;
		return Math.min(
			100,
			Math.round((run.progressCompleted / run.progressTotal) * 100),
		);
	}

	function runTitle(run: Run): string {
		if (run.kind === "images") return "Simpan media";
		return `Metadata · ${run.sourceName ?? "sumber"} · ${run.mode === "full" ? "penuh" : "incremental"}`;
	}

	async function refresh(signal?: AbortSignal) {
		const scrapePayload = await requestJson<ScrapeData>(
			"/api/admin/scrapes?limit=20&workspace=comic",
			{ signal },
		);
		scrapeData = {
			runs: scrapePayload.runs ?? [],
			totalTitles: scrapePayload.totalTitles ?? null,
			pendingImages: scrapePayload.pendingImages ?? null,
			mediaSummary: scrapePayload.mediaSummary ?? null,
			sources: scrapePayload.sources ?? [],
		};
	}

	async function triggerScrape(mode: "incremental" | "full") {
		busyAction = `scrape-${mode}`;
		notice = "";
		try {
			await requestJson("/api/admin/scrapes", {
				method: "POST",
				body: JSON.stringify({ mode, workspace: "comic" }),
			});
			await refresh();
			notice = mode === "full" ? "Full scrape dimulai." : "Scrape dimulai.";
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Gagal memulai scrape.";
		} finally {
			busyAction = "";
		}
	}

	async function triggerImages() {
		busyAction = "images";
		notice = "";
		try {
			await requestJson("/api/admin/scrapes/images-download", {
				method: "POST",
				body: JSON.stringify({}),
			});
			await refresh();
			notice = "Penyimpanan gambar dimulai.";
		} catch (cause) {
			error =
				cause instanceof Error
					? cause.message
					: "Gagal memulai penyimpanan gambar.";
		} finally {
			busyAction = "";
		}
	}

	function findRun(id: string): Run | undefined {
		return scrapeData.runs.find((run) => run.id === id);
	}

	async function controlRun(
		run: Run,
		action: "pause" | "resume" | "cancel" | "retry",
	) {
		busyAction = `${action}-${run.id}`;
		try {
			await requestJson(
				`/api/admin/scrapes/${encodeURIComponent(run.id)}/${action}`,
				{
					method: "POST",
				},
			);
			notice =
				action === "pause"
					? "Scrape dijeda."
					: action === "resume"
						? "Scrape dilanjutkan."
						: action === "cancel"
							? "Scrape dibatalkan."
							: "Scrape diulang.";
			await refresh();
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : "Gagal mengubah scrape.";
		} finally {
			busyAction = "";
		}
	}

	function toggleWorker(id: string) {
		const run = findRun(id);
		if (run)
			void controlRun(run, run.status === "paused" ? "resume" : "pause");
	}

	function cancelWorker(id: string) {
		const run = findRun(id);
		if (run) void controlRun(run, "cancel");
	}

	function retryRun(id: string) {
		const run = findRun(id);
		if (run) void controlRun(run, "retry");
	}

	async function toggleRunDetails(runId: string) {
		if (expandedRunId === runId) {
			expandedRunId = "";
			return;
		}
		expandedRunId = runId;
		if (runEvents[runId]) return;
		try {
			const payload = await requestJson<{
				events?: Array<{ id: string; level: string; message: string }>;
			}>(`/api/admin/scrapes/${encodeURIComponent(runId)}`);
			runEvents = { ...runEvents, [runId]: payload.events ?? [] };
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Gagal memuat detail.";
		}
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
				if (active && (cause as Error)?.name !== "AbortError") {
					error =
						cause instanceof Error ? cause.message : "Server belum tersambung.";
				}
			} finally {
				if (active) {
					loading = false;
					timer = setTimeout(() => void poll(), 4000);
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
		<div class="mt-4 h-48 animate-pulse rounded-2xl bg-card" aria-hidden="true"></div>
		<span class="sr-only" role="status">Memuat scrape komik</span>
	</div>
{:else}
	<ScrapeControls
		busy={controlsBusy}
		onIncremental={() => void triggerScrape("incremental")}
		onFull={() => void triggerScrape("full")}
		onSaveMedia={() => void triggerImages()}
	/>

	<div class="mt-5">
		<MediaIntegrityOverview
			mediaSummary={scrapeData.mediaSummary}
			pendingMedia={scrapeData.pendingImages}
			showStats={false}
			showByType={false}
		/>
	</div>

	{#if notice}
		<div class="mt-4">
			<AdminNotice>{notice}</AdminNotice>
		</div>
	{/if}
	{#if error}
		<div class="mt-4">
			<ErrorState message={error} />
		</div>
	{/if}

	<div class="mt-5">
		<ScrapeWorkerList
			workers={activeRuns.map((run) => ({
				id: run.id,
				title: runTitle(run),
				subinfo: `${run.currentStep ?? run.status} · ${formatDateTimeId(run.createdAt)}`,
				progress: run.progressTotal > 0 ? progressOf(run) : null,
				paused: run.status === "paused",
				disabled: Boolean(busyAction),
			}))}
			onToggle={toggleWorker}
			onCancel={cancelWorker}
		/>
	</div>

	<div class="mt-5">
		<ScrapeHistoryList
			items={historyRuns.map((run) => ({
				id: run.id,
				title: runTitle(run),
				subinfo: `${run.status}${run.errorMessage ? ` · ${run.errorMessage}` : ""} · ${formatDateTimeId(run.createdAt)}`,
				canRetry: ["failed", "partial", "cancelled"].includes(run.status),
				disabled: Boolean(busyAction),
			}))}
			expandedId={expandedRunId}
			events={runEvents}
			onToggleDetail={(id) => void toggleRunDetails(id)}
			onRetry={retryRun}
		/>
	</div>

	<div class="mt-5">
		<ScrapeSourceList
			sources={scrapeData.sources.map((source) => ({
				key: source.sourceKey,
				name: source.sourceName,
				enabled: source.enabled,
				successLabel: formatDateTimeId(source.lastSuccessAt),
				fullLabel: formatDateTimeId(source.lastFullAt),
			}))}
		/>
	</div>
{/if}
