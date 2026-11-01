<script lang="ts">
	import { page } from "$app/state";
	import AnimeDetailView from "#lib/components/anime/AnimeDetailView.svelte";

	const animeId = $derived(page.params.id ?? "");
</script>

<svelte:head>
	<title>Detail Anime · MIFE</title>
	<meta name="description" content="Detail anime dan daftar episode." />
</svelte:head>

{#key animeId}
	<AnimeDetailView {animeId} />
{/key}
