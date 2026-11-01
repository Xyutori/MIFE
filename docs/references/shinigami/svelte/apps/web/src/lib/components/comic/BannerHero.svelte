<script lang="ts">
import Icon from "./Icon.svelte";
import type { BannerItem } from "./types.js";

interface Props {
	items: BannerItem[];
	/** Auto-advance interval in ms. Set 0 to disable. */
	interval?: number;
}

let { items, interval = 6000 }: Props = $props();

let track: HTMLDivElement | null = $state(null);
let current = $state(0);
let paused = $state(false);

function goTo(index: number): void {
	if (!track || items.length === 0) return;
	const next = (index + items.length) % items.length;
	current = next;
	track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
}

function handleScroll(): void {
	if (!track || track.clientWidth === 0) return;
	const index = Math.round(track.scrollLeft / track.clientWidth);
	if (index !== current && index >= 0 && index < items.length) current = index;
}

$effect(() => {
	if (paused || interval <= 0 || items.length <= 1) return;
	const id = setInterval(() => {
		goTo(current + 1);
	}, interval);
	return () => clearInterval(id);
});
</script>

<!--
	Dependency-free carousel matching the home hero visual pattern.
	Swap-in path: replace the scroll-snap track with shadcn-svelte
	`Carousel` (`#lib/components/ui/carousel`) when the foundation
	lane lands — slide markup and props stay the same.
-->
{#if items.length > 0}
	<section
		aria-roledescription="carousel"
		aria-label="Sorotan series"
		class="relative overflow-hidden rounded-[16px]"
		onmouseenter={() => (paused = true)}
		onmouseleave={() => (paused = false)}
	>
		<div
			bind:this={track}
			onscroll={handleScroll}
			class="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			{#each items as item, i (item.href + i)}
				<a
					href={item.href}
					aria-roledescription="slide"
					aria-label={`${i + 1} dari ${items.length}: ${item.title}`}
					class="relative flex aspect-square w-full shrink-0 snap-start flex-col justify-end overflow-hidden sm:aspect-[16/7]"
				>
					<img
						src={item.banner}
						alt={item.title}
						loading={i === 0 ? "eager" : "lazy"}
						decoding="async"
						class="absolute inset-0 z-0 h-full w-full object-cover"
					/>
					{#if item.character}
						<img
							src={item.character}
							alt=""
							aria-hidden="true"
							loading="lazy"
							decoding="async"
							class="absolute top-[-10%] right-0 z-[2] h-[80%] object-contain"
						/>
					{/if}
					<div
						class="absolute inset-0 z-[1]"
						style="background: linear-gradient(to top, #000 40%, transparent 100%);"
						aria-hidden="true"
					></div>
					<div class="relative z-[3] max-w-full p-4 sm:max-w-[66%] sm:p-5">
						<h3 class="mb-2 line-clamp-2 text-lg leading-tight font-bold text-white sm:text-2xl">
							{item.title}
						</h3>
						<div class="mb-2 flex flex-wrap items-center gap-2">
							{#if item.rating !== undefined}
								<span class="flex items-center gap-1 text-base font-bold text-white">
									<Icon name="star" size={18} class="fill-amber-400 text-amber-400" />
									{item.rating}
								</span>
							{/if}
							{#each item.tags ?? [] as tag (tag.label)}
								<span
									class="rounded-[6px] px-2 py-1 text-xs text-white"
									style={`background: ${tag.color};`}
								>
									{tag.label}
								</span>
							{/each}
						</div>
						{#if item.description}
							<p class="line-clamp-2 text-sm leading-snug text-neutral-300 sm:text-base">
								{item.description}
							</p>
						{/if}
					</div>
				</a>
			{/each}
		</div>

		{#if items.length > 1}
			<div class="absolute top-1/2 right-2 left-2 z-[4] flex -translate-y-1/2 justify-between">
				<button
					type="button"
					onclick={() => goTo(current - 1)}
					aria-label="Slide sebelumnya"
					class="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-[#E01B41]"
				>
					<Icon name="chevron-left" size={20} />
				</button>
				<button
					type="button"
					onclick={() => goTo(current + 1)}
					aria-label="Slide berikutnya"
					class="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-[#E01B41]"
				>
					<Icon name="chevron-right" size={20} />
				</button>
			</div>
			<div class="absolute bottom-3 left-1/2 z-[4] flex -translate-x-1/2 gap-1.5">
				{#each items as _, i (i)}
					<button
						type="button"
						onclick={() => goTo(i)}
						aria-label={`Ke slide ${i + 1}`}
						class={i === current
							? "h-1.5 w-6 rounded-full bg-[#E01B41]"
							: "h-1.5 w-1.5 rounded-full bg-white/50 transition-colors hover:bg-white"}
					></button>
				{/each}
			</div>
		{/if}
	</section>
{/if}
