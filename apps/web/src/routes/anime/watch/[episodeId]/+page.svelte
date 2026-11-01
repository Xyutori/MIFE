<script lang="ts">
	import { page } from "$app/state";
	import AnimeWatchView from "#lib/components/anime/AnimeWatchView.svelte";

	const episodeId = $derived(page.params.episodeId ?? "");
</script>

<svelte:head>
	<title>Pemutar Anime · MIFE</title>
	<meta
		name="description"
		content="Pemutar anime HLS — online-only, posisi tonton tersimpan otomatis."
	/>
</svelte:head>

{#key episodeId}
	<AnimeWatchView {episodeId} />
{/key}
