<script lang="ts">
import { LoaderCircle, Search, SlidersHorizontal, X } from "lucide-svelte";
import { requestJson } from "#lib/admin.ts";
import type { Series } from "#lib/api.ts";
import ErrorState from "#lib/components/admin/ErrorState.svelte";
import MangaCard from "#lib/components/MangaCard.svelte";
import Pagination from "#lib/components/Pagination.svelte";
import GenreMultiSelect from "#lib/components/ui/combobox/GenreMultiSelect.svelte";
import Select from "#lib/components/ui/select/Select.svelte";

type AdminSeries = {
	id: string;
	slug: string;
	title: string;
	coverImageUrl: string | null;
	latestChapterNumber: string | null;
	latestChapterAt: string | null;
	latestChapters?: Array<{
		id: string;
		numberText: string;
		createdAt: string | null;
	}>;
	comicType: string | null;
	countryId: string | null;
	updatedAt: string;
	isVisible: boolean;
	sources: Array<{ key: string; name: string }>;
};

type SourceOption = { id: string; key: string; name: string };

const PAGE_SIZE = 48;

// Pola tampilan disamakan dengan katalog publik (routes/+page.svelte):
// search h-12 + tombol filter (dialog) + chip filter aktif + grid MangaCard.
// Bedanya: opsi urut hanya recent/title (itu yang didukung server
// /api/v1/library — "popular" tidak ada), plus filter khas admin
// (sumber, visibilitas) sebagai baris tambahan di dialog yang sama.
const SORT_OPTIONS = [
	{ value: "recent", label: "Update terbaru" },
	{ value: "title", label: "Judul A–Z" },
] as const;

const COMIC_TYPE_OPTIONS = [
	{ value: "", label: "Semua tipe komik" },
	{ value: "manga", label: "🇯🇵 Manga" },
	{ value: "manhua", label: "🇨🇳 Manhua" },
	{ value: "manhwa", label: "🇰🇷 Manhwa" },
] as const;

const STATUS_OPTIONS = [
	{ value: "", label: "Semua status" },
	{ value: "ongoing", label: "Ongoing" },
	{ value: "completed", label: "Completed" },
	{ value: "hiatus", label: "Hiatus" },
] as const;

const VISIBILITY_OPTIONS = [
	{ value: "all", label: "Semua" },
	{ value: "visible", label: "Tampil" },
	{ value: "hidden", label: "Tersembunyi" },
] as const;

let items = $state<AdminSeries[]>([]);
let total = $state(0);
let page = $state(1);
let pageSize = $state(PAGE_SIZE);
let sourceOptions = $state<SourceOption[]>([]);
let searchInput = $state("");
let search = $state("");
let sort = $state("recent");
let comicType = $state("");
let genreInput = $state("");
let genre = $state("");
let status = $state("");
let sourceFilter = $state("all");
let visibilityFilter = $state("all");
let filterOpen = $state(false);
let filterDialog = $state<HTMLDialogElement | null>(null);
let loading = $state(true);
let serverError = $state("");

const visibleItems = $derived(
	visibilityFilter === "all"
		? items
		: items.filter((item) =>
				visibilityFilter === "visible" ? item.isVisible : !item.isVisible,
			),
);

const activeFilterCount = $derived(
	(comicType ? 1 : 0) +
		(genre ? 1 : 0) +
		(status ? 1 : 0) +
		(sourceFilter !== "all" ? 1 : 0) +
		(visibilityFilter !== "all" ? 1 : 0),
);
const hasActiveFilter = $derived(Boolean(search) || activeFilterCount > 0);
const pageCount = $derived(Math.max(1, Math.ceil(total / pageSize)));
const initialLoading = $derived(loading && items.length === 0);
const pageLoading = $derived(loading && items.length > 0);

function resetPage() {
	if (page !== 1) page = 1;
}

function toSeries(item: AdminSeries): Series {
	return {
		id: item.id,
		slug: item.slug,
		title: item.title,
		coverImageUrl: item.coverImageUrl,
		updatedAt: item.updatedAt,
		latestChapterNumber: item.latestChapterNumber,
		latestChapters: item.latestChapters?.length
			? item.latestChapters.slice(0, 2)
			: item.latestChapterNumber
				? [
						{
							id: `${item.id}:latest`,
							numberText: item.latestChapterNumber,
							createdAt: item.latestChapterAt,
						},
					]
				: [],
		comicType: item.comicType,
		countryId: item.countryId,
	};
}

