<script lang="ts">
import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	Bookmark,
	BookOpen,
	Eye,
	House,
	LoaderCircle,
	Play,
	Search,
	Star,
	Trophy,
	X,
} from "lucide-svelte";
import {
	type ChapterListItem,
	chapterThumbnailUrl,
	coverUrl,
	getSeries,
	getSeriesChapters,
	type SeriesDetail,
} from "#lib/api.ts";
import BookmarkButton from "#lib/components/BookmarkButton.svelte";
import Pagination from "#lib/components/Pagination.svelte";
import { readerUrl } from "#lib/reader.ts";
import {
	cleanNames,
	decodeEntities,
	formatChapterLabel,
	formatTimeAgo,
} from "#lib/text.ts";
import type { PageProps } from "./$types";

let { data: routeData }: PageProps = $props();
const seriesId = $derived(routeData.params.id);

let data = $state<SeriesDetail | null>(null);
let error = $state("");
let chapterItems = $state<ChapterListItem[]>([]);
let chapterTotal = $state(0);
let chapterPage = $state(1);
let chapterPageSize = $state(30);
let chapterSort = $state<"recent" | "oldest">("recent");
let chapterSearch = $state("");
let debouncedSearch = $state("");
let chaptersReady = $state(false);
let loadingChapters = $state(false);
let chapterError = $state("");
let newestChapterId = $state<string | null>(null);
let synopsisExpanded = $state(false);
let synopsisLong = $state(false);
let synopsisEl: HTMLParagraphElement | undefined = $state(undefined);

const chapterPageCount = $derived(
	Math.max(1, Math.ceil(chapterTotal / chapterPageSize)),
);
const initialChaptersLoading = $derived(
	loadingChapters && chapterItems.length === 0,
);
const pageChaptersLoading = $derived(
	loadingChapters && chapterItems.length > 0,
);

const comicOrigins = [
	{
		flag: "🇯🇵",
		name: "Jepang",
		aliases: ["jp", "jpn", "japan", "japanese", "manga", "doujinshi"],
	},
	{
		flag: "🇨🇳",
		name: "Tiongkok",
		aliases: ["cn", "chn", "china", "chinese", "tiongkok", "cina", "manhua"],
	},
	{
		flag: "🇰🇷",
		name: "Korea Selatan",
		aliases: ["kr", "kor", "korea", "korean", "manhwa", "webtoon"],
	},
	{
		flag: "🇮🇩",
		name: "Indonesia",
		aliases: ["id", "idn", "indonesia", "indonesian", "lokal"],
	},
	{ flag: "🇹🇭", name: "Thailand", aliases: ["th", "tha", "thailand", "thai"] },
	{
		flag: "🇻🇳",
		name: "Vietnam",
		aliases: ["vn", "vnm", "vietnam", "vietnamese"],
	},
	{ flag: "🇹🇼", name: "Taiwan", aliases: ["tw", "twn", "taiwan", "taiwanese"] },
	{
		flag: "🇫🇷",
		name: "Prancis",
		aliases: ["fr", "fra", "france", "french", "prancis"],
	},
	{
		flag: "🇺🇸",
		name: "Amerika Serikat",
		aliases: ["us", "usa", "united states", "american"],
	},
];

function comicOrigin(
	countryId: string | null,
	comicType: string | null,
	formats: string[],
) {
	const normalize = (value: string | null) =>
		value
			?.normalize("NFKD")
			.replace(/\p{Diacritic}/gu, "")
			.toLowerCase()
			.trim();
	const country = normalize(countryId);
	if (country) {
		const match = comicOrigins.find(({ aliases }) =>
			aliases.some(
				(alias) =>
					country === alias || (alias.length > 2 && country.includes(alias)),
			),
		);
		if (match) return match;
	}
	const values = [comicType, ...formats]
		.map((value) => normalize(value))
		.filter((value): value is string => Boolean(value));
	return comicOrigins.find(({ aliases }) =>
		aliases.some((alias) =>
			values.some(
				(value) =>
					value === alias || (alias.length > 2 && value.includes(alias)),
			),
		),
	);
}

