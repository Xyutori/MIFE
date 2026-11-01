<script lang="ts">
import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	Clapperboard,
	House,
	Play,
	Search,
	X,
} from "lucide-svelte";
import { onMount } from "svelte";
import {
	type AnimeDetail,
	type AnimeEpisode,
	decodeEntities,
	formatDateId,
	formatEpisodeLabel,
	requestJson,
} from "#lib/admin.ts";
import { apiBase } from "#lib/api.ts";
import BookmarkButton from "#lib/components/BookmarkButton.svelte";

type DetailPayload = AnimeDetail;
type EpisodesPayload = {
	items?: AnimeEpisode[];
	total?: number;
	hasMore?: boolean;
	pageSize?: number;
};
type AnimeSettings = {
	settings?: { thumbnailSource?: string };
};

let { animeId }: { animeId: string } = $props();

let data = $state<AnimeDetail | null>(null);
let error = $state("");
let thumbnailSource = $state("local");
let loadingMore = $state(false);
let episodeSearch = $state("");
let episodeSort = $state<"recent" | "oldest">("recent");

// Posisi tonton tersimpan per episode (detik).
let positions = $state<Record<string, number>>({});

function readPositions() {
	try {
		const next: Record<string, number> = {};
		for (let index = 0; index < localStorage.length; index += 1) {
			const key = localStorage.key(index);
			if (key?.startsWith("symi:anime:pos:")) {
				const value = Number(localStorage.getItem(key));
				if (Number.isFinite(value) && value > 0)
					next[key.slice("symi:anime:pos:".length)] = value;
			}
		}
		positions = next;
	} catch {
		positions = {};
	}
}

function lastEpisodeId(): string | null {
	try {
		return localStorage.getItem(`symi:anime:last:${animeId}`);
	} catch {
		return null;
	}
}

