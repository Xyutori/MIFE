<script lang="ts">
import { LoaderCircle } from "lucide-svelte";
import { onMount } from "svelte";
import { authClient } from "#lib/auth-client.ts";
import {
	fetchOAuthProviders,
	type OAuthProvider,
	oauthErrorMessage,
	providerDisplayName,
	signInWithProvider,
} from "#lib/components/auth/oauth.ts";
import ProviderLogo from "#lib/components/auth/ProviderLogo.svelte";

let { callbackPath = "/dashboard" }: { callbackPath?: string } = $props();

let providers = $state<OAuthProvider[]>([]);
let loading = $state(true);
let signingIn = $state("");
let error = $state("");

onMount(() => {
	const controller = new AbortController();
	const search = new URLSearchParams(window.location.search);
	const errorCodes = search.getAll("error");
	const errorCode = errorCodes.at(-1);
	if (errorCode) {
		error = oauthErrorMessage(
			errorCode,
			search.get("error_description"),
			undefined,
			providerDisplayName(search.get("provider")),
		);
	}

	// Kegagalan pemeriksaan sesi (jaringan/cookie lintas origin) wajib
	// terlihat sebagai pesan, bukan gagal diam-diam.
	void authClient
		.getSession()
		.then((result) => {
			if (result?.error && !error) {
				error = "Sesi tidak dapat diperiksa. Periksa koneksi lalu coba lagi.";
			}
		})
		.catch(() => {
			if (!error) {
				error = "Sesi tidak dapat diperiksa. Periksa koneksi lalu coba lagi.";
			}
		});

	void fetchOAuthProviders(controller.signal)
		.then((list) => {
			providers = list;
		})
		.catch((cause: unknown) => {
			if (!controller.signal.aborted && !error) {
				error =
					cause instanceof Error
						? cause.message
						: "Provider tidak dapat dimuat.";
			}
		})
		.finally(() => {
			if (!controller.signal.aborted) loading = false;
		});
	return () => controller.abort();
});

async function signIn(provider: OAuthProvider) {
	signingIn = provider.id;
	error = "";
	try {
		await signInWithProvider(provider, callbackPath);
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "Login gagal.";
		signingIn = "";
	}
}
</script>

<div class="mx-auto flex min-h-[calc(100svh-7rem)] w-full max-w-sm items-center px-4 py-10">
	<section class="w-full rounded-[1.35rem] border bg-card p-5 shadow-2xl shadow-black/40 sm:p-7">
		<h1 class="mb-1 text-center font-bold text-2xl">Masuk</h1>
		<p class="mb-5 text-center text-muted-foreground text-sm">
			Lanjutkan dengan akun sosialmu.
		</p>
		<div class="space-y-3">
			{#if loading}
				<div
					class="h-12 animate-pulse rounded-xl bg-secondary"
					aria-label="Memuat provider login"
				></div>
			{:else if providers.length === 0 && !error}
				<p class="rounded-xl border bg-secondary/60 p-4 text-muted-foreground text-sm">
					Provider tidak tersedia.
				</p>
			{:else}
				{#each providers as provider (provider.id)}
					<button
						type="button"
						disabled={signingIn !== ""}
						onclick={() => void signIn(provider)}
						class="relative flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border bg-secondary px-4 font-semibold text-secondary-foreground text-sm transition hover:bg-accent disabled:cursor-wait disabled:opacity-60"
					>
						<ProviderLogo providerId={provider.id} />
						<span>{provider.name}</span>
						{#if signingIn === provider.id}
							<LoaderCircle
								class="absolute right-4 size-4 animate-spin"
								aria-label="Menghubungkan"
							/>
						{/if}
					</button>
				{/each}
			{/if}
			{#if error}
				<p
					role="alert"
					class="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm"
				>
					{error}
				</p>
			{/if}
		</div>
	</section>
</div>
