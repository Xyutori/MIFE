<script lang="ts">
import { onMount } from "svelte";
import { checkAdmin } from "#lib/admin.ts";
import { resolveMediaUrl } from "#lib/api.ts";
import { authClient } from "#lib/auth-client.ts";
import {
	fetchOAuthProviders,
	type OAuthProvider,
	providerDisplayName,
	signInWithProvider,
} from "#lib/components/auth/oauth.ts";
import ProviderLogo from "#lib/components/auth/ProviderLogo.svelte";
import { goto } from "$app/navigation";

const sessionQuery = authClient.useSession();

interface Props {
	minimal?: boolean;
}

let { minimal = false }: Props = $props();

let open = $state(false);
let menuRef: HTMLDivElement | null = $state(null);
let providers = $state<OAuthProvider[]>([]);
let providersLoading = $state(true);
let signingIn = $state("");
let signInError = $state("");
let isAdmin = $state(false);

const displayName = $derived(
	$sessionQuery.data?.user.name ||
		$sessionQuery.data?.user.email?.split("@")[0] ||
		"User",
);
const initial = $derived((displayName || "?").slice(0, 1).toUpperCase());
const avatar = $derived(
	resolveMediaUrl($sessionQuery.data?.user.image ?? null),
);

async function handleSignOut() {
	open = false;
	await authClient.signOut({
		fetchOptions: {
			onSuccess: () => {
				goto("/");
			},
			onError: (error) => {
				console.error("Sign out failed:", error);
			},
		},
	});
}

async function signIn(provider: OAuthProvider) {
	if (signingIn !== "") return;
	signingIn = provider.id;
	signInError = "";
	try {
		await signInWithProvider(provider, window.location.pathname);
	} catch (error) {
		console.error("Sign in failed:", error);
		// Jangan diam: tampilkan kegagalan login di header.
		signInError =
			error instanceof Error ? error.message : "Login gagal. Coba lagi.";
		signingIn = "";
	}
}

function close() {
	open = false;
}

onMount(() => {
	function onPointerDown(event: PointerEvent) {
		if (menuRef && !menuRef.contains(event.target as Node)) close();
	}
	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") close();
	}
	document.addEventListener("pointerdown", onPointerDown);
	document.addEventListener("keydown", onKeyDown);
	const controller = new AbortController();
	void fetchOAuthProviders(controller.signal)
		.then((list) => {
			if (!controller.signal.aborted) providers = list;
		})
		.catch(() => {
			// Menu tetap tampil tanpa provider bila gagal dimuat.
		})
		.finally(() => {
			if (!controller.signal.aborted) providersLoading = false;
		});
	return () => {
		document.removeEventListener("pointerdown", onPointerDown);
		document.removeEventListener("keydown", onKeyDown);
		controller.abort();
	};
});

onMount(() => {
	let active = true;
	void checkAdmin().then((state) => {
		if (active && state.kind === "admin") isAdmin = true;
	});
	return () => {
		active = false;
	};
});
</script>

<div class="relative" bind:this={menuRef}>
	{#if $sessionQuery.isPending}
		<div class="h-8 w-24 animate-pulse rounded bg-neutral-700"></div>
	{:else if $sessionQuery.data?.user}
		{@const user = $sessionQuery.data.user}
		<button
			type="button"
			onclick={() => (open = !open)}
			aria-haspopup="menu"
			aria-expanded={open}
			title={user.email}
			class="flex items-center gap-2 rounded-full border border-neutral-700 py-1 pr-3 pl-1 transition hover:bg-neutral-800"
		>
			{#if avatar}
				<img
					src={avatar}
					alt=""
					referrerpolicy="no-referrer"
					class="size-7 rounded-full bg-neutral-700 object-cover"
				/>
			{:else}
				<span class="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
					{initial}
				</span>
			{/if}
			<span class="hidden max-w-28 truncate text-sm text-neutral-200 sm:inline">
				{displayName}
			</span>
		</button>
		{#if open}
			<div
				role="menu"
				class="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl shadow-black/50"
			>
				<a
					href="/profile"
					role="menuitem"
					onclick={close}
					class="block px-4 py-2.5 text-sm text-neutral-200 transition hover:bg-neutral-800"
				>
					Profile
				</a>
				{#if !minimal}
					<a
						href="/profile/settings"
						role="menuitem"
						onclick={close}
						class="block px-4 py-2.5 text-sm text-neutral-200 transition hover:bg-neutral-800"
					>
						Pengaturan
					</a>
					{#if isAdmin}
						<a
							href="/admin"
							role="menuitem"
							onclick={close}
							class="block px-4 py-2.5 text-sm text-neutral-200 transition hover:bg-neutral-800"
						>
							Admin
						</a>
					{/if}
				{/if}
				<button
					type="button"
					role="menuitem"
					onclick={() => void handleSignOut()}
					class="block w-full px-4 py-2.5 text-left text-sm text-destructive transition hover:bg-neutral-800"
				>
					Keluar
				</button>
			</div>
		{/if}
	{:else}
		<div class="flex flex-col items-end gap-1">
			<div class="flex items-center gap-2">
				{#if providersLoading}
					<div class="h-9 w-24 animate-pulse rounded-full bg-secondary" aria-label="Memuat tombol masuk"></div>
				{:else}
					{#each providers as provider (provider.id)}
						<button
							type="button"
							title={providerDisplayName(provider.id)}
							aria-label={providerDisplayName(provider.id)}
							disabled={signingIn !== ""}
							onclick={() => void signIn(provider)}
							class="flex min-h-9 items-center gap-2 rounded-full border bg-secondary px-3 font-semibold text-secondary-foreground text-sm transition hover:bg-accent disabled:cursor-wait disabled:opacity-60"
						>
							<ProviderLogo providerId={provider.id} />
							<span class="hidden sm:inline">{providerDisplayName(provider.id)}</span>
						</button>
					{/each}
				{/if}
			</div>
			{#if signInError}
				<p role="alert" class="max-w-60 text-right text-red-300 text-xs">{signInError}</p>
			{/if}
		</div>
	{/if}
</div>
