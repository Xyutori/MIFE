<script lang="ts">
import type { Snippet } from "svelte";
import { onMount } from "svelte";
import { type AdminGateState, checkAdmin } from "#lib/admin.ts";

let { children }: { children: Snippet } = $props();

let state = $state<AdminGateState>({ kind: "checking" });

onMount(() => {
	let active = true;
	void checkAdmin().then((result) => {
		if (active) state = result;
	});
	return () => {
		active = false;
	};
});
</script>

{#if state.kind === "checking"}
	<main class="mx-auto max-w-3xl px-4 py-16" aria-busy="true">
		<div class="h-8 w-2/3 animate-pulse rounded-xl bg-card" aria-hidden="true"></div>
		<div class="mt-4 h-24 animate-pulse rounded-2xl bg-card" aria-hidden="true"></div>
		<span class="sr-only" role="status">Memeriksa hak akses admin</span>
	</main>
{:else if state.kind === "admin"}
	{@render children()}
{:else if state.kind === "login" || state.kind === "denied"}
	<main class="mx-auto max-w-md px-4 py-16 text-center">
		<p class="font-bold text-primary text-xs uppercase tracking-[0.18em]">
			404
		</p>
		<h1 class="mt-2 font-extrabold text-2xl">Halaman tidak ditemukan</h1>
		<p class="mt-2 text-muted-foreground text-sm">
			Halaman yang kamu cari tidak ada atau sudah dipindahkan.
		</p>
		<a
			href="/"
			class="mt-6 inline-flex h-10 items-center rounded-full border border-border px-5 font-bold text-sm"
		>
			Kembali ke beranda
		</a>
	</main>
{:else}
	<main class="mx-auto max-w-md px-4 py-16 text-center">
		<p class="font-bold text-primary text-xs uppercase tracking-[0.18em]">
			Admin
		</p>
		<h1 class="mt-2 font-extrabold text-2xl">Tidak dapat memeriksa akses</h1>
		<p role="alert" class="mt-2 text-muted-foreground text-sm">
			{state.message}
		</p>
		<button
			type="button"
			onclick={() => {
				state = { kind: "checking" };
				void checkAdmin().then((result) => (state = result));
			}}
			class="mt-6 inline-flex h-10 items-center rounded-full bg-primary px-5 font-bold text-primary-foreground text-sm"
		>
			Coba lagi
		</button>
	</main>
{/if}
