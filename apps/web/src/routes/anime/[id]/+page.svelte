<script lang="ts">
import AnimeDetailView from "#lib/components/anime/AnimeDetailView.svelte";
import CommentSection from "#lib/components/comments/CommentSection.svelte";
import { page } from "$app/state";

const animeId = $derived(page.params.id ?? "");
</script>

<svelte:head>
	<title>Detail Anime · MIFE</title>
	<meta name="description" content="Detail anime dan daftar episode." />
</svelte:head>

{#key animeId}
	<AnimeDetailView {animeId} />
	<div class="mx-auto mt-12 max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
		<CommentSection targetType="anime_series" targetId={animeId} />
	</div>
{/key}
