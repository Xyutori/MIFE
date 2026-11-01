<script lang="ts">
import { authClient } from "#lib/auth-client.ts";
import AdSlot from "#lib/components/comic/AdSlot.svelte";
import ChapterRow from "#lib/components/comic/ChapterRow.svelte";
import CommentRules from "#lib/components/comic/CommentRules.svelte";
import CommentThread from "#lib/components/comic/CommentThread.svelte";
import {
	BOOKMARKS_KEY,
	hasId,
	READLIST_KEY,
	toggleId,
} from "../../_library-store";
import type { PageProps } from "./$types";

const CHAPTER_PAGE_SIZE = 20;

let { data }: PageProps = $props();

const session = authClient.useSession();

let contentTab = $state<"chapter" | "novel">("chapter");
let chapterQuery = $state("");
let chapterPage = $state(1);
let synopsisOpen = $state(false);
let bookmarked = $state(false);
let inReadlist = $state(false);

const filteredChapters = $derived(
	data.chapters.filter((chapter) => {
		const q = chapterQuery.trim().toLowerCase();
		return !q || chapter.number.toLowerCase().includes(q);
	}),
);
const chapterPageCount = $derived(
	Math.max(1, Math.ceil(filteredChapters.length / CHAPTER_PAGE_SIZE)),
);
const currentChapterPage = $derived(Math.min(chapterPage, chapterPageCount));
const pagedChapters = $derived(
	filteredChapters.slice(
		(currentChapterPage - 1) * CHAPTER_PAGE_SIZE,
		currentChapterPage * CHAPTER_PAGE_SIZE,
	),
);

const stats = $derived<{ label: string; value: string }[]>([
	{
		label: "Rating",
		value: data.series.rating != null ? String(data.series.rating) : "-",
	},
	{ label: "Bookmark", value: data.series.bookmarks },
	{ label: "Views", value: data.series.views },
	{ label: "Rank", value: `#${data.series.rank}` },
]);

$effect(() => {
	bookmarked = hasId(BOOKMARKS_KEY, data.series.id);
	inReadlist = hasId(READLIST_KEY, data.series.id);
});

function toggleBookmark(): void {
	bookmarked = toggleId(BOOKMARKS_KEY, data.series.id);
}

function toggleReadlist(): void {
	inReadlist = toggleId(READLIST_KEY, data.series.id);
}
</script>

