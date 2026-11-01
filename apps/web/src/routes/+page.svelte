<script lang="ts">
import { BookOpen, LoaderCircle, Search, SlidersHorizontal, X } from "lucide-svelte";
import { onMount } from "svelte";
import {
	apiBase,
	fetchUntilConnected,
	getHero,
	type HeroItem,
	type LibraryResponse,
	readJson,
	type Series,
} from "#lib/api.ts";
import CatalogFilterPanel from "#lib/components/catalog/CatalogFilterPanel.svelte";
import HeroSkeleton from "#lib/components/catalog/HeroSkeleton.svelte";
import HeroCarousel from "#lib/components/HeroCarousel.svelte";
import MangaCard from "#lib/components/MangaCard.svelte";
import Pagination from "#lib/components/Pagination.svelte";

let items = $state<Series[]>([]);
let heroItems = $state<HeroItem[]>([]);
let total = $state(0);
let page = $state(1);
let pageSize = $state(12);
let query = $state("");
let debouncedQuery = $state("");
let sort = $state("recent");
let comicType = $state("");
let genreInput = $state("");
let debouncedGenre = $state("");
let status = $state("");
let filterOpen = $state(false);
let filterDialog = $state<HTMLDialogElement | null>(null);
let loading = $state(true);
let heroLoading = $state(true);
let error = $state("");

const pageCount = $derived(Math.max(1, Math.ceil(total / pageSize)));
const activeFilterCount = $derived(
	(comicType ? 1 : 0) + (debouncedGenre ? 1 : 0) + (status ? 1 : 0),
);
const hasActiveFilter = $derived(Boolean(debouncedQuery) || activeFilterCount > 0);
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

// Helper lokal (tanpa menyentuh #lib/api.ts): mirror getLibrary + param
// genre/status yang didukung backend (/api/v1/library, cache key server
// sudah mencakup genre & status).
async function fetchCatalog(
	params: {
		page: number;
		pageSize: number;
		sort: string;
		q: string;
		type: string;
		genre: string;
		status: string;
	},
	signal?: AbortSignal,
): Promise<LibraryResponse> {
	const search = new URLSearchParams({
		page: String(params.page),
		pageSize: String(params.pageSize),
		sort: params.sort,
	});
	if (params.q) search.set("q", params.q);
	if (params.type) search.set("type", params.type);
	if (params.genre) search.set("genre", params.genre);
	if (params.status) search.set("status", params.status);
	const response = await fetchUntilConnected(
		`${apiBase()}/api/v1/library?${search}`,
		{ signal },
	);
	return readJson<LibraryResponse>(response);
}

onMount(() => {
	let active = true;
	const controller = new AbortController();
	void getHero(controller.signal)
		.then((hero) => {
			if (active) heroItems = hero;
		})
		.catch(() => {
			if (active) heroItems = [];
		})
		.finally(() => {
			if (active) heroLoading = false;
		});
	return () => {
		active = false;
		controller.abort();
	};
});

