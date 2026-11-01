<script lang="ts">
import type { Chapter } from "./types.js";

interface Props {
	chapter: Chapter;
	showTime?: boolean;
}

let { chapter, showTime = true }: Props = $props();
</script>

<a
	href={chapter.href}
	class="flex items-center justify-between gap-2 rounded-[8px] bg-[#242424] px-3 py-2 text-xs text-white transition-opacity hover:opacity-80"
>
	<span class="min-w-0 truncate font-medium">{chapter.number}</span>
	{#if showTime && chapter.time}
		<span class="shrink-0 text-[10px] text-neutral-400">{chapter.time}</span>
	{/if}
</a>
