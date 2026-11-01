<script lang="ts">
	import { Eye, RotateCcw } from "lucide-svelte";

	export interface ScrapeHistoryItem {
		id: string;
		title: string;
		subinfo: string;
		canRetry: boolean;
		disabled?: boolean;
	}

	export interface ScrapeHistoryEvent {
		id: string;
		level: string;
		message: string;
	}

	interface Props {
		items: ScrapeHistoryItem[];
		expandedId: string;
		events: Record<string, ScrapeHistoryEvent[]>;
		onToggleDetail: (id: string) => void;
		onRetry: (id: string) => void;
		showDetail?: boolean;
		emptyLabel?: string;
	}

	let {
		items,
		expandedId,
		events,
		onToggleDetail,
		onRetry,
		showDetail = true,
		emptyLabel = "Belum ada riwayat.",
	}: Props = $props();
</script>

<section class="rounded-3xl border bg-card p-4 sm:p-5" aria-label="Riwayat scrape">
	<h2 class="font-bold text-lg">Riwayat</h2>
	{#if items.length === 0}
		<p class="mt-2 text-muted-foreground text-sm">{emptyLabel}</p>
	{:else}
		<ul class="mt-1 divide-y divide-border/60">
			{#each items as item (item.id)}
				<li class="py-3">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<p class="truncate font-semibold text-sm">{item.title}</p>
							<p class="mt-0.5 text-muted-foreground text-xs">{item.subinfo}</p>
							{#if showDetail && expandedId === item.id}
								{#if (events[item.id] ?? []).length === 0}
									<p class="mt-2 border-t border-border/70 pt-2 text-muted-foreground text-xs">
										Belum ada event.
									</p>
								{:else}
									<ul class="mt-2 space-y-1 border-t border-border/70 pt-2 text-xs">
										{#each (events[item.id] ?? []).slice(0, 10) as event (event.id)}
											<li class="text-muted-foreground">
												<span class="font-semibold">[{event.level}]</span>
												{event.message}
											</li>
										{/each}
									</ul>
								{/if}
							{/if}
						</div>
						<div class="flex shrink-0 gap-1">
							{#if showDetail}
								<button
									type="button"
									aria-expanded={expandedId === item.id}
									aria-label={`Detail ${item.title}`}
									title="Detail"
									onclick={() => onToggleDetail(item.id)}
									class="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground"
								>
									<Eye class="size-4" aria-hidden="true" />
								</button>
							{/if}
							{#if item.canRetry}
								<button
									type="button"
									disabled={item.disabled}
									title="Ulangi"
									aria-label={`Ulangi ${item.title}`}
									onclick={() => onRetry(item.id)}
									class="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground disabled:opacity-50"
								>
									<RotateCcw class="size-4" aria-hidden="true" />
								</button>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
