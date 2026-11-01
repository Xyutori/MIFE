<script lang="ts">
import type { Reaction } from "./types.js";

interface Props {
	reactions: Reaction[];
	onReact?: (id: string) => void;
}

let { reactions, onReact }: Props = $props();

let votedId = $state<string | null>(null);

let total = $derived(reactions.reduce((n, r) => n + r.votes, 0));

function toggle(id: string): void {
	votedId = votedId === id ? null : id;
	onReact?.(id);
}
</script>

{#if reactions.length > 0}
	<section aria-label="Reaksi" class="flex flex-col items-center gap-2">
		<h3 class="text-sm font-semibold text-white">Upvote</h3>
		<p class="text-xs text-neutral-400">{total} Reactions</p>
		<ul class="flex flex-wrap items-start justify-center gap-4">
			{#each reactions as reaction (reaction.id)}
				<li>
					<button
						type="button"
						onclick={() => toggle(reaction.id)}
						aria-pressed={votedId === reaction.id}
						class={votedId === reaction.id
							? "flex flex-col items-center gap-1 rounded-[8px] bg-[#E01B41]/15 px-3 py-2 ring-1 ring-[#E01B41] transition-colors"
							: "flex flex-col items-center gap-1 rounded-[8px] px-3 py-2 transition-colors hover:bg-white/5"}
					>
						<span class="relative">
							<img
								src={reaction.image}
								alt={reaction.label}
								loading="lazy"
								decoding="async"
								class="h-10 w-10 object-contain"
							/>
							<span
								class="absolute -right-2 -bottom-1 rounded-full bg-[#242424] px-1.5 text-[10px] font-semibold text-white"
							>
								{reaction.votes + (votedId === reaction.id ? 1 : 0)}
							</span>
						</span>
						<span class="text-xs text-neutral-300">{reaction.label}</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}
