<script lang="ts">
	import { Database, ImageDown, LoaderCircle, RefreshCw } from "lucide-svelte";

	export type ScrapeControlsBusy = "" | "incremental" | "full" | "media";

	interface Props {
		busy?: ScrapeControlsBusy | string;
		disableScrape?: boolean;
		disableMedia?: boolean;
		title?: string;
		description?: string;
		onIncremental: () => void;
		onFull: () => void;
		onSaveMedia: () => void;
		onRefresh?: () => void;
	}

	let {
		busy = "",
		disableScrape = false,
		disableMedia = false,
		title = "Kontrol scrape",
		description = "Jalankan scrape incremental atau penuh, lalu simpan media.",
		onIncremental,
		onFull,
		onSaveMedia,
		onRefresh,
	}: Props = $props();

	const scrapeDisabled = $derived(busy !== "" || disableScrape);
	const mediaDisabled = $derived(busy !== "" || disableMedia);
</script>

<section class="rounded-3xl border bg-card p-4 sm:p-5" aria-label={title}>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<h2 class="font-bold text-lg">{title}</h2>
			<p class="mt-1 text-muted-foreground text-sm">{description}</p>
		</div>
		{#if onRefresh}
			<button
				type="button"
				onclick={onRefresh}
				disabled={busy !== ""}
				title="Muat ulang"
				aria-label="Muat ulang status"
				class="grid size-9 shrink-0 place-items-center rounded-xl border bg-background text-muted-foreground transition hover:text-foreground disabled:opacity-50"
			>
				<RefreshCw class="size-4" aria-hidden="true" />
			</button>
		{/if}
	</div>
	<div class="mt-4 flex flex-wrap gap-2">
		<button
			type="button"
			onclick={onIncremental}
			disabled={scrapeDisabled}
			class="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 font-bold text-primary-foreground text-sm transition disabled:opacity-50"
		>
			{#if busy === "incremental"}
				<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
				Menjalankan…
			{:else}
				<RefreshCw class="size-4" aria-hidden="true" />
				Scrape incremental
			{/if}
		</button>
		<button
			type="button"
			onclick={onFull}
			disabled={scrapeDisabled}
			class="inline-flex h-10 items-center gap-2 rounded-xl bg-secondary px-4 font-bold text-secondary-foreground text-sm transition disabled:opacity-50"
		>
			{#if busy === "full"}
				<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
				Menjalankan…
			{:else}
				<Database class="size-4" aria-hidden="true" />
				Scrape penuh
			{/if}
		</button>
		<button
			type="button"
			onclick={onSaveMedia}
			disabled={mediaDisabled}
			class="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 font-bold text-sm transition disabled:opacity-50"
		>
			{#if busy === "media"}
				<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
				Menyimpan…
			{:else}
				<ImageDown class="size-4" aria-hidden="true" />
				Simpan media
			{/if}
		</button>
	</div>
</section>
