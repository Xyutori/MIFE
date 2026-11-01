<script lang="ts">
import { onMount } from "svelte";
import { page } from "$app/state";
import "../app.css";
import {
	oauthErrorMessage,
	providerDisplayName,
} from "#lib/components/auth/oauth.ts";
import { registerServiceWorker } from "#lib/offline/sw-register.ts";
import Header from "../components/Header.svelte";

const { children } = $props();

// Immersive reading: tanpa chrome situs (Header + bottom-nav) di rute baca.
const isReadRoute = $derived(
	(page.route.id ?? "").startsWith("/baca") ||
		(page.route.id ?? "").startsWith("/super-komik/read"),
);

// Area admin punya shell sendiri (AdminShell): jangan reuse Header publik.
const isAdminRoute = $derived(page.url.pathname.startsWith("/admin"));

let oauthError = $state("");

onMount(() => {
	void registerServiceWorker();
	const params = new URLSearchParams(window.location.search);
	const code = params.get("error");
	if (code) {
		oauthError = oauthErrorMessage(
			code,
			params.get("error_description"),
			undefined,
			providerDisplayName(params.get("provider")),
		);
		params.delete("error");
		params.delete("error_description");
		params.delete("provider");
		const query = params.toString();
		window.history.replaceState(
			{},
			"",
			`${window.location.pathname}${query ? `?${query}` : ""}`,
		);
	}
});
</script>

<div
	class={isAdminRoute
		? "flex h-dvh flex-col overflow-hidden"
		: isReadRoute
			? "h-dvh overflow-hidden"
			: "grid h-dvh grid-rows-[auto_1fr] overflow-hidden"}
>
	{#if !isReadRoute && !isAdminRoute}
		<Header />
	{/if}
	<main
		class={isAdminRoute
			? "min-h-0 flex-1 overflow-y-auto"
			: isReadRoute
				? "min-h-0 overflow-y-auto"
				: "min-h-0 overflow-y-auto pb-24 lg:pb-0"}
	>
		{#if oauthError}
			<div class="mx-auto w-full max-w-5xl px-4 pt-4">
				<div
					role="alert"
					class="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
				>
					<span>{oauthError}</span>
					<button
						type="button"
						class="shrink-0 rounded-md px-2 py-0.5 hover:bg-accent"
						onclick={() => (oauthError = "")}
					>
						Tutup
					</button>
				</div>
			</div>
		{/if}
		{@render children()}
	</main>
</div>
