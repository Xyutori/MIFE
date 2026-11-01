<script lang="ts">
import { requestJson } from "#lib/admin.ts";
import AdminNotice from "#lib/components/admin/AdminNotice.svelte";
import AdminSourceFormCard from "#lib/components/admin/AdminSourceFormCard.svelte";
import ErrorState from "#lib/components/admin/ErrorState.svelte";

type Tab = "comic" | "anime";

type Source = {
	id: string;
	key: string;
	name: string;
	baseUrl: string;
	prefix: string;
	requestDelayMs: number;
	enabled: boolean;
};

let tab = $state<Tab>("comic");
let sources = $state<Source[]>([]);
let loading = $state(true);
let busy = $state("");
let error = $state("");
let notice = $state("");

const tabs: Array<{ id: Tab; label: string }> = [
	{ id: "comic", label: "Comic" },
	{ id: "anime", label: "Anime" },
];

async function refresh(signal?: AbortSignal) {
	const endpoint =
		tab === "comic" ? "/api/v1/sources" : "/api/v1/anime/sources";
	const rows = await requestJson<Source[]>(endpoint, { signal });
	sources = rows;
}

function patchPath(source: Source): string {
	return tab === "anime"
		? `/api/admin/anime/sources/${encodeURIComponent(source.id)}`
		: `/api/admin/sources/${encodeURIComponent(source.id)}`;
}

async function saveSource(source: Source) {
	busy = source.id;
	error = "";
	try {
		await requestJson(patchPath(source), {
			method: "PATCH",
			body: JSON.stringify({
				baseUrl: source.baseUrl,
				prefix: source.prefix,
				enabled: source.enabled,
				requestDelayMs: source.requestDelayMs,
			}),
		});
		notice = `${source.name} tersimpan.`;
	} catch (cause) {
		error =
			cause instanceof Error
				? cause.message
				: `Sumber ${source.name} gagal disimpan.`;
	} finally {
		busy = "";
	}
}

$effect(() => {
	tab;
	loading = true;
	const controller = new AbortController();
	let active = true;
	void refresh(controller.signal)
		.then(() => {
			if (active) error = "";
		})
		.catch((cause: unknown) => {
			if (!active) return;
			if ((cause as Error)?.name === "AbortError") return;
			error = cause instanceof Error ? cause.message : "Sumber gagal dimuat.";
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

<div role="tablist" aria-label="Jenis sumber" class="mb-5 flex flex-wrap gap-2">
	{#each tabs as item (item.id)}
		<button
			type="button"
			role="tab"
			aria-selected={tab === item.id}
			onclick={() => (tab = item.id)}
			class="h-9 rounded-full px-4 font-bold text-xs {tab === item.id
				? 'bg-primary text-primary-foreground'
				: 'border border-border hover:bg-accent'}"
		>
			{item.label}
		</button>
	{/each}
</div>

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

{#if loading}
	<div class="grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Memuat sumber">
		{#each ["a", "b"] as card (card)}
			<div class="h-48 animate-pulse rounded-2xl bg-card" aria-hidden="true"></div>
		{/each}
		<span class="sr-only" role="status">Memuat sumber</span>
	</div>
{:else if sources.length === 0}
	<p class="rounded-2xl border border-dashed bg-card/60 p-8 text-center text-muted-foreground text-sm">
		Belum ada sumber.
	</p>
{:else}
	<div class="grid gap-4 lg:grid-cols-2">
		{#each sources as source (source.id)}
			<AdminSourceFormCard
				id={source.id}
				name={source.name}
				baseUrl={source.baseUrl}
				prefix={source.prefix}
				requestDelayMs={source.requestDelayMs}
				enabled={source.enabled}
				busy={busy === source.id}
				minimumDelay={tab === "anime" ? 500 : 250}
				onEnabledChange={(enabled) => {
					sources = sources.map((item) =>
						item.id === source.id ? { ...item, enabled } : item,
					);
				}}
				onFieldChange={(field, value) => {
					sources = sources.map((item) => {
						if (item.id !== source.id) return item;
						if (field === "baseUrl") return { ...item, baseUrl: value };
						if (field === "prefix") return { ...item, prefix: value };
						return { ...item, requestDelayMs: Number(value) };
					});
				}}
				onSubmit={(event) => {
					event.preventDefault();
					void saveSource(source);
				}}
			/>
		{/each}
	</div>
{/if}
