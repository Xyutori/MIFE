<script lang="ts">
import ChapterRow from "./ChapterRow.svelte";
import Icon from "./Icon.svelte";
import type { Series } from "./types.js";

interface Props {
	series: Series;
	layout?: "grid" | "carousel";
	showChapters?: boolean;
}

let { series, layout = "grid", showChapters = true }: Props = $props();

let chapters = $derived((series.latestChapters ?? []).slice(0, 2));
let showMini = $derived(showChapters && chapters.length > 0);
let isCarousel = $derived(layout === "carousel");
</script>

<div class={isCarousel ? "w-[140px] shrink-0 snap-start sm:w-[160px]" : "flex min-w-0 flex-col gap-3"}>
	<a
		href={series.href}
		class="relative block aspect-[112/170] overflow-hidden rounded-[8px] bg-[#242424]"
		aria-label={series.title}
	>
		<img
			src={series.cover}
			alt={series.title}
			loading="lazy"
			decoding="async"
			class="absolute inset-0 h-full w-full object-cover"
		/>
		<div class="absolute top-1.5 left-1.5 z-[2] flex items-center gap-1">
			{#if series.updatedAt}
				<span class="flex h-[18px] items-center overflow-hidden rounded-[8px]">
					<span class="flex h-full w-[18px] items-center justify-center bg-[#E01B41] text-white">
						<Icon name="clock" size={12} />
					</span>
					<span class="bg-white px-1.5 text-[10px] font-medium text-neutral-900">
						{series.updatedAt}
					</span>
				</span>
			{/if}
			{#if series.badge}
				<span
					class="flex h-[18px] items-center rounded-[4px] bg-[#E84118] px-1 text-[10px] font-semibold text-white"
				>
					{series.badge}
				</span>
			{/if}
		</div>
		{#if series.flag}
			<span class="absolute right-1.5 bottom-1.5 z-[2] text-[18px] leading-none" aria-hidden="true">
				{series.flag}
			</span>
		{/if}
	</a>

	<div class={isCarousel ? "pt-1.5" : "flex h-[54px] items-center"}>
		<a
			href={series.href}
			class={isCarousel
				? "line-clamp-2 block text-xs font-medium text-white"
				: "line-clamp-2 flex-1 text-center text-sm font-medium text-white sm:text-base"}
		>
			{#if !isCarousel && series.badge}
				<span
					class="mr-1 inline-block rounded-[4px] bg-[#E84118] px-1 align-middle text-[9px] leading-4 text-white"
				>
					{series.badge}
				</span>
			{/if}
			{series.title}
		</a>
	</div>

	{#if showMini}
		<div class="flex flex-col gap-1">
			{#each chapters as chapter (chapter.href)}
				<ChapterRow {chapter} />
			{/each}
		</div>
	{/if}
</div>
