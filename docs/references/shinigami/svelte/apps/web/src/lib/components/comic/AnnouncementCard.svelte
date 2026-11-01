<script lang="ts">
import type { Announcement } from "./types.js";

interface Props {
	announcement: Announcement;
}

let { announcement }: Props = $props();
</script>

<a
	href={announcement.href}
	class="flex items-center gap-4 rounded-[16px] bg-[#242424] p-3 transition-opacity hover:opacity-85"
>
	<img
		src={announcement.image}
		alt={announcement.title}
		loading="lazy"
		decoding="async"
		class="h-[76px] w-[76px] shrink-0 rounded-[8px] object-cover"
	/>
	<div class="min-w-0">
		<span class="mb-1 block truncate text-sm font-semibold text-white">
			{announcement.title}
		</span>
		<span class="block text-xs text-neutral-400">{announcement.date}</span>
	</div>
</a>
