<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";

onMount(() => {
	void goto("/profile/settings", { replaceState: true });
});
</script>

<main class="mx-auto max-w-3xl px-4 py-10">
	<p class="text-sm text-neutral-400">
		Mengalihkan ke <a href="/profile/settings" class="text-muted-foreground underline">pengaturan profil</a>…
	</p>
</main>
