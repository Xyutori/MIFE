<script lang="ts">
import Icon from "./Icon.svelte";

interface Props {
	title?: string;
	description?: string;
}

let {
	title = "Login Diperlukan",
	description = "Kamu harus login dulu untuk mengakses fitur ini.",
}: Props = $props();
</script>

<div class="flex flex-col items-center gap-3 rounded-[16px] bg-[#242424] px-6 py-10 text-center">
	<span
		class="flex h-12 w-12 items-center justify-center rounded-full bg-[#E01B41]/15 text-[#E01B41]"
		aria-hidden="true"
	>
		<Icon name="log-in" size={24} />
	</span>
	<h3 class="text-base font-semibold text-white">{title}</h3>
	<p class="max-w-sm text-sm text-neutral-400">{description}</p>
	<a
		href="/login"
		class="mt-1 flex items-center gap-2 rounded-[6px] bg-[#E01B41] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
	>
		<Icon name="log-in" size={16} />
		Login
	</a>
</div>
