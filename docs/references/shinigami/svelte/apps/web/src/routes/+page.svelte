<script lang="ts">
	import AnnouncementCard from "#lib/components/comic/AnnouncementCard.svelte";
	import BannerHero from "#lib/components/comic/BannerHero.svelte";
	import SeriesCard from "#lib/components/comic/SeriesCard.svelte";
	import { mockAnnouncements, mockBanners, mockSeries } from "./_mock";
	import type { Country, UpdateKind } from "./_mock";

	type PopularTab = "harian" | "mingguan" | "semua";

	const PAGE_SIZE = 12;

	const REC_TABS: { id: Country; label: string }[] = [
		{ id: "KR", label: "Manhwa" },
		{ id: "JP", label: "Manga" },
		{ id: "CN", label: "Manhua" },
	];
	const UPDATE_TABS: { id: UpdateKind; label: string }[] = [
		{ id: "project", label: "Project" },
		{ id: "mirror", label: "Mirror" },
	];
	const POPULAR_TABS: { id: PopularTab; label: string }[] = [
		{ id: "harian", label: "Harian" },
		{ id: "mingguan", label: "Mingguan" },
		{ id: "semua", label: "Semua" },
	];

	let recTab = $state<Country>("KR");
	let updateTab = $state<UpdateKind>("project");
	let listView = $state(false);
	let updatePage = $state(1);
	let popularTab = $state<PopularTab>("harian");
	let popularLoading = $state(true);

	const latestAnnouncements = mockAnnouncements.slice(0, 2);

	const recommendations = $derived(mockSeries.filter((s) => s.country === recTab).slice(0, 10));

	const updates = $derived(mockSeries.filter((s) => s.kind === updateTab));
	const updatePageCount = $derived(Math.max(1, Math.ceil(updates.length / PAGE_SIZE)));
	const currentPage = $derived(Math.min(updatePage, updatePageCount));
	const pagedUpdates = $derived(updates.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));
	const pageNumbers = $derived(
		Array.from({ length: updatePageCount }, (_, i) => i + 1).filter(
			(n) => n === 1 || n === updatePageCount || Math.abs(n - currentPage) <= 1,
		),
	);

	const popular = $derived.by(() => {
		if (popularTab === "semua") {
			return [...mockSeries].sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0)).slice(0, 6);
		}
		const offset = popularTab === "harian" ? 0 : 6;
		return mockSeries.slice(offset, offset + 6);
	});

	function tabClass(active: boolean): string {
		return active
			? "bg-[#E01B41] text-white"
			: "bg-neutral-800 text-neutral-300 hover:bg-neutral-700";
	}

	function selectUpdateTab(tab: UpdateKind): void {
		updateTab = tab;
		updatePage = 1;
	}

	function goToPage(page: number): void {
		updatePage = Math.min(Math.max(1, page), updatePageCount);
	}

	$effect(() => {
		void popularTab;
		popularLoading = true;
		const timer = setTimeout(() => {
			popularLoading = false;
		}, 600);
		return () => clearTimeout(timer);
	});
</script>

