<script lang="ts">
import {
	Clapperboard,
	LoaderCircle,
	Search,
	SlidersHorizontal,
	X,
} from "lucide-svelte";
import { onMount } from "svelte";
import {
	type AnimeListItem,
	decodeEntities,
	requestJson,
} from "#lib/admin.ts";
import { apiBase, fetchJsonCached } from "#lib/api.ts";
import AnimeCard from "#lib/components/anime/AnimeCard.svelte";
import AnimeFilterPanel from "#lib/components/anime/AnimeFilterPanel.svelte";
import Pagination from "#lib/components/Pagination.svelte";

// Shape respons = GET /api/v1/anime/library (lihat
// apps/server/src/catalog/anime.ts `listAnime`): `isVisible` ikut
// terserialisasi tapi endpoint publik selalu true — badge disiapkan
// defensif bila backend admin kelak memakai includeHidden.
type AdminAnimeItem = AnimeListItem & { isVisible?: boolean };

type AnimeLibraryPayload = {
	items?: AdminAnimeItem[];
	total?: number;
};

let items = $state<AdminAnimeItem[]>([]);
let total = $state(0);
let page = $state(1);
let pageSize = $state(12);
let query = $state("");
let debouncedQuery = $state("");
let sort = $state("recent");
let genreInput = $state("");
let debouncedGenre = $state("");
let status = $state("");
let filterOpen = $state(false);
let filterDialog = $state<HTMLDialogElement | null>(null);
let loading = $state(true);
let error = $state("");
let thumbnailPreference = $state("local");

const pageCount = $derived(Math.max(1, Math.ceil(total / pageSize)));
const activeFilterCount = $derived((debouncedGenre ? 1 : 0) + (status ? 1 : 0));
const hasActiveFilter = $derived(
	Boolean(debouncedQuery) || activeFilterCount > 0,
);
const initialLoading = $derived(loading && items.length === 0);
const pageLoading = $derived(loading && items.length > 0);

let debounce: ReturnType<typeof setTimeout> | undefined;
$effect(() => {
	query;
	clearTimeout(debounce);
	debounce = setTimeout(() => {
		debouncedQuery = query.trim();
	}, 300);
});

let genreDebounce: ReturnType<typeof setTimeout> | undefined;
$effect(() => {
	genreInput;
	clearTimeout(genreDebounce);
	genreDebounce = setTimeout(() => {
		debouncedGenre = genreInput.trim();
	}, 300);
});

function thumbnailFor(item: AdminAnimeItem): string | null {
	const found =
		item.thumbnailSources.find(
			(source) => source.key === thumbnailPreference,
		) ??
		item.thumbnailSources.find((source) => source.key === "local") ??
		item.thumbnailSources[0];
	if (!found) return null;
	return found.url.startsWith("/") ? `${apiBase()}${found.url}` : found.url;
}

async function fetchAnimeCatalog(
	params: {
		page: number;
		pageSize: number;
		sort: string;
		q: string;
		genre: string;
		status: string;
	},
	signal?: AbortSignal,
): Promise<AnimeLibraryPayload> {
	const search = new URLSearchParams({
		page: String(params.page),
		pageSize: String(params.pageSize),
		sort: params.sort,
	});
	if (params.q) search.set("q", params.q);
	if (params.genre) search.set("genre", params.genre);
	if (params.status) search.set("status", params.status);
	return fetchJsonCached<AnimeLibraryPayload>(
		`${apiBase()}/api/v1/anime/library?${search}`,
		{ signal },
	);
}

onMount(() => {
	const controller = new AbortController();
	requestJson<{ settings?: { thumbnailSource?: string } }>(
		"/api/v1/anime/settings",
		{ signal: controller.signal },
	)
		.then((payload) => {
			thumbnailPreference = payload.settings?.thumbnailSource ?? "local";
		})
		.catch(() => undefined);
	return () => controller.abort();
});

