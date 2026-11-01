<script lang="ts">
import { Bookmark, BookmarkCheck } from "lucide-svelte";
import { onMount } from "svelte";
import { apiBase } from "#lib/api.ts";
import { authClient } from "#lib/auth-client.ts";
import LibrarySaveDrawer from "#lib/components/library/LibrarySaveDrawer.svelte";
import type { BookmarkType } from "#lib/reader.ts";

interface Props {
	type: BookmarkType;
	seriesId: string;
	title: string;
	coverUrl?: string | null;
	href?: string;
}

let { type, seriesId }: Props = $props();

const session = authClient.useSession();

let drawerOpen = $state(false);
let saved = $state(false);

async function refreshSaved() {
	if (!$session.data?.user) {
		saved = false;
		return;
	}
	try {
		const response = await fetch(`${apiBase()}/api/v1/bookmarks?type=${type}`, {
			credentials: "include",
		});
		if (!response.ok) return;
		const payload = (await response.json().catch(() => ({}))) as {
			groups?: { items?: { seriesId: string }[] }[];
		};
		const list = Array.isArray(payload.groups) ? payload.groups : [];
		saved = list.some((group) =>
			group.items?.some((item) => item.seriesId === seriesId),
		);
	} catch {
		// Label status best-effort; drawer memuat status kanonis saat dibuka.
	}
}

onMount(() => {
	void refreshSaved();
});

$effect(() => {
	$session.data?.user;
	type;
	seriesId;
	void refreshSaved();
});
</script>

<button
	type="button"
	onclick={() => (drawerOpen = true)}
	aria-pressed={saved}
	aria-label={saved ? "Tersimpan di library" : "Simpan ke library"}
	class={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 font-semibold text-sm ${saved ? "border-primary/40 bg-primary/10 text-primary" : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"}`}
>
	{#if saved}
		<BookmarkCheck class="size-4" />
	{:else}
		<Bookmark class="size-4" />
	{/if}
	{saved ? "Tersimpan" : "Simpan"}
</button>

{#if drawerOpen}
	<LibrarySaveDrawer
		open={drawerOpen}
		{type}
		{seriesId}
		onClose={() => (drawerOpen = false)}
		onMembershipChange={(value) => (saved = value)}
	/>
{/if}