<div class="mx-auto w-full max-w-[1440px] space-y-8 px-4 pb-28 pt-6 lg:pb-12">
	<!-- Hero: banner + pengumuman -->
	<section class="grid grid-cols-1 gap-8 lg:grid-cols-[2fr_1fr]">
		<BannerHero items={mockBanners} />
		<div>
			<div class="mb-4 flex items-end justify-between">
				<h2 class="text-2xl font-semibold text-white">Pengumuman</h2>
				<a href="/announcement" class="text-sm text-neutral-400 hover:text-white">Semua</a>
			</div>
			<div class="flex flex-col gap-4">
				{#each latestAnnouncements as announcement (announcement.href)}
					<AnnouncementCard {announcement} />
				{/each}
			</div>
		</div>
	</section>

	<!-- Rekomendasi -->
	<section>
		<h2 class="mb-4 text-2xl font-semibold text-white">Rekomendasi</h2>
		<div class="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter rekomendasi">
			{#each REC_TABS as tab (tab.id)}
				<button
					type="button"
					role="tab"
					aria-selected={recTab === tab.id}
					class="rounded-md px-4 py-2 text-sm transition {tabClass(recTab === tab.id)}"
					onclick={() => (recTab = tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>
		{#if recommendations.length === 0}
			<p class="rounded-lg bg-neutral-900 p-6 text-center text-sm text-neutral-400">
				Belum ada rekomendasi untuk kategori ini.
			</p>
		{:else}
			<div class="flex snap-x gap-3 overflow-x-auto pb-1">
				{#each recommendations as series (series.id)}
					<SeriesCard {series} layout="carousel" showChapters={false} />
				{/each}
			</div>
		{/if}
	</section>

	<!-- Update -->
	<section>
		<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-2xl font-semibold text-white">Update</h2>
			<button
				type="button"
				class="rounded-md bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
				onclick={() => (listView = !listView)}
				aria-pressed={listView}
			>
				{listView ? "Tampilan Grid" : "Tampilan List"}
			</button>
		</div>
		<div class="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter update">
			{#each UPDATE_TABS as tab (tab.id)}
				<button
					type="button"
					role="tab"
					aria-selected={updateTab === tab.id}
					class="rounded-md px-4 py-2 text-sm transition {tabClass(updateTab === tab.id)}"
					onclick={() => selectUpdateTab(tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		{#if pagedUpdates.length === 0}
			<p class="rounded-lg bg-neutral-900 p-6 text-center text-sm text-neutral-400">
				Belum ada update untuk kategori ini.
			</p>
		{:else if listView}
			<ul class="flex flex-col gap-2">
				{#each pagedUpdates as series (series.id)}
					<li>
						<a
							href={series.href}
							class="flex items-center gap-3 rounded-lg bg-neutral-900 p-2.5 transition hover:bg-neutral-800"
						>
							<img
								src={series.cover}
								alt={series.title}
								loading="lazy"
								class="h-16 w-12 shrink-0 rounded-md object-cover"
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium text-white">{series.title}</span>
								<span class="text-xs text-neutral-400">
									{series.latestChapters?.[0]?.number ?? "Chapter terbaru"} · {series.updatedAt ??
										"baru saja"}
								</span>
							</span>
							{#if series.badge}
								<span class="rounded bg-[#E84118] px-1.5 py-0.5 text-[10px] font-semibold text-white">
									{series.badge}
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<div class="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-6">
				{#each pagedUpdates as series (series.id)}
					<SeriesCard {series} />
				{/each}
			</div>
		{/if}

		<nav class="mt-6 flex items-center justify-center gap-3" aria-label="Pagination update">
			<button
				type="button"
				aria-label="Halaman sebelumnya"
				disabled={currentPage <= 1}
				class="flex h-10 w-10 items-center justify-center rounded-md border border-[#E01B41] text-[#E01B41] disabled:cursor-not-allowed disabled:opacity-25"
				onclick={() => goToPage(currentPage - 1)}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M15 18l-6-6 6-6" />
				</svg>
			</button>
			{#each pageNumbers as n (n)}
				<button
					type="button"
					aria-label="Halaman {n}"
					aria-current={n === currentPage ? "page" : undefined}
					class="h-10 w-10 rounded-md text-sm {n === currentPage
						? 'bg-[#E01B41] text-white'
						: 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}"
					onclick={() => goToPage(n)}
				>
					{n}
				</button>
			{/each}
			<button
				type="button"
				aria-label="Halaman berikutnya"
				disabled={currentPage >= updatePageCount}
				class="flex h-10 w-10 items-center justify-center rounded-md border border-[#E01B41] text-[#E01B41] disabled:cursor-not-allowed disabled:opacity-25"
				onclick={() => goToPage(currentPage + 1)}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M9 18l6-6-6-6" />
				</svg>
			</button>
		</nav>
	</section>

	<!-- Populer -->
	<section>
		<h2 class="mb-4 text-2xl font-semibold text-white">Populer</h2>
		<div class="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter populer">
			{#each POPULAR_TABS as tab (tab.id)}
				<button
					type="button"
					role="tab"
					aria-selected={popularTab === tab.id}
					class="rounded-md px-4 py-2 text-sm transition {tabClass(popularTab === tab.id)}"
					onclick={() => (popularTab = tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>
		{#if popularLoading}
			<div class="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-6" aria-label="Memuat konten populer">
				{#each Array.from({ length: 6 }) as _, i (i)}
					<div class="flex flex-col gap-2">
						<div class="aspect-[3/4] w-full animate-pulse rounded-lg bg-neutral-800"></div>
						<div class="h-4 w-3/4 animate-pulse rounded bg-neutral-800"></div>
					</div>
				{/each}
			</div>
		{:else if popular.length === 0}
			<p class="rounded-lg bg-neutral-900 p-6 text-center text-sm text-neutral-400">
				Belum ada konten populer untuk periode ini.
			</p>
		{:else}
			<div class="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-6">
				{#each popular as series (series.id)}
					<SeriesCard {series} showChapters={false} />
				{/each}
			</div>
		{/if}
	</section>
</div>
