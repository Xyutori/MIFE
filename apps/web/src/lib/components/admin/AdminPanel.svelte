<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	title: string;
	description?: string;
	actions?: Snippet;
	children: Snippet;
}

let { title, description, actions, children }: Props = $props();
</script>

<section class="rounded-3xl border bg-card p-4 sm:p-5" aria-label={title}>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<h2 class="font-bold text-lg">{title}</h2>
			{#if description}
				<p class="mt-1 text-muted-foreground text-sm">{description}</p>
			{/if}
		</div>
		{#if actions}
			<div class="shrink-0">{@render actions()}</div>
		{/if}
	</div>
	<div class="mt-4">{@render children()}</div>
</section>