function formatPosition(seconds: number): string {
	const totalSeconds = Math.floor(seconds);
	const minutes = Math.floor(totalSeconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0)
		return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
	return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

onMount(() => {
	const controller = new AbortController();
	data = null;
	error = "";
	episodeSearch = "";
	episodeSort = "recent";
	readPositions();
	requestJson<DetailPayload>(
		`/api/v1/anime/library/${encodeURIComponent(animeId)}`,
		{ signal: controller.signal },
	)
		.then((payload) => {
			data = payload;
		})
		.catch((cause) => {
			if ((cause as Error)?.name === "AbortError") return;
			error = cause instanceof Error ? cause.message : "Anime gagal dimuat.";
		});
	requestJson<AnimeSettings>("/api/v1/anime/settings", {
		signal: controller.signal,
	})
		.then((payload) => {
			thumbnailSource = payload.settings?.thumbnailSource ?? "local";
		})
		.catch(() => undefined);
	return () => controller.abort();
});

async function loadMore() {
	if (!data || loadingMore || !data.episodePagination.hasMore) return;
	loadingMore = true;
	try {
		const nextPage =
			Math.floor(data.episodes.length / data.episodePagination.pageSize) + 1;
		const payload = await requestJson<EpisodesPayload>(
			`/api/v1/anime/library/${encodeURIComponent(animeId)}/episodes?page=${nextPage}&pageSize=${data.episodePagination.pageSize}`,
		);
		data = {
			...data,
			episodes: [...data.episodes, ...(payload.items ?? [])],
			episodePagination: {
				total: payload.total ?? data.episodePagination.total,
				hasMore: payload.hasMore ?? false,
				pageSize: payload.pageSize ?? data.episodePagination.pageSize,
			},
		};
	} catch (cause) {
		error =
			cause instanceof Error
				? cause.message
				: "Episode berikutnya gagal dimuat.";
	} finally {
		loadingMore = false;
	}
}

const selectedThumbnail = $derived(
	data
		? (data.thumbnailSources.find((source) => source.key === thumbnailSource) ??
				data.thumbnailSources.find((source) => source.key === "local") ??
				data.thumbnailSources.find((source) => source.key === "otakudesu") ??
				data.thumbnailSources[0] ??
				null)
		: null,
);
const cover = $derived(
	selectedThumbnail
		? selectedThumbnail.url.startsWith("/")
			? `${apiBase()}${selectedThumbnail.url}`
			: selectedThumbnail.url
		: null,
);
const continueEpisode = $derived.by(() => {
	if (!data) return null;
	const lastId = lastEpisodeId();
	return data.episodes.find((episode) => episode.id === lastId) ?? null;
});
// Pencarian & urutan episode dilakukan di sisi klien (endpoint episode
// hanya mendukung page/pageSize, tanpa q/sort seperti chapter komik).
const visibleEpisodes = $derived.by(() => {
	if (!data) return [];
	const q = episodeSearch.trim().toLowerCase();
	const filtered = q
		? data.episodes.filter((episode) =>
				`${episode.numberText} ${episode.title ?? ""}`
					.toLowerCase()
					.includes(q),
			)
		: [...data.episodes];
	if (episodeSort === "oldest") filtered.reverse();
	return filtered;
});
</script>

<svelte:head>
	<title>{data ? `${decodeEntities(data.title)} · MIFE` : "Detail Anime · MIFE"}</title>
</svelte:head>

{#if error && !data}
	<main class="detail-page mx-auto min-h-[70vh] max-w-4xl px-4 py-12">
		<div class="rounded-2xl border border-destructive/30 bg-destructive/5 p-6" role="alert">
			<p class="font-semibold">Anime tidak ditemukan</p>
			<p class="mt-1 text-muted-foreground text-sm">{error}</p>
		</div>
	</main>
{:else if !data}
	<main class="detail-page mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8" aria-busy="true" aria-label="Memuat detail anime">
		<section class="detail-stage">
			<div class="detail-backdrop" aria-hidden="true"></div>
			<div class="detail-top-actions" aria-hidden="true">
				<span class="detail-icon-action animate-pulse"></span>
				<span class="detail-icon-action animate-pulse"></span>
			</div>
			<div class="detail-hero" aria-hidden="true">
				<div class="detail-cover animate-pulse bg-card"></div>
				<div class="detail-copy detail-skeleton-copy">
					<span class="detail-skeleton-eyebrow animate-pulse"></span>
					<span class="detail-skeleton-title animate-pulse"></span>
					<span class="detail-skeleton-subtitle animate-pulse"></span>
					<div class="detail-skeleton-facts">
						<span class="animate-pulse"></span>
						<span class="animate-pulse"></span>
						<span class="animate-pulse"></span>
					</div>
					<div class="detail-skeleton-tags">
						<span class="animate-pulse"></span>
						<span class="animate-pulse"></span>
						<span class="animate-pulse"></span>
					</div>
					<span class="detail-skeleton-description animate-pulse"></span>
				</div>
			</div>
		</section>
		<span class="sr-only" role="status">Memuat detail anime</span>
	</main>
{:else}
	<main class="detail-page mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
		<section class="detail-stage">
			<div
				class="detail-backdrop"
				aria-hidden="true"
				style={cover ? `background-image: url(${cover})` : undefined}
			></div>
			<div class="detail-top-actions">
				<a
					href="/anime"
					aria-label="Kembali"
					title="Kembali"
					class="detail-icon-action"
				>
					<ArrowLeft class="size-6" />
				</a>
				<a
					href="/"
					aria-label="Beranda"
					title="Beranda"
					class="detail-icon-action"
				>
					<House class="size-6" />
				</a>
			</div>
			<div class="detail-hero">
				<div class="detail-cover">
					{#if cover}
						<img
							src={cover}
							alt=""
							class="aspect-[.7] w-full object-cover"
						/>
					{:else}
						<div class="poster-placeholder" aria-hidden="true">
							<Clapperboard class="size-12" />
						</div>
					{/if}
				</div>

				<div class="detail-copy">
					<h1>{decodeEntities(data.title)}</h1>
					{#if data.alternativeTitle}
						<p class="detail-alternative-title">{decodeEntities(data.alternativeTitle)}</p>
					{/if}

					{#if data.score !== null || data.releaseYear !== null || data.status !== null}
						<div class="detail-stats">
							{#if data.score !== null}
								<span>★ {data.score.toFixed(1)}</span>
							{/if}
							{#if data.releaseYear !== null}
								<span>{data.releaseYear}</span>
							{/if}
							{#if data.status}
								<span>{decodeEntities(data.status)}</span>
							{/if}
						</div>
					{/if}

					{#if data.studio || data.animeType}
						<div class="detail-credits">
							{#if data.studio}
								<p><b>Studio</b> · {decodeEntities(data.studio)}</p>
							{/if}
							{#if data.animeType}
								<p><b>Tipe</b> · {decodeEntities(data.animeType)}</p>
							{/if}
						</div>
					{/if}

					{#if data.genres.length > 0}
						<div class="detail-genres">
							{#each data.genres as genre (genre)}
								<span class="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
									{decodeEntities(genre)}
								</span>
							{/each}
						</div>
					{/if}

					<div class="detail-actions">
						{#if continueEpisode}
							<a
								href="/anime/watch/{continueEpisode.id}"
								class="detail-primary-action"
							>
								Lanjutkan {formatEpisodeLabel(continueEpisode.numberText)}
							</a>
						{:else if data.episodes[0]}
							<a
								href="/anime/watch/{data.episodes[0].id}"
								class="detail-primary-action"
							>
								Tonton
							</a>
						{/if}
						<BookmarkButton type="anime" seriesId={animeId} title={data?.title ?? ""} />
					</div>

					{#if data.synopsis}
						<div class="detail-description">
							<h2 class="sr-only">Sinopsis</h2>
							<p>{decodeEntities(data.synopsis)}</p>
						</div>
					{/if}
				</div>
			</div>
		</section>

		<section id="episode-list" class="detail-section mt-10 scroll-mt-6">
			<div class="flex flex-wrap items-end justify-between gap-3">
				<h2 class="font-display font-bold text-xl">Semua episode</h2>
				{#if data.episodePagination.total > 0}
					<span class="detail-count">{data.episodePagination.total.toLocaleString("id-ID")}</span>
				{/if}
			</div>

			<div class="detail-chapter-tools mt-4 grid grid-cols-[minmax(0,1fr)_3.75rem] gap-3">
				<div class="detail-chapter-search relative">
					<Search class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
					<input
						type="search"
						bind:value={episodeSearch}
						placeholder="Cari nomor episode"
						aria-label="Cari episode"
						class="h-12 w-full rounded-xl border border-border/80 bg-card pr-11 pl-11 text-sm outline-none placeholder:text-muted-foreground"
					/>
					{#if episodeSearch}
						<button
							type="button"
							onclick={() => (episodeSearch = "")}
							aria-label="Hapus pencarian episode"
							class="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent"
						>
							<X class="size-4" />
						</button>
					{/if}
				</div>
				<div class="detail-chapter-sort">
					<button
						type="button"
						onclick={() => (episodeSort = episodeSort === "recent" ? "oldest" : "recent")}
						aria-label={episodeSort === "recent" ? "Urutkan dari episode terlama" : "Urutkan dari episode terbaru"}
						title={episodeSort === "recent" ? "Terbaru dulu" : "Terlama dulu"}
						aria-pressed={episodeSort === "oldest"}
						class="detail-sort-toggle"
					>
						{#if episodeSort === "recent"}
							<ArrowDown aria-hidden="true" />
						{:else}
							<ArrowUp aria-hidden="true" />
						{/if}
					</button>
				</div>
			</div>

			{#if loadingMore}
				<span class="sr-only" role="status">Memuat episode</span>
			{/if}

			{#if visibleEpisodes.length === 0}
				<div class="mt-4 grid place-items-center gap-2 rounded-2xl border border-dashed border-border py-12 text-center">
					<Clapperboard class="size-6 text-muted-foreground" />
					<p class="font-semibold text-sm">
						{episodeSearch.trim() ? "Episode tidak ditemukan" : "Daftar episode belum tersedia"}
					</p>
				</div>
			{:else}
				<div class="chapter-grid mt-4">
					{#each visibleEpisodes as episode (episode.id)}
						{@const released = formatDateId(episode.releasedAt)}
						<a
							href="/anime/watch/{episode.id}"
							class="chapter-card group"
						>
							<span class="chapter-thumb">
								<span class="poster-placeholder" aria-hidden="true">
									<Play class="size-7" />
								</span>
							</span>
							<span class="chapter-card-copy">
								<span class="chapter-card-title">
									{formatEpisodeLabel(episode.numberText, episode.title)}
								</span>
								{#if released || positions[episode.id]}
									<span class="chapter-card-age">
										{#if released}{released}{/if}
										{#if positions[episode.id]}
											{released ? " · " : ""}Lanjut {formatPosition(positions[episode.id])}
										{/if}
									</span>
								{/if}
							</span>
						</a>
					{/each}
				</div>
			{/if}

			{#if data.episodePagination.hasMore}
				<div class="mt-4 text-center">
					<button
						type="button"
						disabled={loadingMore}
						onclick={() => void loadMore()}
						class="detail-secondary-action inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 font-bold text-sm disabled:opacity-50"
					>
						{loadingMore ? "Memuat episode…" : "Muat episode lama"}
					</button>
				</div>
			{/if}
		</section>
	</main>
{/if}