$effect(() => {
	const params = {
		page,
		pageSize,
		sort,
		q: debouncedQuery,
		genre: debouncedGenre,
		status,
	};
	let active = true;
	const controller = new AbortController();
	loading = true;
	void fetchAnimeCatalog(params, controller.signal)
		.then((payload) => {
			if (!active) return;
			const anime = payload.items ?? [];
			const responseTotal = payload.total ?? 0;
			const responsePageCount = Math.max(
				1,
				Math.ceil(responseTotal / pageSize),
			);
			if (page > responsePageCount) {
				page = responsePageCount;
				return;
			}
			items = anime;
			total = responseTotal;
			error = "";
		})
		.catch((cause: unknown) => {
			if (!active) return;
			if (cause instanceof DOMException && cause.name === "AbortError") return;
			error = cause instanceof Error ? cause.message : "Katalog gagal dimuat.";
		})
		.finally(() => {
			if (active) loading = false;
		});
	return () => {
		active = false;
		controller.abort();
	};
});

function resetPage() {
	page = 1;
}

function resetFilters() {
	query = "";
	debouncedQuery = "";
	genreInput = "";
	debouncedGenre = "";
	status = "";
	resetPage();
}

$effect(() => {
	if (!filterDialog) return;
	if (filterOpen && !filterDialog.open) filterDialog.showModal();
	if (!filterOpen && filterDialog.open) filterDialog.close();
});

function closeFilter() {
	filterOpen = false;
}
</script>

