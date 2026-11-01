<script lang="ts">
import { BookOpen, LoaderCircle, Search } from "lucide-svelte";
import Pagination from "#lib/components/Pagination.svelte";
import { getSuperKomikCatalog, type SuperKomikItem } from "#lib/super-komik.ts";
import { decodeEntities, formatTimeAgo } from "#lib/text.ts";

let query = $state("");
let debouncedQuery = $state("");
let page = $state(1);
let items = $state<SuperKomikItem[]>([]);
let totalPages = $state(1);
let totalRecords = $state(0);
let loading = $state(true);
let error = $state("");
const initialLoading = $derived(loading && items.length === 0);
const pageLoading = $derived(loading && items.length > 0);

let debounce: ReturnType<typeof setTimeout> | undefined;
$effect(() => {
	query;
	clearTimeout(debounce);
	debounce = setTimeout(() => {
		debouncedQuery = query.trim();
		page = 1;
	}, 300);
});

$effect(() => {
	const params = { page, pageSize: 24, q: debouncedQuery };
	let active = true;
	const controller = new AbortController();
	loading = true;
	void getSuperKomikCatalog(params, controller.signal)
		.then((payload) => {
			if (!active) return;
			items = payload.items;
			totalPages = Math.max(1, payload.totalPages);
			totalRecords = payload.totalRecords;
			if (page > totalPages) {
				page = totalPages;
				return;
			}
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
</script>

<svelte:head>
	<title>Super Komik · MIFE</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 min-[521px]:pb-24 sm:px-6 lg:px-8">
	<section class="pt-5 sm:pt-7">
		<p class="font-bold text-muted-foreground text-xs tracking-widest">XYMI · SUPER KOMIK</p>
		<h1 class="mt-1 font-extrabold text-2xl tracking-tight sm:text-3xl">Super Komik</h1>
		<label class="relative mt-4 block">
			<Search class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-white/40" />
			<input
				type="search"
				bind:value={query}
				placeholder="Cari judul komik…"
				aria-label="Cari Super Komik"
				class="h-12 w-full rounded-xl border border-white/10 bg-white/5 pr-4 pl-11 text-sm outline-none placeholder:text-white/40 focus:border-white/40"
			/>
		</label>
	</section>

	<section class="mt-6" aria-label="Daftar Super Komik" aria-live="polite">
		{#if error}
			<div class="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm" role="alert">
				<p class="font-semibold">Super Komik gagal dimuat</p>
				<p class="mt-2 text-white/60">{error}</p>
			</div>
		{:else if initialLoading}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6" aria-label="Memuat katalog">
				{#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
					<div class="aspect-[3/4] animate-pulse rounded-2xl bg-white/5" aria-hidden="true"></div>
				{/each}
			</div>
		{:else if items.length === 0 && !loading}
			<div class="grid place-items-center gap-2 rounded-2xl border border-dashed border-white/15 py-16 text-center">
				<BookOpen class="size-6 text-white/40" />
				<p class="text-sm text-white/60">
					{debouncedQuery ? "Judul tidak ditemukan." : "Belum ada judul."}
				</p>
			</div>
		{:else}
			<p class="mb-3 text-xs text-white/50">{totalRecords} judul</p>
			<div class="relative">
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6" aria-busy={pageLoading}>
				{#each items as item (item.id)}
					{@const age = formatTimeAgo(item.latestChapterAt)}
					<a
						href={`/super-komik/${encodeURIComponent(item.id)}`}
						class="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition hover:-translate-y-0.5 hover:border-white/25"
					>
						<span class="relative block aspect-[3/4] overflow-hidden bg-black/40">
							{#if item.coverImageUrl}
								<img
									src={item.coverImageUrl}
									alt=""
									loading="lazy"
									class="h-full w-full object-cover transition group-hover:scale-[1.03]"
								/>
							{:else}
								<span class="grid h-full w-full place-items-center text-white/30">
									<BookOpen class="size-10" />
								</span>
							{/if}
						</span>
						<span class="flex flex-1 flex-col gap-1 p-2 sm:p-3">
							<span class="line-clamp-2 font-semibold text-sm leading-snug">
								{decodeEntities(item.title)}
							</span>
							{#if item.latestChapterNumber}
								<span class="mt-auto flex items-center justify-between gap-2 text-xs text-white/60">
									<span class="truncate">Ch. {item.latestChapterNumber}</span>
									{#if age}
										<time class="shrink-0">{age}</time>
									{/if}
								</span>
							{/if}
						</span>
					</a>
				{/each}
				</div>
				{#if pageLoading}
					<div
						class="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-background/60 backdrop-blur-[1px]"
					>
						<span
							class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-4 py-2 text-sm text-white/80 shadow-lg"
						>
							<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
							<span class="sr-only" role="status">Memuat halaman berikutnya</span>
							<span aria-hidden="true">Memuat…</span>
						</span>
					</div>
				{/if}
			</div>
		{/if}

		<Pagination {page} pageCount={totalPages} {loading} label="super komik" onChange={(next) => (page = next)} />
	</section>
</div>
