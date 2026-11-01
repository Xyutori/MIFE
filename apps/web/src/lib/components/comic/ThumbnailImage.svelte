<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	src: string;
	alt: string;
	cls?: string;
	eager?: boolean;
	fallback?: Snippet;
}

let {
	src,
	alt,
	cls = "h-full w-full object-cover",
	eager = false,
	fallback,
}: Props = $props();

// Port Svelte 5 dari XyMI ThumbnailImage: skeleton selagi memuat,
// fallback kustom (atau blok netral) bila gambar gagal dimuat.
let loaded = $state(false);
let failed = $state(false);

$effect(() => {
	src;
	loaded = false;
	failed = false;
});
</script>

{#if failed}
	{#if fallback}
		{@render fallback()}
	{:else}
		<div class="{cls} grid place-items-center bg-secondary text-muted-foreground" aria-hidden="true">
			<span class="font-bold text-xs">Tanpa sampul</span>
		</div>
	{/if}
{:else}
	{#if !loaded}
		<div class="{cls} animate-pulse bg-secondary" aria-hidden="true"></div>
	{/if}
	<img
		{src}
		{alt}
		loading={eager ? "eager" : "lazy"}
		class="{cls} {loaded ? '' : 'hidden'}"
		onload={() => {
			loaded = true;
			failed = false;
		}}
		onerror={() => (failed = true)}
	/>
{/if}