<div class="mx-auto w-full max-w-[1440px] space-y-8 px-4 pb-28 pt-6 lg:pb-12">
	<a href="/explore" class="text-sm text-neutral-400 hover:text-white">← Kembali jelajah</a>

	<!-- Hero -->
	<section class="flex flex-col gap-6 rounded-2xl bg-neutral-900 p-4 sm:flex-row sm:p-6">
		<img
			src={data.series.cover}
			alt={data.series.title}
			class="w-40 shrink-0 self-start rounded-lg object-cover sm:w-52"
		/>
		<div class="min-w-0 flex-1 space-y-4">
			<div>
				<h1 class="text-2xl font-bold text-white sm:text-3xl">{data.series.title}</h1>
				<span class="mt-2 inline-block rounded bg-[#E84118] px-2 py-0.5 text-xs font-semibold text-white">
					{data.series.status}
				</span>
			</div>

			<dl class="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Statistik series">
				{#each stats as stat, i (stat.label)}
					{#if i > 0}
						<span class="h-8 w-px bg-white/10" aria-hidden="true"></span>
					{/if}
					<div>
						<dt class="text-[11px] uppercase tracking-wide text-neutral-500">{stat.label}</dt>
						<dd class="text-base font-semibold text-white">{stat.value}</dd>
					</div>
				{/each}
			</dl>

			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					onclick={toggleBookmark}
					aria-pressed={bookmarked}
					class="rounded-md px-4 py-2 text-sm font-medium transition {bookmarked
						? 'bg-[#E01B41] text-white'
						: 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}"
				>
					{bookmarked ? "★ Bookmarked" : "☆ Bookmark"}
				</button>
				<button
					type="button"
					onclick={toggleReadlist}
					aria-pressed={inReadlist}
					class="rounded-md px-4 py-2 text-sm font-medium transition {inReadlist
						? 'bg-[#E01B41] text-white'
						: 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}"
				>
					{inReadlist ? "✓ Di Readlist" : "+ Readlist"}
				</button>
			</div>

			<div>
				<p class="text-sm leading-relaxed text-neutral-300 {synopsisOpen ? '' : 'line-clamp-3'}">
					{data.series.synopsis ?? "Sinopsis belum tersedia untuk series ini."}
				</p>
				{#if data.series.synopsis}
					<button
						type="button"
						class="mt-1 text-sm font-medium text-[#E01B41] hover:underline"
						onclick={() => (synopsisOpen = !synopsisOpen)}
					>
						{synopsisOpen ? "Tutup" : "Read More"}
					</button>
				{/if}
			</div>

			<div class="flex flex-wrap gap-2" aria-label="Genre">
				{#each data.series.genres as genre (genre)}
					<span class="rounded-full border border-white/15 px-3 py-1 text-xs text-neutral-200">
						{genre}
					</span>
				{/each}
			</div>
		</div>
	</section>

	<!-- Metadata -->
	<section class="grid grid-cols-1 gap-2 rounded-2xl bg-neutral-900 p-4 text-sm sm:grid-cols-2 sm:p-6" aria-label="Metadata">
		<p class="text-neutral-300"><span class="text-neutral-500">Author:</span> {data.series.author ?? "-"}</p>
		<p class="text-neutral-300"><span class="text-neutral-500">Artist:</span> {data.series.artist ?? "-"}</p>
		<p class="text-neutral-300"><span class="text-neutral-500">Status:</span> {data.series.status}</p>
		<p class="text-neutral-300"><span class="text-neutral-500">Negara:</span> {data.series.country}</p>
	</section>

	<AdSlot />

	<!-- Chapter / Novel -->
	<section>
		<div class="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Konten series">
			<button
				type="button"
				role="tab"
				aria-selected={contentTab === "chapter"}
				class="rounded-md px-4 py-2 text-sm transition {contentTab === 'chapter'
					? 'bg-[#E01B41] text-white'
					: 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}"
				onclick={() => (contentTab = "chapter")}
			>
				Chapter
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={contentTab === "novel"}
				class="rounded-md px-4 py-2 text-sm transition {contentTab === 'novel'
					? 'bg-[#E01B41] text-white'
					: 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}"
				onclick={() => (contentTab = "novel")}
			>
				Novel
			</button>
		</div>

		{#if contentTab === "chapter"}
			<input
				type="search"
				placeholder="Cari chapter… (mis. 42)"
				bind:value={chapterQuery}
				class="mb-3 w-full rounded-md border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#E01B41] focus:outline-none"
			/>
			{#if pagedChapters.length === 0}
				<p class="rounded-lg bg-neutral-900 p-6 text-center text-sm text-neutral-400">
					Tidak ada chapter yang cocok dengan pencarian.
				</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each pagedChapters as chapter (chapter.id)}
						<li><ChapterRow {chapter} /></li>
					{/each}
				</ul>
				<nav class="mt-4 flex items-center justify-center gap-2" aria-label="Pagination chapter">
					<button
						type="button"
						disabled={currentChapterPage <= 1}
						class="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 disabled:opacity-30"
						onclick={() => (chapterPage = currentChapterPage - 1)}
					>
						←
					</button>
					<span class="text-sm text-neutral-400">
						{currentChapterPage} / {chapterPageCount}
					</span>
					<button
						type="button"
						disabled={currentChapterPage >= chapterPageCount}
						class="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 disabled:opacity-30"
						onclick={() => (chapterPage = currentChapterPage + 1)}
					>
						→
					</button>
				</nav>
			{/if}
		{:else}
			<p class="rounded-lg bg-neutral-900 p-6 text-center text-sm text-neutral-400">
				Versi novel belum tersedia untuk series ini.
			</p>
		{/if}
	</section>

	<!-- Komentar -->
	<section class="space-y-4">
		<CommentRules />
		<CommentThread threadId="series-{data.series.id}" isLoggedIn={$session?.data != null} />
	</section>
</div>
