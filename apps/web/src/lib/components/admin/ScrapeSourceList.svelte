<script lang="ts">
	export interface ScrapeSourceItem {
		key: string;
		name: string;
		enabled: boolean;
		successLabel: string;
		fullLabel: string;
	}

	interface Props {
		sources: ScrapeSourceItem[];
		emptyLabel?: string;
	}

	let { sources, emptyLabel = "Belum ada data sumber." }: Props = $props();
</script>

<section class="rounded-3xl border bg-card p-4 sm:p-5" aria-label="Status sumber">
	<h2 class="font-bold text-lg">Status sumber</h2>
	{#if sources.length === 0}
		<p class="mt-2 text-muted-foreground text-sm">{emptyLabel}</p>
	{:else}
		<ul class="mt-3 grid gap-3 lg:grid-cols-2">
			{#each sources as source (source.key)}
				<li class="rounded-xl border border-border/70 bg-background/70 p-4">
					<div class="flex items-center justify-between gap-2">
						<span class="flex min-w-0 items-center gap-2">
							<span
								class="size-2 shrink-0 rounded-full {source.enabled
									? 'bg-zinc-100'
									: 'bg-muted-foreground/50'}"
								aria-hidden="true"
							></span>
							<span class="truncate font-medium text-sm">{source.name}</span>
						</span>
						<span class="rounded-full border border-border bg-secondary px-2.5 py-1 text-muted-foreground text-[11px]">
							{source.enabled ? "Aktif" : "Nonaktif"}
						</span>
					</div>
					<div class="mt-3 grid grid-cols-2 gap-3 text-xs">
						<div>
							<p class="text-muted-foreground">Terakhir sukses</p>
							<p class="mt-1 font-medium">{source.successLabel}</p>
						</div>
						<div>
							<p class="text-muted-foreground">Full terakhir</p>
							<p class="mt-1 font-medium">{source.fullLabel}</p>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