let debounce: ReturnType<typeof setTimeout> | undefined;
$effect(() => {
	searchInput;
	clearTimeout(debounce);
	debounce = setTimeout(() => {
		search = searchInput.trim();
	}, 280);
});

let genreDebounce: ReturnType<typeof setTimeout> | undefined;
$effect(() => {
	genreInput;
	clearTimeout(genreDebounce);
	genreDebounce = setTimeout(() => {
		genre = genreInput.trim();
	}, 280);
});

async function loadSources(signal?: AbortSignal) {
	sourceOptions = await requestJson<SourceOption[]>("/api/v1/sources", {
		signal,
	}).catch(() => [] as SourceOption[]);
}

async function loadLibrary(currentPage: number, signal?: AbortSignal) {
	const payload = await requestJson<{
		items?: AdminSeries[];
		total?: number;
	}>(`/api/v1/library?${buildQuery(currentPage)}`, { signal });
	const responseTotal = payload.total ?? 0;
	const responsePageCount = Math.max(1, Math.ceil(responseTotal / pageSize));
	if (currentPage > responsePageCount) {
		page = responsePageCount;
		return;
	}
	items = payload.items ?? [];
	total = responseTotal;
}

function buildQuery(currentPage: number): URLSearchParams {
	const query = new URLSearchParams({
		page: String(currentPage),
		pageSize: String(pageSize),
		sort,
		includeHidden: "true",
	});
	if (search) query.set("q", search);
	if (comicType) query.set("type", comicType);
	if (genre) query.set("genre", genre);
	if (status) query.set("status", status);
	if (sourceFilter !== "all") query.set("source", sourceFilter);
	return query;
}

function resetFilters() {
	searchInput = "";
	search = "";
	comicType = "";
	genreInput = "";
	genre = "";
	status = "";
	sourceFilter = "all";
	visibilityFilter = "all";
	resetPage();
}

$effect(() => {
	const controller = new AbortController();
	void loadSources(controller.signal).catch(() => undefined);
	return () => controller.abort();
});

$effect(() => {
	page;
	pageSize;
	sort;
	search;
	comicType;
	genre;
	status;
	sourceFilter;
	loading = true;
	const currentPage = page;
	const controller = new AbortController();
	let active = true;
	void loadLibrary(currentPage, controller.signal)
		.then(() => {
			if (active) serverError = "";
		})
		.catch((cause: unknown) => {
			if (!active) return;
			if ((cause as Error)?.name === "AbortError") return;
			serverError =
				cause instanceof Error ? cause.message : "Server belum tersambung.";
		})
		.finally(() => {
			if (active) loading = false;
		});
	return () => {
		active = false;
		controller.abort();
	};
});

$effect(() => {
	if (!filterDialog) return;
	if (filterOpen && !filterDialog.open) filterDialog.showModal();
	if (!filterOpen && filterDialog.open) filterDialog.close();
});

function closeFilter() {
	filterOpen = false;
}
</script>

