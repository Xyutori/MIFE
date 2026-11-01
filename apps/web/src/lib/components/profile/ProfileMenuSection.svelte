<script lang="ts">
import { Settings, ShieldCheck } from "lucide-svelte";

interface Props {
	isAdmin: boolean;
}

let { isAdmin }: Props = $props();
</script>

<section aria-label="Menu lainnya" class="mt-5 rounded-3xl border bg-card p-3 sm:p-4">
	<h2 class="px-2 pt-1 font-bold text-muted-foreground text-sm">Menu lainnya</h2>
	<nav class="mt-2 grid gap-1" aria-label="Menu profil">
		<a
			href="/profile/settings"
			class="flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 font-semibold text-sm transition hover:bg-accent"
		>
			<span class="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary" aria-hidden="true">
				<Settings class="size-4" />
			</span>
			Pengaturan
			<span class="ml-auto text-muted-foreground" aria-hidden="true">→</span>
		</a>
		{#if isAdmin}
			<a
				href="/admin"
				class="flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 font-semibold text-sm transition hover:bg-accent"
			>
				<span class="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary" aria-hidden="true">
					<ShieldCheck class="size-4" />
				</span>
				Panel admin
				<span class="ml-auto text-muted-foreground" aria-hidden="true">→</span>
			</a>
		{/if}
	</nav>
</section>
