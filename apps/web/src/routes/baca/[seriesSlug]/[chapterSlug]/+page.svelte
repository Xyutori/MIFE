<script lang="ts">
import ReaderView from "#lib/components/ReaderView.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
const seriesSlug = $derived(data.params.seriesSlug);
const chapterNumber = $derived(
	data.params.chapterSlug.replace(/^chapter-/i, ""),
);
</script>

<ReaderView {seriesSlug} {chapterNumber} backHref="/" />
