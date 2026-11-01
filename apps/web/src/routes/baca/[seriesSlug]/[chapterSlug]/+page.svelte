<script lang="ts">
import { getChapterBySlug } from "#lib/api.ts";
import CommentSection from "#lib/components/comments/CommentSection.svelte";
import ReaderView from "#lib/components/ReaderView.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
const seriesSlug = $derived(data.params.seriesSlug);
const chapterNumber = $derived(
	data.params.chapterSlug.replace(/^chapter-/i, ""),
);

let chapterId = $state<string | null>(null);
$effect(() => {
	const slug = seriesSlug;
	const num = chapterNumber;
	const controller = new AbortController();
	chapterId = null;
	void getChapterBySlug(slug, num, controller.signal)
		.then((info) => {
			chapterId = info.id;
		})
		.catch(() => {});
	return () => controller.abort();
});
</script>

<ReaderView {seriesSlug} {chapterNumber} backHref="/" />

{#if chapterId}
	<CommentSection targetType="comic_chapter" targetId={chapterId} />
{/if}
