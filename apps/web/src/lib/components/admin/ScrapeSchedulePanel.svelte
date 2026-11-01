<script lang="ts">
import { onMount } from "svelte";
import { requestJson } from "#lib/admin.ts";
import AdminNotice from "#lib/components/admin/AdminNotice.svelte";
import AdminPanel from "#lib/components/admin/AdminPanel.svelte";
import ErrorState from "#lib/components/admin/ErrorState.svelte";

type SettingSource = "db" | "default";

type SettingsPayload = {
	values: {
		timeZone: string;
		dailyTime: string;
		batchSize: number;
		batchConcurrency: number;
		incrementalMaxPages: number;
	};
	sources: Record<string, SettingSource>;
};

const FIELD_LABELS: Record<string, string> = {
	timeZone: "Zona waktu",
	dailyTime: "Jam scrape harian",
	batchSize: "Ukuran batch",
	batchConcurrency: "Konkurensi batch",
	incrementalMaxPages: "Maks. halaman incremental",
};

let values = $state<SettingsPayload["values"] | null>(null);
let keySources = $state<Record<string, SettingSource>>({});
let drafts = $state<Record<string, string>>({});
let loading = $state(true);
let saving = $state(false);
let error = $state("");
let notice = $state("");

function sourceBadge(source: SettingSource | undefined): string {
	return source === "db" ? "Database" : "Default";
}

async function refresh(signal?: AbortSignal) {
	const payload = await requestJson<SettingsPayload>(
		"/api/admin/scrape-settings",
		{ signal },
	);
	values = payload.values;
	keySources = payload.sources;
	drafts = {
		timeZone: payload.values.timeZone,
		dailyTime: payload.values.dailyTime,
		batchSize: String(payload.values.batchSize),
		batchConcurrency: String(payload.values.batchConcurrency),
		incrementalMaxPages: String(payload.values.incrementalMaxPages),
	};
}

async function saveSettings(event: SubmitEvent) {
	event.preventDefault();
	if (!values) return;
	saving = true;
	error = "";
	notice = "";
	try {
		const body: Record<string, string | number> = {};
		for (const [key, draft] of Object.entries(drafts)) {
			const current = String(values[key as keyof typeof values]);
			if (draft.trim() === current) continue;
			body[key] =
				key === "timeZone" || key === "dailyTime"
					? draft.trim()
					: Number(draft);
		}
		if (Object.keys(body).length === 0) {
			notice = "Tidak ada perubahan.";
			return;
		}
		const payload = await requestJson<SettingsPayload>(
			"/api/admin/scrape-settings",
			{ method: "PUT", body: JSON.stringify(body) },
		);
		values = payload.values;
		keySources = payload.sources;
		drafts = {
			timeZone: payload.values.timeZone,
			dailyTime: payload.values.dailyTime,
			batchSize: String(payload.values.batchSize),
			batchConcurrency: String(payload.values.batchConcurrency),
			incrementalMaxPages: String(payload.values.incrementalMaxPages),
		};
		notice = "Pengaturan tersimpan.";
	} catch (cause) {
		error =
			cause instanceof Error ? cause.message : "Pengaturan gagal disimpan.";
	} finally {
		saving = false;
	}
}

onMount(() => {
	let active = true;
	const controller = new AbortController();
	void refresh(controller.signal)
		.then(() => {
			if (active) error = "";
		})
		.catch((cause: unknown) => {
			if (!active) return;
			if ((cause as Error)?.name === "AbortError") return;
			error =
				cause instanceof Error ? cause.message : "Pengaturan gagal dimuat.";
		})
		.finally(() => {
			if (active) loading = false;
		});
	return () => {
		active = false;
		controller.abort();
	};
});
</script>

{#if loading}
	<div aria-busy="true">
		<div class="h-24 animate-pulse rounded-2xl bg-card" aria-hidden="true"></div>
		<span class="sr-only" role="status">Memuat pengaturan scrape</span>
	</div>
{:else}
	{#if notice}
		<div class="mb-4">
			<AdminNotice>{notice}</AdminNotice>
		</div>
	{/if}
	{#if error}
		<div class="mb-4">
			<ErrorState message={error} />
		</div>
	{/if}

	<AdminPanel title="Pengaturan scrape">
		{#if values}
			<form onsubmit={saveSettings} aria-label="Pengaturan scrape">
				<div class="grid gap-4 sm:grid-cols-2">
					{#each Object.entries(FIELD_LABELS) as [key, label] (key)}
						{@const draft = drafts[key] ?? ""}
						<label class="block">
							<span class="mb-1.5 flex items-center gap-2 text-muted-foreground text-xs">
								{label}
								<span
									class="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px]"
								>
									{sourceBadge(keySources[key])}
								</span>
							</span>
							<input
								value={draft}
								oninput={(event) => {
									drafts = { ...drafts, [key]: event.currentTarget.value };
								}}
								placeholder={String(values[key as keyof typeof values])}
								aria-label={label}
								inputmode={key === "timeZone" || key === "dailyTime"
									? "text"
									: "numeric"}
								class="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
							/>
						</label>
					{/each}
				</div>
				<button
					type="submit"
					disabled={saving}
					class="mt-4 inline-flex h-10 items-center rounded-xl bg-primary px-5 font-semibold text-primary-foreground text-sm disabled:opacity-50"
				>
					{saving ? "Menyimpan…" : "Simpan"}
				</button>
			</form>
		{/if}
	</AdminPanel>
{/if}
