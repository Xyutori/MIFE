<script lang="ts">
	import { Pause, Play, X } from "lucide-svelte";

	export interface ScrapeWorkerItem {
		id: string;
		title: string;
		subinfo: string;
		progress: number | null;
		paused: boolean;
		disabled?: boolean;
	}

	interface Props {
		workers: ScrapeWorkerItem[];
		onToggle: (id: string) => void;
		onCancel: (id: string) => void;
		emptyLabel?: string;
	}

	let {
		workers,
		onToggle,
		onCancel,
		emptyLabel = "Tidak ada worker.",
	}: Props = $props();
</script>

<section class="rounded-3xl border bg-card p-4 sm:p-5" aria-label="Worker aktif">
	<h2 class="font-bold text-lg">Worker aktif</h2>
	{#if workers.length === 0}
		<p class="mt-2 text-muted-foreground text-sm">{emptyLabel}</p>
	{:else}
		<ul class="mt-1 divide-y divide-border/60">
			{#each workers as worker (worker.id)}
				<li class="py-3">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<p class="truncate font-semibold text-sm">{worker.title}</p>
							<p class="mt-0.5 text-muted-foreground text-xs">{worker.subinfo}</p>
							{#if worker.progress !== null}
								<div class="mt-2 flex items-center gap-2">
									<div
										class="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-secondary"
										role="progressbar"
										aria-valuenow={worker.progress}
										aria-valuemin={0}
										aria-valuemax={100}
									>
										<div
											class="h-full rounded-full bg-primary"
											style="width: {worker.progress}%"
										></div>
									</div>
									<span class="text-muted-foreground text-[11px] tabular-nums">
										{worker.progress}%
									</span>
								</div>
							{/if}
						</div>
						<div class="flex shrink-0 gap-1">
							<button
								type="button"
								disabled={worker.disabled}
								title={worker.paused ? "Lanjutkan" : "Jeda"}
								aria-label={worker.paused
									? `Lanjutkan ${worker.title}`
									: `Jeda ${worker.title}`}
								onclick={() => onToggle(worker.id)}
								class="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground disabled:opacity-50"
							>
								{#if worker.paused}
									<Play class="size-4" aria-hidden="true" />
								{:else}
									<Pause class="size-4" aria-hidden="true" />
								{/if}
							</button>
							<button
								type="button"
								disabled={worker.disabled}
								title="Batalkan"
								aria-label={`Batalkan ${worker.title}`}
								onclick={() => onCancel(worker.id)}
								class="grid size-9 place-items-center rounded-lg text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
							>
								<X class="size-4" aria-hidden="true" />
							</button>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
