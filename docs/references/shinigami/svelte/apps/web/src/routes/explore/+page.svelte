<script lang="ts">
import { authClient } from "#lib/auth-client.ts";
import BannerHero from "#lib/components/comic/BannerHero.svelte";
import LoginGate from "#lib/components/comic/LoginGate.svelte";
import SeriesCard from "#lib/components/comic/SeriesCard.svelte";
import type { Country } from "../_mock";
import { getSeriesChapters, mockBanners, mockSeries } from "../_mock";

type CountryFilter = "all" | Country;

const STATUS_OPTIONS = ["all", "Ongoing", "Completed", "Hiatus"] as const;

const session = authClient.useSession();

let query = $state("");
let country = $state<CountryFilter>("all");
let status = $state<string>("all");

const filtered = $derived(
	mockSeries.filter((series) => {
		if (country !== "all" && series.country !== country) return false;
		if (status !== "all" && series.status !== status) return false;
		const q = query.trim().toLowerCase();
		if (q && !series.title.toLowerCase().includes(q)) return false;
		return true;
	}),
);
const results = $derived(filtered.slice(0, 9));

const continueSeries = mockSeries[0];
const continueChapters = continueSeries
	? getSeriesChapters(continueSeries.id)
	: [];
const continueChapter = continueChapters[0];

function countryClass(active: boolean): string {
	return active
		? "bg-[#E01B41] text-white"
		: "bg-neutral-800 text-neutral-300 hover:bg-neutral-700";
}
</script>

<div class="mx-auto w-full max-w-[1440px] space-y-8 px-4 pb-28 pt-6 lg:pb-12">
	<BannerHero items={mockBanners} />

	<!-- Filter bar -->
	<section aria-label="Filter jelajah">
		<h1 class="mb-4 text-2xl font-semibold text-white">Jelajahi Semua Series</h1>
		<div class="flex flex-col gap-3 rounded-xl bg-neutral-900 p-4">
			<input
				type="search"
				placeholder="Cari judul series…"
				bind:value={query}
				class="w-full rounded-md border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#E01B41] focus:outline-none"
			/>
			<div class="flex flex-wrap gap-2" role="tablist" aria-label="Filter negara">
				{#each [{ id: "all", label: "Semua" }, { id: "KR", label: "Manhwa" }, { id: "JP", label: "Manga" }, { id: "CN", label: "Manhua" }] as tab (tab.id)}
					<button
						type="button"
						role="tab"
						aria-selected={country === tab.id}
						class="rounded-md px-4 py-2 text-sm transition {countryClass(country === tab.id)}"
						onclick={() => (country = tab.id as CountryFilter)}
					>
						{tab.label}
					</button>
				{/each}
			</div>
			<label class="flex items-center gap-2 text-sm text-neutral-300">
				Status
				<select
					bind:value={status}
					class="rounded-md border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-[#E01B41] focus:outline-none"
				>
					{#each STATUS_OPTIONS as option (option)}
						<option value={option}>{option === "all" ? "Semua status" : option}</option>
					{/each}
				</select>
			</label>
		</div>
	</section>

	<!-- Hasil -->
	<section aria-label="Hasil jelajah">
		{#if results.length === 0}
			<p class="rounded-lg bg-neutral-900 p-6 text-center text-sm text-neutral-400">
				Tidak ada series yang cocok dengan filter. Coba ubah kata kunci atau filter.
			</p>
		{:else}
			<div class="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-6">
				{#each results as series (series.id)}
					<SeriesCard {series} />
				{/each}
			</div>
		{/if}
	</section>

	<!-- Lanjut baca -->
	<section aria-label="Lanjut baca">
		{#if $session?.isPending}
			<div class="h-24 animate-pulse rounded-xl bg-neutral-900"></div>
		{:else if $session?.data && continueSeries && continueChapter}
			<a
				href="/read/{continueChapter.id}"
				class="flex items-center gap-4 rounded-xl bg-neutral-900 p-4 transition hover:bg-neutral-800"
			>
				<img
					src={continueSeries.cover}
					alt={continueSeries.title}
					loading="lazy"
					class="h-20 w-14 shrink-0 rounded-md object-cover"
				/>
				<span class="min-w-0 flex-1">
					<span class="block text-xs uppercase tracking-wide text-[#E01B41]">Lanjut baca</span>
					<span class="block truncate text-base font-semibold text-white">{continueSeries.title}</span>
					<span class="text-sm text-neutral-400">{continueChapter.number}</span>
				</span>
				<span class="shrink-0 rounded-md bg-[#E01B41] px-4 py-2 text-sm font-medium text-white">
					Baca
				</span>
			</a>
		{:else}
			<LoginGate
				title="Lanjut baca terakhirmu"
				description="Masuk untuk menyinkronkan progres bacamu di semua perangkat."
			/>
		{/if}
	</section>
</div>
