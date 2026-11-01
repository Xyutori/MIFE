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

let { callbackPath }: { callbackPath: string } = $props();

const title = "Masuk dulu yuk";

let providers = $state<OAuthProvider[]>([]);
let loading = $state(true);
let signingIn = $state("");
let error = $state("");

onMount(() => {
	const controller = new AbortController();
	// Samakan dengan halaman login: kegagalan OAuth via redirect (?error=)
	// maupun pemeriksaan sesi wajib tampil sebagai pesan.
	const search = new URLSearchParams(window.location.search);
	const errorCode = search.getAll("error").at(-1);
	if (errorCode) {
		error = oauthErrorMessage(
			errorCode,
			search.get("error_description"),
			undefined,
			providerDisplayName(search.get("provider")),
		);
	}
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
			if (!controller.signal.aborted) providers = list;
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

<section
	class="mx-auto w-full max-w-md rounded-3xl border bg-card p-5 text-center sm:p-7"
	aria-label={title}
>
	<h1 class="font-extrabold text-2xl">{title}</h1>
	<div class="mt-5 space-y-3">
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
					<span>{providerDisplayName(provider.id)}</span>
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
