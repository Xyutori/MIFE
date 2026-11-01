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
		dailyTimes: string[];
		batchSize: number;
		batchConcurrency: number;
		incrementalMaxPages: number;
	};
	sources: Record<string, SettingSource>;
};

const MAX_SLOTS = 12;

const FIELD_LABELS: Record<string, string> = {
	timeZone: "Zona waktu",
	dailyTimes: "Jam scrape harian",
	batchSize: "Ukuran batch",
	batchConcurrency: "Konkurensi batch",
	incrementalMaxPages: "Maks. halaman incremental",
};

let values = $state<SettingsPayload["values"] | null>(null);
let keySources = $state<Record<string, SettingSource>>({});
let drafts = $state<Record<string, string>>({});
let slots = $state<string[]>([]);
let newSlot = $state("");
let loading = $state(true);
let saving = $state(false);
let error = $state("");
let notice = $state("");

function sourceBadge(source: SettingSource | undefined): string {
	return source === "db" ? "Database" : "Default";
}

function sortedSlots(list: string[]): string[] {
	return [...list].sort();
}

function addSlot() {
	const cleaned = newSlot.trim();
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cleaned)) {
		error = "Format jam harus HH:MM 24 jam (mis. 07:00).";
		return;
	}
	error = "";
	if (!slots.includes(cleaned)) slots = sortedSlots([...slots, cleaned]);
	newSlot = "";
}

function removeSlot(target: string) {
	slots = slots.filter((slot) => slot !== target);
}

function updateSlot(index: number, value: string) {
	const cleaned = value.trim();
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cleaned)) return;
	slots = sortedSlots(slots.map((slot, i) => (i === index ? cleaned : slot)));
}

async function refresh(signal?: AbortSignal) {
	const payload = await requestJson<SettingsPayload>(
		"/api/admin/scrape-settings",
		{ signal },
	);
	values = payload.values;
	keySources = payload.sources;
	slots = [...payload.values.dailyTimes];
	newSlot = "";
	drafts = {
		timeZone: payload.values.timeZone,
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
		const body: Record<string, string | number | string[]> = {};
		for (const [key, draft] of Object.entries(drafts)) {
			const current = String(values[key as keyof typeof values]);
			if (draft.trim() === current) continue;
			body[key] = key === "timeZone" ? draft.trim() : Number(draft);
		}
		if (
			sortedSlots(slots).join(",") !== sortedSlots(values.dailyTimes).join(",")
		) {
			if (slots.length === 0) {
				error = "Minimal satu jadwal jam harus ada.";
				saving = false;
				return;
			}
			body.dailyTimes = sortedSlots(slots);
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
		slots = [...payload.values.dailyTimes];
		newSlot = "";
		drafts = {
			timeZone: payload.values.timeZone,
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
						{#if key === "dailyTimes"}
							<div class="block sm:col-span-2">
								<span class="mb-1.5 flex items-center gap-2 text-muted-foreground text-xs">
									{label}
									<span
										class="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px]"
									>
										{sourceBadge(keySources[key])}
									</span>
								</span>
								<ul class="flex flex-wrap gap-2">
									{#each slots as slot, index (slot)}
										<li class="flex items-center gap-1.5 rounded-xl border border-border bg-background py-1 pr-1 pl-2.5">
											<input
												type="time"
												value={slot}
												onchange={(event) => updateSlot(index, event.currentTarget.value)}
												aria-label={`Jadwal ${index + 1}`}
												class="bg-transparent text-sm outline-none"
											/>
											<button
												type="button"
												onclick={() => removeSlot(slot)}
												disabled={slots.length <= 1}
												aria-label={`Hapus jadwal ${slot}`}
												title="Hapus jadwal"
												class="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
											>
												×
											</button>
										</li>
									{/each}
								</ul>
								{#if slots.length < MAX_SLOTS}
									<div class="mt-2 flex items-center gap-2">
										<input
											type="time"
											bind:value={newSlot}
											aria-label="Jam baru"
											class="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
										/>
										<button
											type="button"
											onclick={addSlot}
											disabled={!newSlot}
											class="inline-flex h-10 items-center rounded-xl border px-4 font-semibold text-sm transition hover:bg-accent disabled:opacity-50"
										>
											Tambah jadwal
										</button>
									</div>
								{/if}
								<p class="mt-1.5 text-muted-foreground text-[11px]">
									Scrape otomatis berjalan tiap hari pada jam-jam di atas
									(maksimal {MAX_SLOTS} jadwal).
								</p>
							</div>
						{:else}
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
									inputmode={key === "timeZone" ? "text" : "numeric"}
									class="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
								/>
							</label>
						{/if}
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
