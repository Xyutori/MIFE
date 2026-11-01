<script lang="ts">
import { onMount } from "svelte";
import { resolveMediaUrl } from "#lib/api.ts";
import { authClient } from "#lib/auth-client.ts";
import LoginCta from "#lib/components/profile/LoginCta.svelte";
import ProfileMenuSection from "#lib/components/profile/ProfileMenuSection.svelte";
import {
	fetchProfile,
	type UserProfile,
} from "#lib/components/profile/profile-api.ts";
import { goto } from "$app/navigation";

const session = authClient.useSession();

let user = $state<UserProfile | null>(null);
let loading = $state(true);
let error = $state("");

const isAdmin = $derived(user?.isAdmin === true || user?.role === "admin");
const displayName = $derived(
	user?.name?.trim() || user?.username?.trim() || "Pengguna MIFE",
);

onMount(() => {
	const controller = new AbortController();
	const current = $session.data?.user;
	if (!current) {
		loading = false;
		return;
	}
	const fallback: UserProfile = {
		id: current.id,
		name: current.name ?? "",
		email: current.email ?? "",
		image: current.image ?? null,
	};
	void fetchProfile(controller.signal)
		.then((profile) => {
			if (controller.signal.aborted) return;
			user = profile ?? fallback;
		})
		.catch((cause: unknown) => {
			if (controller.signal.aborted) return;
			// Endpoint profil backend mungkin belum mendarat:
			// tampilkan data sesi agar halaman tetap berguna.
			user = fallback;
			if (
				cause instanceof Error &&
				!/failed to fetch|profil tidak dapat dimuat/i.test(cause.message)
			) {
				error = cause.message;
			}
		})
		.finally(() => {
			if (!controller.signal.aborted) loading = false;
		});
	return () => controller.abort();
});

async function signOut() {
	await authClient.signOut({
		fetchOptions: {
			onSuccess: () => goto("/"),
		},
	});
}
</script>

{#if $session.isPending || loading}
	<main class="mx-auto min-h-[70vh] max-w-4xl px-4 py-8 sm:px-6" aria-busy="true">
		<div class="aspect-[3/1] w-full animate-pulse rounded-3xl bg-card"></div>
		<div class="mx-auto -mt-12 size-24 animate-pulse rounded-full border-4 border-background bg-secondary sm:size-28"></div>
		<div class="mx-auto mt-5 h-8 w-48 animate-pulse rounded bg-secondary"></div>
	</main>
{:else if !user}
	<main class="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-4 py-12">
		{#if error}
			<p role="alert" class="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive text-sm">{error}</p>
		{:else}
			<LoginCta callbackPath="/profile" />
		{/if}
	</main>
{:else}
	<main class="mx-auto max-w-5xl px-4 py-6 min-[521px]:pb-24 sm:px-6 sm:py-10">
		<h1 class="mb-6 font-extrabold text-3xl">Profile</h1>

		<section aria-label="Profil" class="overflow-hidden rounded-3xl border bg-card">
			{#if user.headerImage}
				<img
					src={resolveMediaUrl(user.headerImage)}
					alt=""
					referrerpolicy="no-referrer"
					class="aspect-[3/1] w-full object-cover"
				/>
			{:else}
				<div
					aria-hidden="true"
					class="aspect-[3/1] w-full bg-gradient-to-br from-primary/40 via-secondary to-card"
				></div>
			{/if}

			<div class="relative px-5 pb-6 sm:px-8">
				<div class="-mt-12 sm:-mt-14">
					{#if user.image}
						<img
							src={resolveMediaUrl(user.image)}
							alt="Foto profil"
							referrerpolicy="no-referrer"
							class="size-24 rounded-full border-4 border-card bg-secondary object-cover sm:size-28"
						/>
					{:else}
						<span
							aria-hidden="true"
							class="flex size-24 items-center justify-center rounded-full border-4 border-card bg-secondary font-bold text-3xl text-muted-foreground sm:size-28"
						>
							{(displayName || user.email || "?").slice(0, 1).toUpperCase()}
						</span>
					{/if}
				</div>

				<h2 class="mt-4 font-extrabold text-2xl">{displayName}</h2>
				<p class="mt-1 text-muted-foreground text-sm">{user.email}</p>
			</div>
		</section>

		<ProfileMenuSection {isAdmin} />

		{#if error}
			<p
				role="alert"
				class="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm"
			>
				{error}
			</p>
		{/if}
		<button
			type="button"
			onclick={() => void signOut()}
			class="mt-6 inline-flex min-h-11 items-center rounded-full border px-5 font-semibold text-sm transition hover:bg-accent"
		>
			Keluar
		</button>
	</main>
{/if}
