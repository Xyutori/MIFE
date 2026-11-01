<script lang="ts">
import AnimeWatchView from "#lib/components/anime/AnimeWatchView.svelte";
import CommentSection from "#lib/components/comments/CommentSection.svelte";
import { page } from "$app/state";

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
	<CommentSection targetType="anime_episode" targetId={episodeId} />
{/key}