{#if serverError}
	<div class="mb-4">
		<ErrorState message={serverError} variant="page" />
	</div>
{/if}

<section aria-label="Comic">
	<div class="mb-4 flex items-end justify-between gap-3">
		<div>
			<!-- Judul halaman dipegang shell di mobile: sembunyikan di mobile. -->
			<h2 class="hidden font-semibold text-xl lg:block">Comic</h2>
		</div>
	</div>

	<div class="catalog-search relative grid gap-2 grid-cols-[minmax(0,1fr)_3rem]">
		<label class="relative block">
			<Search class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
			<input
				type="search"
				bind:value={searchInput}
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
		aria-labelledby="admin-comic-filter-title"
		onclose={closeFilter}
		onclick={(event) => {
			if (event.target === event.currentTarget) closeFilter();
		}}
	>
		<div class="catalog-filter-dialog-content">
			<header class="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
				<h2 id="admin-comic-filter-title" class="font-display font-bold text-lg">
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
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-2">
						<span class="font-semibold text-sm">Urutkan komik</span>
						<Select
							value={sort}
							options={SORT_OPTIONS}
							ariaLabel="Urutkan komik"
							onChange={(value) => {
								sort = value;
								resetPage();
							}}
						/>
					</div>
					<div class="grid gap-2">
						<span class="font-semibold text-sm">Tipe komik</span>
						<Select
							value={comicType}
							options={COMIC_TYPE_OPTIONS}
							ariaLabel="Tipe komik"
							onChange={(value) => {
								comicType = value;
								resetPage();
							}}
						/>
					</div>
					<GenreMultiSelect value={genreInput} workspace="comic" id="admin-comic-genre" onChange={(value) => {
						genreInput = value;
						resetPage();
					}} />
					<div class="grid gap-2">
						<span class="font-semibold text-sm">Status</span>
						<Select
							value={status}
							options={STATUS_OPTIONS}
							ariaLabel="Status"
							onChange={(value) => {
								status = value;
								resetPage();
							}}
						/>
					</div>
					<div class="grid gap-2">
						<span class="font-semibold text-sm">Sumber</span>
						<Select
							value={sourceFilter}
							options={[
								{ value: "all", label: "Semua sumber" },
								...sourceOptions.map((source) => ({
									value: source.key,
									label: source.name,
								})),
							]}
							ariaLabel="Filter sumber"
							onChange={(value) => {
								sourceFilter = value;
								resetPage();
							}}
						/>
					</div>
					<div class="grid gap-2">
						<span class="font-semibold text-sm">Visibilitas</span>
						<Select
							value={visibilityFilter}
							options={VISIBILITY_OPTIONS}
							ariaLabel="Filter visibilitas"
							onChange={(value) => (visibilityFilter = value)}
						/>
					</div>
				</div>
				<button
					type="button"
					onclick={resetFilters}
					class="text-left text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
				>
					Reset filter
				</button>
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
			{#if genre}
				<button
					type="button"
					onclick={() => {
						genreInput = "";
						genre = "";
						resetPage();
					}}
					aria-label="Hapus filter genre"
					class="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs hover:bg-accent"
				>
					Genre: {genre} ✕
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
			{#if sourceFilter !== "all"}
				<button
					type="button"
					onclick={() => {
						sourceFilter = "all";
						resetPage();
					}}
					aria-label="Hapus filter sumber"
					class="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs hover:bg-accent"
				>
					Sumber: {sourceOptions.find((source) => source.key === sourceFilter)?.name ?? sourceFilter} ✕
				</button>
			{/if}
			{#if visibilityFilter !== "all"}
				<button
					type="button"
					onclick={() => (visibilityFilter = "all")}
					aria-label="Hapus filter visibilitas"
					class="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs hover:bg-accent"
				>
					{visibilityFilter === "visible" ? "Tampil" : "Tersembunyi"} ✕
				</button>
			{/if}
		</div>
	{/if}

	{#if initialLoading}
		<div
			class="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
			aria-busy="true"
			aria-label="Memuat comic"
		>
			{#each Array.from({ length: 10 }, (_, index) => index) as index (index)}
				<div class="min-w-0 overflow-hidden rounded-2xl border" aria-hidden="true">
					<div class="aspect-[.7] animate-pulse bg-secondary"></div>
					<div class="space-y-2 p-3">
						<div class="h-4 animate-pulse rounded bg-secondary"></div>
						<div class="h-3 w-2/3 animate-pulse rounded bg-secondary"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if visibleItems.length === 0 && !loading}
		<p class="mt-5 rounded-2xl border border-dashed bg-card/60 p-8 text-center text-muted-foreground text-sm">
			{hasActiveFilter ? "Judul tidak ditemukan." : "Pustaka masih kosong."}
		</p>
		{#if hasActiveFilter}
			<div class="mt-3 text-center">
				<button
					type="button"
					onclick={resetFilters}
					class="text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
				>
					Reset filter
				</button>
			</div>
		{/if}
	{:else}
		<div class="relative mt-5">
			<div
				class="catalog-grid grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
				aria-busy={pageLoading}
			>
				{#each visibleItems as item (item.id)}
					<MangaCard
						series={toSeries(item)}
						href={`/komik/${item.slug}`}
						badge={item.isVisible ? null : "Tersembunyi"}
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
						<span class="sr-only" role="status">Memuat daftar komik</span>
						<span aria-hidden="true">Memuat…</span>
					</span>
				</div>
			{/if}
		</div>
	{/if}

	<Pagination {page} {pageCount} {loading} label="komik" onChange={(next) => (page = next)} />
</section>
