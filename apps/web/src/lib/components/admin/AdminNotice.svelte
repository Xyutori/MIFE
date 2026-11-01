<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	children: Snippet;
	tone?: "info" | "warning";
}

let { children, tone = "info" }: Props = $props();
</script>

<p
	role="status"
	class="rounded-xl border px-4 py-3 text-sm {tone === 'warning'
		? 'border-white/20 bg-white/5 text-zinc-200'
		: 'border-primary/20 bg-primary/10 text-primary'}"
>
	{@render children()}
</p>
