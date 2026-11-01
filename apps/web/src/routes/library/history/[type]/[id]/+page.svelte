<script lang="ts">
import { ArrowLeft, BookMarked, BookOpen, Clapperboard } from "lucide-svelte";
import { onMount } from "svelte";
import {
	type AnimeDetail,
	formatEpisodeLabel,
	requestJson,
} from "#lib/admin.ts";
import { apiBase, coverUrl, getSeries } from "#lib/api.ts";
import {
	getHistoryList,
	type HistorySeriesEntry,
	refreshHistoryMeta,
} from "#lib/history.ts";
import { readerUrl } from "#lib/reader.ts";
import {
	decodeEntities,
	formatChapterLabel,
	formatTimeAgo,
} from "#lib/text.ts";
import { page } from "$app/state";

const rawType = $derived(page.params.type ?? "");
const seriesId = $derived(page.params.id ?? "");
const kind = $derived(
	rawType === "comic" || rawType === "anime" ? rawType : null,
);

let entry = $state<HistorySeriesEntry | null>(null);
let ready = $state(false);
let freshCover = $state<string | null | undefined>(undefined);
let fetchedKey = $state<string | null>(null);

function refresh() {
	if (!kind) {
		entry = null;
		ready = true;
		return;
	}
	entry =
		getHistoryList().find(
			(item) => item.type === kind && item.seriesId === seriesId,
		) ?? null;
	ready = true;
}

onMount(() => {
	refresh();
	window.addEventListener("storage", refresh);
	window.addEventListener("focus", refresh);
	return () => {
		window.removeEventListener("storage", refresh);
		window.removeEventListener("focus", refresh);
	};
});

$effect(() => {
	kind;
	seriesId;
	refresh();
});

$effect(() => {
	const initial = entry;
	if (!initial) return;
	const target: HistorySeriesEntry = initial;
	const key = `${target.type}:${target.seriesId}`;
	if (fetchedKey === key) return;
	fetchedKey = key;
	freshCover = undefined;
	const controller = new AbortController();
	let cancelled = false;
	async function loadFreshCover() {
		try {
			if (target.type === "comic") {
				const data = await getSeries(target.seriesId, controller.signal);
				if (cancelled) return;
				const next = data.coverImageUrl
					? coverUrl(data.id, data.updatedAt)
					: null;
				freshCover = next;
				if (next) {
					refreshHistoryMeta("comic", target.seriesId, {
						slug: data.slug,
						title: data.title,
						href: target.href,
						coverUpdatedAt: data.updatedAt,
						comicType: data.comicType,
						countryId: data.countryId,
					});
				}
			} else {
				const detail = await requestJson<AnimeDetail>(
					`/api/v1/anime/library/${encodeURIComponent(target.seriesId)}`,
					{ signal: controller.signal },
				);
				if (cancelled) return;
				let thumbnailSource = "local";
				try {
					const settingsPayload = await requestJson<{
						settings?: { thumbnailSource?: string };
					}>("/api/v1/anime/settings", { signal: controller.signal });
					thumbnailSource =
						settingsPayload.settings?.thumbnailSource ?? "local";
				} catch {
					if (controller.signal.aborted || cancelled) return;
				}
				if (cancelled) return;
				const sources = detail.thumbnailSources ?? [];
				const selected =
					sources.find((source) => source.key === thumbnailSource) ??
					sources.find((source) => source.key === "local") ??
					sources.find((source) => source.key === "otakudesu") ??
					sources[0] ??
					null;
				const next = selected
					? selected.url.startsWith("/")
						? `${apiBase()}${selected.url}`
						: selected.url
					: null;
				freshCover = next;
				if (next) {
					refreshHistoryMeta("anime", target.seriesId, {
						slug: target.seriesId,
						title: target.title,
						href: target.href,
						coverUrl: next,
					});
				}
			}
		} catch {
			if (!cancelled) freshCover = null;
		}
	}
	void loadFreshCover();
	return () => {
		cancelled = true;
		controller.abort();
	};
});
</script>

<svelte:head>
	<title>{entry ? `${decodeEntities(entry.title)} · History · MIFE` : "History · MIFE"}</title>
</svelte:head>

