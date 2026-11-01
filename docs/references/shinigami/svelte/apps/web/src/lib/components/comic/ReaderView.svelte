<script lang="ts">
import Icon from "./Icon.svelte";

interface Props {
	pages: string[];
	/** Base alt text; page number is appended automatically. */
	alt?: string;
}

let { pages, alt = "Halaman" }: Props = $props();
</script>

{#if pages.length > 0}
	<div class="mx-auto flex w-full max-w-[800px] flex-col" role="feed" aria-label="Halaman chapter">
		{#each pages as src, i (src + i)}
			<img
				{src}
				alt={`${alt} ${i + 1}`}
				loading="lazy"
				decoding="async"
				draggable="false"
				class="h-auto w-full select-none"
			/>
		{/each}
	</div>
{:else}
	<div
		class="mx-auto flex w-full max-w-[800px] flex-col items-center gap-2 px-6 py-16 text-center"
	>
		<Icon name="image-off" size={32} class="text-neutral-600" />
		<p class="text-sm text-neutral-500">Halaman tidak tersedia.</p>
	</div>
{/if}
