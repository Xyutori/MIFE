<script lang="ts">
interface Props {
	label: string;
	value: string;
	loading?: boolean;
}

let { label, value, loading = false }: Props = $props();
</script>

<div class="rounded-2xl border bg-card p-4">
	<p class="text-muted-foreground text-xs">{label}</p>
	<p class="mt-1 truncate font-extrabold text-xl tabular-nums sm:text-2xl">
		{#if loading}
			<span class="block h-7 w-20 animate-pulse rounded bg-secondary" aria-hidden="true"></span>
			<span class="sr-only">Memuat</span>
		{:else}
			{value}
		{/if}
	</p>
</div>