function goBack() {
	if (window.history.length > 1) window.history.back();
	else window.location.assign("/");
}

function formatCompact(value: number): string {
	return new Intl.NumberFormat("en", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

$effect(() => {
	seriesId;
	const controller = new AbortController();
	let active = true;
	data = null;
	error = "";
	chaptersReady = false;
	chapterPage = 1;
	chapterSort = "recent";
	chapterSearch = "";
	debouncedSearch = "";
	chapterError = "";
	newestChapterId = null;
	synopsisExpanded = false;
	synopsisLong = false;
	void getSeries(seriesId, controller.signal)
		.then((payload) => {
			if (!active) return;
			data = payload;
			chapterItems = payload.chapters ?? [];
			newestChapterId = payload.chapters?.[0]?.chapter.id ?? null;
			chapterTotal = payload.chapterPagination?.total ?? 0;
			chapterPageSize = payload.chapterPagination?.pageSize ?? 30;
			chaptersReady = true;
		})
		.catch((cause: unknown) => {
			if (!active) return;
			if (cause instanceof DOMException && cause.name === "AbortError") return;
			error = cause instanceof Error ? cause.message : "Gagal memuat judul.";
		});
	return () => {
		active = false;
		controller.abort();
	};
});

let debounce: ReturnType<typeof setTimeout> | undefined;
$effect(() => {
	chapterSearch;
	clearTimeout(debounce);
	debounce = setTimeout(() => {
		debouncedSearch = chapterSearch.trim();
		chapterPage = 1;
	}, 250);
});

$effect(() => {
	if (!chaptersReady || !data) return;
	const id = data.id;
	const params = {
		page: chapterPage,
		pageSize: chapterPageSize,
		sort: chapterSort,
		q: debouncedSearch,
	};
	// Lewati fetch pertama: halaman awal sudah termasuk di respons detail.
	if (chapterPage === 1 && chapterSort === "recent" && !debouncedSearch) return;
	let active = true;
	const controller = new AbortController();
	loadingChapters = true;
	chapterError = "";
	void getSeriesChapters(id, params, controller.signal)
		.then((payload) => {
			if (!active) return;
			chapterItems = payload.items;
			chapterTotal = payload.total;
		})
		.catch((cause: unknown) => {
			if (!active) return;
			if (cause instanceof DOMException && cause.name === "AbortError") return;
			chapterError =
				cause instanceof Error ? cause.message : "Daftar chapter gagal dimuat.";
		})
		.finally(() => {
			if (active) loadingChapters = false;
		});
	return () => {
		active = false;
		controller.abort();
	};
});

// Deteksi sinopsis panjang: ukur 3 baris, tampilkan toggle bila meluap.
$effect(() => {
	const node = synopsisEl;
	if (!node || synopsisExpanded || !data?.description) return;
	const measure = () => {
		if (synopsisExpanded) return;
		const clone = node.cloneNode(true) as HTMLParagraphElement;
		clone.classList.remove("is-clamped", "is-expanded");
		clone.classList.add("is-measuring");
		clone.style.width = `${node.getBoundingClientRect().width}px`;
		node.parentElement?.append(clone);
		const lineHeight = Number.parseFloat(getComputedStyle(clone).lineHeight);
		synopsisLong = clone.scrollHeight > lineHeight * 3 + 1;
		clone.remove();
	};
	measure();
	const observer = new ResizeObserver(measure);
	observer.observe(node);
	return () => observer.disconnect();
});

const authors = $derived(cleanNames(data?.authors ?? []));
const artists = $derived(cleanNames(data?.artists ?? []));
const origin = $derived(
	data
		? comicOrigin(data.countryId, data.comicType, data.formats ?? [])
		: undefined,
);
const cover = $derived(
	data?.coverImageUrl ? coverUrl(data.id, data.updatedAt) : null,
);
</script>

<svelte:head>
	<title>{data ? `${decodeEntities(data.title)} · MIFE` : "Detail · MIFE"}</title>
</svelte:head>

{#if error}
	<main class="detail-page mx-auto min-h-[70vh] max-w-4xl px-4 py-12">
		<div class="rounded-2xl border border-destructive/30 bg-destructive/5 p-6" role="alert">
			<p class="font-semibold">Judul tidak ditemukan</p>
			<p class="mt-1 text-muted-foreground text-sm">{error}</p>
		</div>
	</main>
{:else if !data}
	<main class="detail-page mx-auto min-h-screen max-w-7xl px-4 sm:px-6 lg:px-8" aria-busy="true" aria-label="Memuat detail komik">
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
					<div class="detail-skeleton-lines">
						<span class="animate-pulse"></span>
						<span class="animate-pulse"></span>
						<span class="animate-pulse"></span>
					</div>
					<span class="detail-skeleton-description animate-pulse"></span>
				</div>
			</div>
		</section>
		<section class="detail-section mt-10" aria-hidden="true">
			<div class="flex flex-wrap items-end justify-between gap-3">
				<h2 class="font-display font-bold text-xl">Semua chapter</h2>
				<span class="detail-skeleton-count animate-pulse"></span>
			</div>
			<div class="detail-chapter-tools mt-4 grid grid-cols-[minmax(0,1fr)_3.75rem] gap-3">
				<div class="detail-chapter-search relative">
					<Search class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
					<input
						type="search"
						disabled
						placeholder="Cari nomor chapter"
						aria-label="Cari chapter"
						class="detail-skeleton-search h-12 rounded-xl pr-11 pl-11"
					/>
				</div>
				<div class="detail-chapter-sort">
					<span class="detail-sort-toggle" aria-hidden="true">
						<ArrowDown aria-hidden="true" />
					</span>
				</div>
			</div>
			<div class="chapter-grid mt-4" aria-hidden="true">
				{#each Array.from({ length: 6 }, (_, index) => index) as index (index)}
					<div class="chapter-card" aria-hidden="true">
						<div class="chapter-thumb animate-pulse"></div>
						<div class="chapter-card-copy space-y-2">
							<div class="detail-skeleton-row-title animate-pulse"></div>
							<div class="detail-skeleton-row-meta animate-pulse"></div>
						</div>
					</div>
				{/each}
			</div>
		</section>
		<span class="sr-only" role="status">Memuat detail komik</span>
	</main>
{:else}
	<main class="detail-page mx-auto min-h-screen max-w-7xl px-4 sm:px-6 lg:px-8">
		<section class="detail-stage">
			<div
				class="detail-backdrop"
				aria-hidden="true"
				style={cover ? `background-image: url(${cover})` : undefined}
			></div>
			<div class="detail-top-actions">
				<button
					type="button"
					onclick={goBack}
					aria-label="Kembali"
					title="Kembali"
					class="detail-icon-action"
				>
					<ArrowLeft class="size-6" />
				</button>
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
							<BookOpen class="size-12" />
						</div>
					{/if}
				</div>

				<div class="detail-copy">
					<h1>{decodeEntities(data.title)}</h1>
					{#if data.alternativeTitle}
						<p class="detail-alternative-title">{decodeEntities(data.alternativeTitle)}</p>
					{/if}

					<div class="detail-stats">
						{#if data.rating !== null}
							<span>
								<Star class="size-5 fill-current text-primary" />
								{data.rating.toFixed(1)}
							</span>
						{/if}
						{#if data.bookmarkCount !== null}
							<span>
								<Bookmark class="size-5 text-muted-foreground" />
								{data.bookmarkCount.toLocaleString("id-ID")}
							</span>
						{/if}
						{#if data.viewCount !== null}
							<span>
								<Eye class="size-5 text-muted-foreground" />
								{formatCompact(data.viewCount)}
							</span>
						{/if}
						{#if data.popularityRank !== null}
							<span>
								<Trophy class="size-5 text-muted-foreground" />
								{data.popularityRank.toLocaleString("id-ID")}
							</span>
						{/if}
					</div>

					{#if authors.length > 0 || artists.length > 0}
						<div class="detail-credits">
							{#if authors.length > 0}
								<p><b>Author</b> · {authors.join(", ")}</p>
							{/if}
							{#if artists.length > 0}
								<p><b>Artist</b> · {artists.join(", ")}</p>
							{/if}
						</div>
					{/if}

					{#if data.genres.length > 0}
						<div class="detail-genres">
							{#each data.genres as genre (genre)}
								<span class="detail-genre rounded-full border border-border bg-secondary px-2.5 py-1 text-muted-foreground text-xs">
									{decodeEntities(genre)}
								</span>
							{/each}
						</div>
					{/if}

					{#if data.formats.length > 0}
						<div class="detail-formats" aria-label="Format komik">
							{#each data.formats as format (format)}
								<span class="detail-format-badge inline-flex items-center rounded-full border px-2.5 py-1" aria-label={origin ? `${origin.name} · ${format}` : format}>
									{#if origin}
										<span aria-hidden="true" class="detail-format-flag">{origin.flag}</span>
									{/if}
									{decodeEntities(format)}
								</span>
							{/each}
						</div>
					{/if}

					<div class="detail-actions">
						{#if data.chapters[0]}
							<a
								href={readerUrl(data.slug, data.chapters[0].chapter.normalizedNumber)}
								class="detail-primary-action"
							>
								<Play class="size-4 fill-current" />
								Baca
							</a>
						{/if}
						<BookmarkButton
							type="comic"
							seriesId={data.id}
							title={data.title}
							href={`/komik/${data.slug}`}
						/>
					</div>

					{#if data.description}
						<div class="detail-description">
							<h2 class="sr-only">Sinopsis</h2>
							<p
								bind:this={synopsisEl}
								class={`detail-synopsis-copy ${synopsisExpanded ? "is-expanded" : "is-clamped"}`}
							>{data.description}</p>
							{#if synopsisLong}
								<button
									type="button"
									class="detail-synopsis-toggle"
									aria-expanded={synopsisExpanded}
									onclick={() => (synopsisExpanded = !synopsisExpanded)}
								>
									{synopsisExpanded ? "Lebih sedikit" : "Selengkapnya"}
								</button>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</section>

		<section id="chapter-list" class="detail-section mt-10 scroll-mt-6">
			<div class="flex flex-wrap items-end justify-between gap-3">
				<h2 class="font-display font-bold text-xl">Semua chapter</h2>
				{#if chapterTotal > 0}
					<span class="detail-count">{chapterTotal.toLocaleString("id-ID")}</span>
				{/if}
			</div>

			<div class="detail-chapter-tools mt-4 grid grid-cols-[minmax(0,1fr)_3.75rem] gap-3">
				<div class="detail-chapter-search relative">
					<Search class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
					<input
						type="search"
						bind:value={chapterSearch}
						placeholder="Cari nomor chapter"
						aria-label="Cari chapter"
						class="h-12 w-full rounded-xl border border-border/80 bg-card pr-11 pl-11 text-sm outline-none placeholder:text-muted-foreground"
					/>
					{#if chapterSearch}
						<button
							type="button"
							onclick={() => (chapterSearch = "")}
							aria-label="Hapus pencarian chapter"
							class="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent"
						>
							<X class="size-4" />
						</button>
					{/if}
				</div>
				<div class="detail-chapter-sort">
					<button
						type="button"
						onclick={() => (chapterSort = chapterSort === "recent" ? "oldest" : "recent")}
						aria-label={chapterSort === "recent" ? "Urutkan dari chapter terlama" : "Urutkan dari chapter terbaru"}
						title={chapterSort === "recent" ? "Urutkan dari chapter terlama" : "Urutkan dari chapter terbaru"}
						aria-pressed={chapterSort === "oldest"}
						class="detail-sort-toggle"
					>
						{#if chapterSort === "recent"}
							<ArrowDown aria-hidden="true" />
						{:else}
							<ArrowUp aria-hidden="true" />
						{/if}
					</button>
				</div>
			</div>

			{#if loadingChapters}
				<span class="sr-only" role="status">Memuat chapter</span>
			{/if}
			{#if chapterError}
				<p class="mt-2 text-destructive text-xs" role="alert">{chapterError}</p>
			{/if}

			{#if initialChaptersLoading}
				<div class="chapter-grid mt-4" aria-busy="true">
					{#each Array.from({ length: 6 }, (_, index) => index) as index (index)}
						<div class="chapter-card" aria-hidden="true">
							<div class="chapter-thumb animate-pulse"></div>
							<div class="chapter-card-copy space-y-2">
								<div class="detail-skeleton-row-title animate-pulse"></div>
								<div class="detail-skeleton-row-meta animate-pulse"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else if chapterItems.length === 0 && !loadingChapters}
				<div class="mt-3 grid place-items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
					<span class="grid size-11 place-items-center rounded-2xl bg-secondary text-muted-foreground">
						<BookOpen class="size-5" />
					</span>
					<p class="font-semibold text-sm">
						{chapterSearch.trim() ? "Chapter tidak ditemukan" : "Daftar chapter belum tersedia"}
					</p>
					<p class="max-w-sm text-muted-foreground text-xs leading-5">
						{chapterSearch.trim()
							? `Tidak ada hasil untuk “${chapterSearch.trim()}”. Coba kata kunci lain.`
							: "Coba kembali lagi nanti saat chapter sudah ditambahkan."}
					</p>
					{#if chapterSearch.trim()}
						<button
							type="button"
							onclick={() => (chapterSearch = "")}
							class="mt-3 rounded-full bg-secondary px-3 py-2 font-semibold text-secondary-foreground text-xs hover:bg-accent"
						>
							Hapus pencarian
						</button>
					{/if}
				</div>
			{:else}
				<div class="relative">
					<div class="chapter-grid mt-4" aria-busy={pageChaptersLoading}>
						{#each chapterItems as { chapter, sources } (chapter.id)}
						{@const age = formatTimeAgo(chapter.createdAt)}
						{@const thumbnailSource = sources.find((entry) => entry.thumbnailUrl)}
						{@const thumbnail = thumbnailSource
							? chapterThumbnailUrl(chapter.id, thumbnailSource.key, thumbnailSource.updatedAt)
							: null}
						{@const ageLabel = age ? `${age} lalu` : null}
						<a
							href={readerUrl(data.slug, chapter.normalizedNumber)}
							class="chapter-card group"
						>
							<span class="chapter-thumb">
								{#if thumbnail}
									<img src={thumbnail} alt="" loading="lazy" class="size-full object-cover" />
								{:else}
									<span class="poster-placeholder" aria-hidden="true">
										<BookOpen class="size-7" />
									</span>
								{/if}
								{#if chapter.id === newestChapterId}
									<span class="chapter-up-badge">UP</span>
								{/if}
							</span>
							<span class="chapter-card-copy">
								<span class="chapter-card-title">
									{formatChapterLabel(chapter.numberText, chapter.title)}
								</span>
								{#if ageLabel}
									<time datetime={chapter.createdAt} title={ageLabel} aria-label={ageLabel} class="chapter-card-age">{ageLabel}</time>
								{/if}
							</span>
						</a>
					{/each}
					</div>
					{#if pageChaptersLoading}
						<div class="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-background/60 backdrop-blur-[1px]">
							<span class="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card px-4 py-2 text-muted-foreground text-sm shadow-lg">
								<LoaderCircle class="size-4 animate-spin text-primary" aria-hidden="true" />
								<span class="sr-only" role="status">Memuat chapter berikutnya</span>
								<span aria-hidden="true">Memuat…</span>
							</span>
						</div>
					{/if}
				</div>
			{/if}

			<Pagination
				page={chapterPage}
				pageCount={chapterPageCount}
				loading={loadingChapters}
				label="daftar chapter"
				onChange={(next) => (chapterPage = next)}
			/>
		</section>
	</main>
{/if}
