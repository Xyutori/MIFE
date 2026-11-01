<script lang="ts">
import { authClient } from "#lib/auth-client.ts";
import LoginGate from "#lib/components/comic/LoginGate.svelte";
import SeriesCard from "#lib/components/comic/SeriesCard.svelte";
import {
	BOOKMARKS_KEY,
	type HistoryEntry,
	loadHistory,
	loadIds,
	READLIST_KEY,
} from "../_library-store";
import { getSeriesById } from "../_mock";

type ShelfTab = "bookmark" | "readlist" | "history";

const session = authClient.useSession();

let shelfTab = $state<ShelfTab>("bookmark");
let bookmarkIds = $state<string[]>([]);
let readlistIds = $state<string[]>([]);
let history = $state<HistoryEntry[]>([]);

const bookmarkedSeries = $derived(
	bookmarkIds.map((id) => getSeriesById(id)).filter((s) => s !== undefined),
);
const readlistSeries = $derived(
	readlistIds.map((id) => getSeriesById(id)).filter((s) => s !== undefined),
);

$effect(() => {
	// Muat rak hanya di client; localStorage tidak ada saat SSR.
	bookmarkIds = loadIds(BOOKMARKS_KEY);
	readlistIds = loadIds(READLIST_KEY);
	history = loadHistory();
});

function shelfClass(active: boolean): string {
	return active
		? "bg-[#E01B41] text-white"
		: "bg-neutral-800 text-neutral-300 hover:bg-neutral-700";
}
</script>

<div class="mx-auto w-full max-w-[1440px] space-y-6 px-4 pb-28 pt-6 lg:pb-12">
	<h1 class="text-2xl font-semibold text-white">Library Saya</h1>

	{#if $session?.isPending}
		<div class="h-40 animate-pulse rounded-xl bg-neutral-900" aria-label="Memuat library"></div>
	{:else if !$session?.data}
		<LoginGate
			title="Masuk untuk membuka library"
			description="Bookmark, readlist, dan riwayat bacamu tersimpan di akunmu."
		/>
	{:else}
		<div class="flex flex-wrap gap-2" role="tablist" aria-label="Rak library">
			<button
				type="button"
				role="tab"
				aria-selected={shelfTab === "bookmark"}
				class="rounded-md px-4 py-2 text-sm transition {shelfClass(shelfTab === 'bookmark')}"
				onclick={() => (shelfTab = "bookmark")}
			>
				Bookmark ({bookmarkIds.length})
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={shelfTab === "readlist"}
				class="rounded-md px-4 py-2 text-sm transition {shelfClass(shelfTab === 'readlist')}"
				onclick={() => (shelfTab = "readlist")}
			>
				Readlist ({readlistIds.length})
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={shelfTab === "history"}
				class="rounded-md px-4 py-2 text-sm transition {shelfClass(shelfTab === 'history')}"
				onclick={() => (shelfTab = "history")}
			>
				History ({history.length})
			</button>
		</div>

		{#if shelfTab === "bookmark"}
			{#if bookmarkedSeries.length === 0}
				<div class="rounded-xl bg-neutral-900 p-8 text-center">
					<p class="text-sm text-neutral-400">Belum ada bookmark. Tandai series favoritmu dari halaman detail.</p>
					<a href="/explore" class="mt-3 inline-block rounded-md bg-[#E01B41] px-4 py-2 text-sm font-medium text-white">
						Jelajahi Series
					</a>
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-6">
					{#each bookmarkedSeries as series (series.id)}
						<SeriesCard {series} />
					{/each}
				</div>
			{/if}
		{:else if shelfTab === "readlist"}
			{#if readlistSeries.length === 0}
				<div class="rounded-xl bg-neutral-900 p-8 text-center">
					<p class="text-sm text-neutral-400">Readlist masih kosong. Simpan series yang ingin dibaca nanti.</p>
					<a href="/explore" class="mt-3 inline-block rounded-md bg-[#E01B41] px-4 py-2 text-sm font-medium text-white">
						Jelajahi Series
					</a>
				</div>
			{:else}
				<div class="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-6">
					{#each readlistSeries as series (series.id)}
						<SeriesCard {series} />
					{/each}
				</div>
			{/if}
		{:else}
			{#if history.length === 0}
				<div class="rounded-xl bg-neutral-900 p-8 text-center">
					<p class="text-sm text-neutral-400">Belum ada riwayat baca di perangkat ini.</p>
					<a href="/" class="mt-3 inline-block rounded-md bg-[#E01B41] px-4 py-2 text-sm font-medium text-white">
						Mulai Membaca
					</a>
				</div>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each history as entry (entry.chapterId)}
						<li>
							<a
								href="/read/{entry.chapterId}"
								class="flex items-center gap-3 rounded-lg bg-neutral-900 p-2.5 transition hover:bg-neutral-800"
							>
								<img
									src={entry.cover}
									alt={entry.title}
									loading="lazy"
									class="h-16 w-12 shrink-0 rounded-md object-cover"
								/>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium text-white">{entry.title}</span>
									<span class="text-xs text-neutral-400">{entry.chapter}</span>
								</span>
								<span class="shrink-0 text-xs text-neutral-500">Lanjutkan →</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}
</div>
