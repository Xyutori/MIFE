<script lang="ts">
import { Clapperboard } from "lucide-svelte";
import type { AnimeListItem } from "#lib/admin.ts";
import { decodeEntities, formatEpisodeLabel } from "#lib/admin.ts";

interface Props {
	item: AnimeListItem;
	href: string;
	id?: string;
	thumbnailUrl: string | null;
	badge?: string | null;
}

let { item, href, id, thumbnailUrl, badge = null }: Props = $props();

const latest = $derived(
	item.latestEpisodes?.length
		? item.latestEpisodes.slice(0, 2)
		: item.latestEpisodeNumber
			? [{ id: `${item.id}:latest`, numberText: item.latestEpisodeNumber }]
			: [],
);
</script>

<a
	{href}
	{id}
	class="catalog-card group min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card transition duration-200 hover:-translate-y-0.5 hover:border-primary/40"
>
	<div class="relative aspect-[.69] overflow-hidden bg-secondary">
		{#if badge}
			<span
				class="pointer-events-none absolute top-2 right-2 z-10 rounded-full bg-white/15 px-2 py-0.5 text-zinc-100 text-[10px] backdrop-blur"
			>
				{badge}
			</span>
		{/if}
		{#if thumbnailUrl}
			<img
				src={thumbnailUrl}
				alt=""
				loading="lazy"
				class="size-full object-cover transition duration-500 group-hover:scale-[1.04]"
			/>
		{:else}
			<div class="poster-placeholder" aria-hidden="true">
				<Clapperboard class="size-8" />
			</div>
		{/if}
	</div>
	<div class="comic-catalog-card-content p-2 sm:p-4">
		<h3 class="catalog-card-title">
			<span>{decodeEntities(item.title)}</span>
		</h3>
		{#if latest.length > 0}
			<ul class="mt-2 grid gap-1 sm:mt-3 sm:gap-1.5" aria-label="Dua episode terbaru">
				{#each latest as episode (episode.id)}
					<li class="flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-xl bg-secondary px-3 text-foreground text-xs leading-4 sm:text-sm">
						<span class="truncate">{formatEpisodeLabel(episode.numberText)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</a>