{#if error}
	<div class="mb-4">
		<div
			class="rounded-2xl border border-destructive/30 bg-card p-6 text-muted-foreground text-sm"
			role="alert"
		>
			{error}
			<p class="mt-2 text-xs">Pastikan server MIFE sedang berjalan.</p>
		</div>
	</div>
{/if}

<section aria-label="Anime">
	<div class="mb-4 flex items-end justify-between gap-3">
		<div>
			<!-- Judul halaman dipegang shell di mobile: sembunyikan di mobile. -->
			<h2 class="hidden font-semibold text-xl lg:block">Anime</h2>
		</div>
	</div>

	<div class="catalog-search relative grid gap-2 grid-cols-[minmax(0,1fr)_3rem]">
		<label class="relative block">
			<Search class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
			<input
				type="search"
				bind:value={query}
				oninput={resetPage}
				placeholder="Cari judul anime…"
				aria-label="Cari judul anime"
				maxlength={120}
				class="h-12 w-full rounded-xl border border-border/80 bg-card pr-4 pl-11 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
			/>
		</label>
		<button
			type="button"
			onclick={() => (filterOpen = true)}
			aria-haspopup="dialog"
			class="relative inline-flex size-12 items-center justify-center rounded-xl border border-border/80 bg-card outline-none hover:bg-accent"
			aria-label="Filter anime"
			title="Filter anime"
		>
			<SlidersHorizontal class="size-5 text-muted-foreground" />
			{#if activeFilterCount > 0}
				<span
					class="absolute -top-1.5 -right-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 font-bold text-[11px] text-primary-foreground"
				>
					{activeFilterCount}
				</span>
			{/if}
		</button>
	</div>

	<dialog
		bind:this={filterDialog}
		class="catalog-filter-dialog"
		aria-labelledby="admin-anime-filter-title"
		onclose={closeFilter}
		onclick={(event) => {
			if (event.target === event.currentTarget) closeFilter();
		}}
	>
		<div class="catalog-filter-dialog-content">
			<header class="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
				<h2 id="admin-anime-filter-title" class="font-display font-bold text-lg">
					Filter anime
				</h2>
				<button
					type="button"
					class="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground transition hover:text-foreground"
					aria-label="Tutup filter"
					onclick={closeFilter}
				>
					<X class="size-4" />
				</button>
			</header>
			<div class="grid gap-6 p-5">
				<AnimeFilterPanel
					sort={sort}
					genre={genreInput}
					{status}
					onSortChange={(value) => {
						sort = value;
						resetPage();
					}}
					onGenreChange={(value) => {
						genreInput = value;
						resetPage();
					}}
					onStatusChange={(value) => {
						status = value;
						resetPage();
					}}
					onReset={resetFilters}
				/>
			</div>
		</div>
	</dialog>

	{#if activeFilterCount > 0}
		<div class="mt-3 flex flex-wrap gap-2" aria-label="Filter aktif">
			{#if debouncedGenre}
				<button
					type="button"
					onclick={() => {
						genreInput = "";
						debouncedGenre = "";
						resetPage();
					}}
					aria-label="Hapus filter genre"
					class="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs hover:bg-accent"
				>
					Genre: {decodeEntities(debouncedGenre)} ✕
				</button>
			{/if}
			{#if status}
				<button
					type="button"
					onclick={() => {
						status = "";
						resetPage();
					}}
					aria-label="Hapus filter status"
					class="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs hover:bg-accent"
				>
					Status: {decodeEntities(status)} ✕
				</button>
			{/if}
		</div>
	{/if}

	<div class="mt-5" aria-live="polite">
		{#if initialLoading}
			<span class="sr-only" role="status" aria-live="polite">
				Memuat daftar anime
			</span>
			<div
				class="catalog-grid grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
				aria-hidden="true"
			>
				{#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
					<div class="catalog-card min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card">
						<div class="aspect-[.69] animate-pulse bg-secondary"></div>
						<div class="space-y-2 p-2 sm:p-4">
							<div class="h-4 w-11/12 animate-pulse rounded bg-secondary"></div>
							<div class="h-4 w-2/3 animate-pulse rounded bg-secondary"></div>
							<ul class="mt-2 grid gap-1 sm:mt-3 sm:gap-1.5">
								<li class="flex min-h-10 items-center rounded-xl bg-secondary px-3">
									<span class="h-3 w-2/3 animate-pulse rounded bg-card"></span>
								</li>
								<li class="flex min-h-10 items-center rounded-xl bg-secondary px-3">
									<span class="h-3 w-1/2 animate-pulse rounded bg-card"></span>
								</li>
							</ul>
						</div>
					</div>
				{/each}
			</div>
		{:else if items.length === 0 && !loading}
			<div class="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-border border-dashed bg-card/50 px-6 text-center">
				<span class="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
					<Clapperboard class="size-5" />
				</span>
				{#if hasActiveFilter}
					<p class="mt-4 max-w-sm text-muted-foreground text-sm">Belum ada judul yang cocok dengan filter.</p>
					<button
						type="button"
						onclick={resetFilters}
						class="mt-4 text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
					>
						Reset filter
					</button>
				{:else}
					<p class="mt-4 max-w-sm text-muted-foreground text-sm">Belum ada judul tersedia.</p>
				{/if}
			</div>
		{:else}
			<div class="relative">
				<div
					class="catalog-grid grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
					aria-busy={pageLoading}
				>
					{#each items as item (item.id)}
						<AnimeCard
							item={item}
							href={`/anime/${item.id}`}
							id={`anime-${item.id}`}
							thumbnailUrl={thumbnailFor(item)}
							badge={item.isVisible === false ? "Tersembunyi" : null}
						/>
					{/each}
				</div>
				{#if pageLoading}
					<div
						class="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-background/60 backdrop-blur-[1px]"
					>
						<span
							class="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card px-4 py-2 text-muted-foreground text-sm shadow-lg"
						>
							<LoaderCircle class="size-4 animate-spin text-primary" aria-hidden="true" />
							<span class="sr-only" role="status">Memuat halaman berikutnya</span>
							<span aria-hidden="true">Memuat…</span>
						</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<Pagination {page} {pageCount} {loading} label="anime" onChange={(next) => (page = next)} />
</section>
