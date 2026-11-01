<script lang="ts">
import ReaderView from "#lib/components/ReaderView.svelte";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();
const chapterId = $derived(data.params.chapterId);
</script>

<ReaderView {chapterId} backHref="/" />
