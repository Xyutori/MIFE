<script lang="ts">
import { BookOpen } from "lucide-svelte";
import { coverUrl, type Series } from "#lib/api.ts";
import { comicTypeInfo } from "#lib/components/catalog/comic-types.ts";
import {
	decodeEntities,
	formatChapterLabel,
	formatTimeAgo,
} from "#lib/text.ts";

interface Props {
	series: Series;
	href: string;
	id?: string;
	badge?: string | null;
}

let { series, href, id, badge = null }: Props = $props();

const cover = $derived(
	series.coverImageUrl ? coverUrl(series.id, series.updatedAt) : null,
);
const latest = $derived(
	series.latestChapters?.length
		? series.latestChapters.slice(0, 2)
		: series.latestChapterNumber
			? [{ id: `${series.id}:latest`, numberText: series.latestChapterNumber }]
			: [],
);
const recentUpdate = $derived.by(() => {
	const createdAt = latest[0]?.createdAt;
	if (!createdAt) return false;
	const timestamp = Date.parse(createdAt);
	if (!Number.isFinite(timestamp)) return false;
	return Math.max(0, Date.now() - timestamp) <= 24 * 60 * 60 * 1000;
});
const typeInfo = $derived(comicTypeInfo(series.comicType, series.countryId));
</script>

<a
	{href}
	{id}
	class="catalog-card group min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card transition duration-200 hover:-translate-y-0.5 hover:border-primary/40"
>
	<div class="relative aspect-[.69] overflow-hidden bg-secondary">
		{#if cover}
			<img
				src={cover}
				alt=""
				loading="lazy"
				class="size-full object-cover transition duration-500 group-hover:scale-[1.04]"
			/>
		{:else}
			<div class="poster-placeholder" aria-hidden="true">
				<BookOpen class="size-8" />
			</div>
		{/if}
		{#if badge}
			<span
				class="pointer-events-none absolute top-2 right-2 z-10 rounded-full bg-white/15 px-2 py-0.5 text-zinc-100 text-[10px] backdrop-blur"
			>
				{badge}
			</span>
		{/if}
		{#if typeInfo || recentUpdate}
			<div class="pointer-events-none absolute top-2 left-2 z-10 flex items-center gap-1.5">
				{#if typeInfo}
					<span
						class="grid size-7 place-items-center rounded-lg border border-white/15 bg-black/65 text-base shadow-lg backdrop-blur sm:size-8 sm:text-lg"
						role="img"
						aria-label={`${typeInfo.label} dari ${typeInfo.country}`}
						title={`${typeInfo.label} · ${typeInfo.country}`}
					>
						{typeInfo.flag}
					</span>
				{/if}
				{#if recentUpdate}
					<span class="catalog-up-badge catalog-thumbnail-up-badge">UP</span>
				{/if}
			</div>
		{/if}
	</div>
	<div class="comic-catalog-card-content p-2 sm:p-4">
		<h3 class="catalog-card-title">
			<span>{decodeEntities(series.title)}</span>
		</h3>
		{#if latest.length > 0}
			<ul class="mt-2 grid gap-1 sm:mt-3 sm:gap-1.5" aria-label="Dua chapter terbaru">
				{#each latest as chapter (chapter.id)}
					{@const age = formatTimeAgo(chapter.createdAt)}
					<li class="flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-xl bg-secondary px-3 text-foreground text-xs leading-4 sm:text-sm">
						<span class="truncate">{formatChapterLabel(chapter.numberText)}</span>
						{#if age}
							<time
								datetime={chapter.createdAt ?? undefined}
								title={age}
								aria-label={age}
								class="shrink-0 rounded-md bg-card px-2 py-1 font-semibold text-[11px] text-secondary-foreground sm:text-xs"
							>
								{age}
							</time>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</a>
