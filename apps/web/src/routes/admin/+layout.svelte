<script lang="ts">
import AdminGate from "#lib/components/admin/AdminGate.svelte";
import AdminShell from "#lib/components/admin/AdminShell.svelte";
import { page } from "$app/state";

let { children } = $props();

const active = $derived(page.url.pathname);
</script>

<AdminGate>
	<AdminShell {active}>
		{@render children()}
	</AdminShell>
</AdminGate>
