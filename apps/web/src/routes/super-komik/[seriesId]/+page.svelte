<script lang="ts">
import { ArrowLeft, BookOpen } from "lucide-svelte";
import Pagination from "#lib/components/Pagination.svelte";
import {
	getSuperKomikDetail,
	type SuperKomikDetail,
} from "#lib/super-komik.ts";
import { decodeEntities } from "#lib/text.ts";
import type { PageProps } from "./$types";

let { data: routeData }: PageProps = $props();
const seriesId = $derived(routeData.params.seriesId);

let data = $state<SuperKomikDetail | null>(null);
let pageNum = $state(1);
let error = $state("");

$effect(() => {
	seriesId;
	pageNum = 1;
});

$effect(() => {
	const id = seriesId;
	const currentPage = pageNum;
	let active = true;
	const controller = new AbortController();
	data = null;
	error = "";
	void getSuperKomikDetail(id, currentPage, controller.signal)
		.then((payload) => {
			if (active) data = payload;
		})
		.catch((cause: unknown) => {
			if (!active) return;
			if (cause instanceof DOMException && cause.name === "AbortError") return;
			error = cause instanceof Error ? cause.message : "Detail gagal dimuat.";
		});
	return () => {
		active = false;
		controller.abort();
	};
});

const people = $derived(
	[
		...new Set([
			...(data?.series.authors ?? []),
			...(data?.series.artists ?? []),
		]),
	].filter((name) => name.trim()),
);
</script>

<svelte:head>
	<title>{data ? `${decodeEntities(data.series.title)} · Super Komik · MIFE` : "Super Komik · MIFE"}</title>
</svelte:head>

{#if error}
	<main class="mx-auto min-h-[70vh] max-w-4xl px-4 py-12">
		<a href="/super-komik" class="mb-5 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
			<ArrowLeft class="size-4" />
			Super Komik
		</a>
		<div class="rounded-2xl border border-destructive/30 bg-destructive/10 p-6" role="alert">
			<p class="font-semibold">Detail gagal dimuat</p>
			<p class="mt-1 text-sm text-white/60">{error}</p>
		</div>
	</main>
{:else if !data}
	<main class="mx-auto max-w-7xl px-4 min-[521px]:pb-12" aria-busy="true" aria-label="Memuat detail Super Komik">
		<div class="mt-6 h-72 animate-pulse rounded-3xl bg-white/5"></div>
		<span class="sr-only" role="status">Memuat detail Super Komik</span>
	</main>
{:else}
	<main class="mx-auto max-w-7xl px-4 min-[521px]:pb-12 sm:px-6 lg:px-8">
		<a href="/super-komik" class="mt-4 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
			<ArrowLeft class="size-4" />
			Super Komik
		</a>

		<section class="mt-3 grid gap-5 sm:grid-cols-[12rem_1fr] sm:gap-7">
			<div class="mx-auto w-44 overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:mx-0 sm:w-full">
				{#if data.series.coverImageUrl}
					<img src={data.series.coverImageUrl} alt="" class="aspect-[3/4] w-full object-cover" />
				{:else}
					<div class="grid aspect-[3/4] w-full place-items-center text-white/30" aria-hidden="true">
						<BookOpen class="size-12" />
					</div>
				{/if}
			</div>
			<div class="min-w-0">
				<h1 class="font-extrabold text-2xl sm:text-3xl">{decodeEntities(data.series.title)}</h1>
				{#if data.series.alternativeTitle}
					<p class="mt-1 text-sm text-white/50">{decodeEntities(data.series.alternativeTitle)}</p>
				{/if}
				{#if people.length > 0}
					<p class="mt-3 text-sm text-white/70">{people.join(" · ")}</p>
				{/if}
				{#if data.series.genres.length > 0}
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#each data.series.genres as genre (genre)}
							<span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/75">
								{decodeEntities(genre)}
							</span>
						{/each}
					</div>
				{/if}
				{#if data.series.description}
					<p class="mt-4 text-sm leading-relaxed text-white/75">{data.series.description}</p>
				{/if}
			</div>
		</section>

		<section class="mt-10" aria-label="Daftar chapter">
			<h2 class="font-bold text-xl">Semua chapter ({data.totalChapters})</h2>
			<div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.chapters as chapter (chapter.id)}
					<a
						href={`/super-komik/read/${encodeURIComponent(chapter.id)}`}
						class="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-2.5 transition hover:border-white/25"
					>
						<span class="grid size-12 shrink-0 place-items-center rounded-xl bg-black/40 font-bold text-sm">
							{chapter.numberText}
						</span>
						<span class="min-w-0 flex-1 truncate font-semibold text-sm group-hover:underline">
							{chapter.title ? decodeEntities(chapter.title) : `Chapter ${chapter.numberText}`}
						</span>
					</a>
				{/each}
			</div>
			<Pagination
				page={pageNum}
				pageCount={Math.max(1, data.totalPages)}
				label="chapter super komik"
				onChange={(next) => (pageNum = next)}
			/>
		</section>
	</main>
{/if}
