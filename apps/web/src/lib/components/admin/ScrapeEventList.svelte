<script lang="ts">
import { formatDateTimeId } from "#lib/admin.ts";

export interface ScrapeEventItem {
	id: string;
	level: string;
	message: string;
	details?: unknown;
	createdAt: string;
}

interface Props {
	events: ScrapeEventItem[];
	emptyLabel?: string;
	limit?: number;
	formatDate?: (value: string) => string;
}

let {
	events,
	emptyLabel = "Belum ada event.",
	limit = 8,
	formatDate = formatDateTimeId,
}: Props = $props();

const visible = $derived(events.slice(-limit).reverse());
</script>

{#if events.length === 0}
	<p class="text-muted-foreground text-xs">{emptyLabel}</p>
{:else}
	<div class="max-h-72 space-y-2 overflow-y-auto">
		{#each visible as event (event.id)}
			<div class="flex items-start gap-2 text-xs">
				<span
					class="mt-1 size-1.5 shrink-0 rounded-full {event.level === 'error'
						? 'bg-destructive'
						: event.level === 'warning'
							? 'bg-zinc-400'
							: 'bg-primary'}"
					aria-hidden="true"
				></span>
				<div class="min-w-0 flex-1">
					<p class="max-h-24 overflow-auto whitespace-pre-wrap break-all text-foreground/90">
						{event.message}
					</p>
					{#if event.details !== undefined && event.details !== null}
						<p class="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-muted-foreground text-[10px]">
							{JSON.stringify(event.details)}
						</p>
					{/if}
				</div>
				<time class="shrink-0 text-muted-foreground text-[10px]">
					{formatDate(event.createdAt)}
				</time>
			</div>
		{/each}
	</div>
{/if}