<main class="mx-auto max-w-7xl px-4 pt-3 pb-6 min-[521px]:pb-24 sm:px-6 sm:pt-4 sm:pb-10">
	<a
		href="/library?type=history"
		class="inline-flex min-h-10 items-center gap-2 rounded-full border px-4 font-semibold text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
	>
		<ArrowLeft class="size-4" />
		Kembali ke History
	</a>

	{#if !ready}
		<div class="mt-6" aria-label="Memuat history">
			<div class="flex items-center gap-4">
				<div class="size-20 animate-pulse rounded-2xl bg-card sm:size-24" aria-hidden="true"></div>
				<div class="flex-1 space-y-2" aria-hidden="true">
					<div class="h-4 w-24 animate-pulse rounded-lg bg-card"></div>
					<div class="h-8 w-48 animate-pulse rounded-xl bg-card"></div>
				</div>
			</div>
			<div class="chapter-grid mt-6" aria-hidden="true">
				{#each [0, 1, 2, 3] as i (i)}
					<div class="h-20 animate-pulse rounded-xl bg-card"></div>
				{/each}
			</div>
		</div>
	{:else if !kind || !entry}
		<div class="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center" role="alert">
			<p class="text-destructive text-sm">History tidak ditemukan.</p>
			<a
				href="/library?type=history"
				class="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-bold text-primary-foreground text-sm transition hover:opacity-90"
			>
				Kembali ke History
			</a>
		</div>
	{:else}
		{@const storedCover =
			entry.type === "comic"
				? coverUrl(entry.seriesId, entry.coverUpdatedAt ?? undefined)
				: (entry.coverUrl ?? null)}
		{@const cover = freshCover ?? storedCover}
		{@const ago = formatTimeAgo(entry.lastReadAt)}
		<header class="mt-6 flex items-center gap-4">
			<span class="relative grid aspect-[.69] w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-card sm:w-28">
				{#if cover}
					<img src={cover} alt="" loading="lazy" class="h-full w-full object-cover" />
				{:else if entry.type === "anime"}
					<Clapperboard class="size-8 text-muted-foreground" />
				{:else}
					<BookMarked class="size-8 text-muted-foreground" />
				{/if}
			</span>
			<div class="min-w-0 flex-1">
				<p class="font-bold text-[10px] text-primary uppercase tracking-[0.18em]">
					{entry.type === "comic" ? "Comic" : "Anime"} · {entry.chapters.length}
					{entry.type === "comic" ? "chapter dibaca" : "episode ditonton"}
				</p>
				<h1 class="mt-1 min-w-0 truncate font-extrabold text-2xl sm:text-3xl">
					{decodeEntities(entry.title)}
				</h1>
				{#if ago}
					<p class="mt-1 text-muted-foreground text-sm">
						Terakhir {entry.type === "comic" ? "dibaca" : "ditonton"} {ago} lalu
					</p>
				{/if}
			</div>
		</header>

		<section
			aria-label={entry.type === "comic" ? "Chapter yang telah dibaca" : "Episode yang telah ditonton"}
			class="mt-6"
		>
			<h2 class="font-extrabold text-lg">
				{entry.type === "comic" ? "Chapter yang telah dibaca" : "Episode yang telah ditonton"}
			</h2>
			<div class="chapter-grid mt-4">
				{#each entry.chapters as chapter (chapter.id)}
					{@const readAgo = formatTimeAgo(chapter.readAt)}
					{@const readLabel = readAgo ? `${readAgo} lalu` : null}
					{@const href =
						entry.type === "comic"
							? readerUrl(entry.slug, chapter.normalizedNumber ?? chapter.numberText)
							: `/anime/watch/${chapter.id}`}
					<a href={href} class="chapter-card group">
						<span class="chapter-thumb">
							<span class="poster-placeholder" aria-hidden="true">
								{#if entry.type === "comic"}
									<BookOpen class="size-7" />
								{:else}
									<Clapperboard class="size-7" />
								{/if}
							</span>
						</span>
						<span class="chapter-card-copy">
							<span class="chapter-card-title">
								{entry.type === "comic"
									? formatChapterLabel(chapter.numberText, chapter.title)
									: formatEpisodeLabel(chapter.numberText, chapter.title)}
							</span>
							{#if readLabel}
								<time
									datetime={chapter.readAt}
									title={readLabel}
									aria-label={readLabel}
									class="chapter-card-age"
								>
									{readLabel}
								</time>
							{/if}
						</span>
					</a>
				{/each}
			</div>
		</section>
	{/if}
</main>