$effect(() => {
	const params = {
		page,
		pageSize,
		sort,
		q: debouncedQuery,
		type: comicType,
		genre: debouncedGenre,
		status,
	};
	let active = true;
	const controller = new AbortController();
	loading = true;
	void fetchCatalog(params, controller.signal)
		.then((payload) => {
			if (!active) return;
			const responsePageCount = Math.max(
				1,
				Math.ceil(payload.total / pageSize),
			);
			if (page > responsePageCount) {
				page = responsePageCount;
				return;
			}
			items = payload.items;
			total = payload.total;
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
	comicType = "";
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

<svelte:head>
	<title>MIFE · Katalog Komik</title>
	<meta name="description" content="Katalog komik MIFE — baca online dan unduh untuk offline." />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 min-[521px]:pb-20 sm:px-6 lg:px-8">
	{#if heroLoading}
		<HeroSkeleton />
	{:else if heroItems.length > 0}
		<HeroCarousel items={heroItems} />
	{/if}

	<section class="catalog-toolbar pt-5 sm:pt-7">
		<div class="mb-4 flex items-end justify-between gap-3">
			<div>
				<h1 class="mt-1 font-display font-extrabold text-2xl tracking-tight sm:text-3xl">Komik terbaru</h1>
			</div>
		</div>

		<div class="catalog-search relative grid gap-2 grid-cols-[minmax(0,1fr)_3rem]">
			<label class="relative block">
				<Search class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
				<input
					type="search"
					bind:value={query}
					oninput={resetPage}
					placeholder="Cari judul komik…"
					aria-label="Cari judul komik"
					maxlength={120}
					class="h-12 w-full rounded-xl border border-border/80 bg-card pr-4 pl-11 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
				/>
			</label>
			<button
				type="button"
				onclick={() => (filterOpen = true)}
				aria-haspopup="dialog"
				class="relative inline-flex size-12 items-center justify-center rounded-xl border border-border/80 bg-card outline-none hover:bg-accent"
				aria-label="Filter komik"
				title="Filter komik"
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
			aria-labelledby="catalog-filter-title"
			onclose={closeFilter}
			onclick={(event) => {
				if (event.target === event.currentTarget) closeFilter();
			}}
		>
			<div class="catalog-filter-dialog-content">
				<header class="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
					<h2 id="catalog-filter-title" class="font-display font-bold text-lg">
						Filter komik
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
					<CatalogFilterPanel
						sort={sort}
						{comicType}
						genre={genreInput}
						{status}
						onSortChange={(value) => {
							sort = value;
							resetPage();
						}}
						onComicTypeChange={(value) => {
							comicType = value;
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
				{#if comicType}
					<button
						type="button"
						onclick={() => {
							comicType = "";
							resetPage();
						}}
						aria-label="Hapus filter tipe"
						class="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs hover:bg-accent"
					>
						Tipe: {comicType} ✕
					</button>
				{/if}
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
						Genre: {debouncedGenre} ✕
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
						Status: {status} ✕
					</button>
				{/if}
			</div>
		{/if}

	</section>

	<section class="catalog-list" aria-label="Daftar judul">
		<div aria-live="polite">
			{#if error}
				<div class="rounded-2xl border border-destructive/30 bg-card p-6 text-muted-foreground text-sm" role="alert">
					{error}
					<p class="mt-2 text-xs">Pastikan server MIFE sedang berjalan.</p>
				</div>
			{:else if initialLoading}
				<span class="sr-only" role="status" aria-live="polite">
					Memuat daftar komik
				</span>
				<div class="catalog-grid grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-hidden="true">
					{#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
						<div class="catalog-card min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card">
							<div class="aspect-[.69] animate-pulse bg-secondary"></div>
							<div class="space-y-2 p-3 sm:p-4">
								<div class="h-4 w-11/12 animate-pulse rounded bg-secondary"></div>
								<div class="h-4 w-2/3 animate-pulse rounded bg-secondary"></div>
								<div class="h-3 w-1/2 animate-pulse rounded bg-secondary"></div>
								<ul class="mt-3 grid gap-1.5" aria-hidden="true">
									<li class="flex min-h-10 items-center justify-between gap-2 rounded-xl bg-secondary px-3">
										<span class="h-3 w-1/2 animate-pulse rounded bg-card"></span>
										<span class="h-5 w-10 animate-pulse rounded-md bg-card"></span>
									</li>
									<li class="flex min-h-10 items-center justify-between gap-2 rounded-xl bg-secondary px-3">
										<span class="h-3 w-1/2 animate-pulse rounded bg-card"></span>
										<span class="h-5 w-10 animate-pulse rounded-md bg-card"></span>
									</li>
								</ul>
							</div>
						</div>
					{/each}
				</div>
			{:else if items.length === 0 && !loading}
				<div class="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-border border-dashed bg-card/50 px-6 text-center">
					<span class="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
						<BookOpen class="size-5" />
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
						{#each items as series (series.id)}
							<MangaCard {series} href={`/komik/${series.slug}`} id={`comic-${series.id}`} />
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

		<Pagination {page} {pageCount} {loading} label="komik" onChange={(next) => (page = next)} />
	</section>
</div>
