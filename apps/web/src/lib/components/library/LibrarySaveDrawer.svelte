<script lang="ts">
import { Check, LoaderCircle, Plus, X } from "lucide-svelte";
import { portal } from "#lib/actions/portal.ts";
import { type BookmarkGroup, getBookmarks } from "#lib/api.ts";
import { authClient } from "#lib/auth-client.ts";
import {
	addBookmarkItem,
	createBookmarkGroup,
	removeBookmarkItem,
} from "#lib/components/library/bookmark-groups.ts";
import BottomSheet from "#lib/components/ui/BottomSheet.svelte";
import type { BookmarkType } from "#lib/reader.ts";
import { decodeEntities } from "#lib/text.ts";

interface Props {
	open: boolean;
	type: BookmarkType;
	seriesId: string;
	onClose: () => void;
	onMembershipChange?: (saved: boolean) => void;
}

let { open, type, seriesId, onClose, onMembershipChange }: Props = $props();

const session = authClient.useSession();

let groups = $state<BookmarkGroup[]>([]);
let loading = $state(false);
let busyId = $state<string | null>(null);
let newName = $state("");
let creating = $state(false);
let error = $state("");
let nameError = $state("");
let showCreate = $state(false);
let createInput: HTMLInputElement | null = $state(null);

function notifyMembership(next: BookmarkGroup[]) {
	onMembershipChange?.(
		next.some((group) =>
			group.items.some((item) => item.seriesId === seriesId),
		),
	);
}

async function loadGroups() {
	if (!$session.data?.user) {
		groups = [];
		return;
	}
	loading = true;
	error = "";
	try {
		groups = await getBookmarks(type);
		notifyMembership(groups);
	} catch (cause) {
		if (cause instanceof DOMException && cause.name === "AbortError") return;
		error =
			cause instanceof Error ? cause.message : "Daftar library gagal dimuat.";
	} finally {
		loading = false;
	}
}

$effect(() => {
	if (open) {
		newName = "";
		error = "";
		nameError = "";
		showCreate = false;
		void loadGroups();
	}
});

$effect(() => {
	if (showCreate) createInput?.focus();
});

// Derivasikan status simpan tiap grup dari data client-side (tanpa endpoint baru).
function membershipOf(group: BookmarkGroup) {
	const item = group.items.find((entry) => entry.seriesId === seriesId);
	return item
		? { saved: true as const, itemId: item.id }
		: { saved: false as const, itemId: null };
}

async function toggle(group: BookmarkGroup) {
	if (busyId || creating) return;
	const membership = membershipOf(group);
	const previous = groups;
	busyId = group.id;
	error = "";
	if (membership.saved && membership.itemId) {
		groups = previous.map((entry) =>
			entry.id === group.id
				? {
						...entry,
						items: entry.items.filter((item) => item.id !== membership.itemId),
						itemCount: Math.max(0, entry.itemCount - 1),
					}
				: entry,
		);
		notifyMembership(groups);
		try {
			await removeBookmarkItem(group.id, membership.itemId);
			groups = await getBookmarks(type);
			notifyMembership(groups);
		} catch (cause) {
			groups = previous;
			notifyMembership(groups);
			error =
				cause instanceof Error
					? cause.message
					: "Judul gagal dikeluarkan dari library.";
		} finally {
			busyId = null;
		}
		return;
	}
	groups = previous.map((entry) =>
		entry.id === group.id
			? {
					...entry,
					items: [
						...entry.items,
						{ id: `temp-${seriesId}`, seriesId, title: "" },
					],
					itemCount: entry.itemCount + 1,
				}
			: entry,
	);
	notifyMembership(groups);
	try {
		await addBookmarkItem(group.id, seriesId);
		groups = await getBookmarks(type);
		notifyMembership(groups);
	} catch (cause) {
		groups = previous;
		notifyMembership(groups);
		error =
			cause instanceof Error
				? cause.message
				: "Judul gagal ditambahkan ke library.";
	} finally {
		busyId = null;
	}
}

function clearNameError() {
	const name = newName.trim();
	if (name.length >= 3 && name.length <= 50) nameError = "";
}

async function createGroup(event: SubmitEvent) {
	event.preventDefault();
	const name = newName.trim();
	if (name.length < 3 || name.length > 50) {
		nameError = "min 3 karakter, max 50 karakter";
		return;
	}
	if (creating) return;
	creating = true;
	error = "";
	nameError = "";
	try {
		const group = await createBookmarkGroup(type, name);
		groups = [...groups, group];
		showCreate = false;
		newName = "";
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "Library gagal dibuat.";
	} finally {
		creating = false;
	}
}

function cancelCreate() {
	showCreate = false;
	newName = "";
	nameError = "";
}

function handleCreateKey(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.stopPropagation();
		cancelCreate();
	}
}

function handleKey(event: KeyboardEvent) {
	if (event.key !== "Escape") return;
	if (showCreate) {
		cancelCreate();
		return;
	}
	onClose();
}
</script>

<svelte:window onkeydown={handleKey} />
{#snippet content()}
	{#if !$session.data?.user && !$session.isPending}
		<p class="rounded-2xl border border-dashed p-8 text-center text-muted-foreground text-sm">
			Masuk untuk menyimpan ke library.
		</p>
	{:else}
		{#if showCreate}
			<form
				onsubmit={createGroup}
				class="flex flex-col gap-2"
				aria-label="Buat library baru"
			>
				<div class="flex items-center gap-2">
					<input
						type="text"
						bind:this={createInput}
						bind:value={newName}
						onkeydown={handleCreateKey}
						oninput={clearNameError}
						placeholder="Nama library baru"
						minlength={3}
						maxlength={50}
						aria-label="Nama library baru"
						aria-invalid={nameError ? "true" : undefined}
						aria-describedby={nameError ? "library-name-error" : undefined}
						disabled={creating}
						class="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60"
					/>
					<button
						type="submit"
						disabled={newName.trim().length < 3 || newName.trim().length > 50 || creating}
						class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
						aria-label="Buat library baru"
						title="Buat library baru"
					>
						{#if creating}
							<LoaderCircle class="size-5 animate-spin" />
						{:else}
							<Plus class="size-5" />
						{/if}
					</button>
					<button
						type="button"
						onclick={cancelCreate}
						aria-label="Batal buat library"
						class="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary transition hover:bg-accent"
					>
						<X class="size-5" />
					</button>
				</div>
				{#if nameError}
					<p id="library-name-error" role="alert" class="text-destructive text-xs">
						{nameError}
					</p>
				{/if}
			</form>
		{:else}
			<button
				type="button"
				onclick={() => (showCreate = true)}
				class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed p-2.5 text-sm font-semibold text-muted-foreground transition hover:bg-accent/50 hover:text-foreground"
			>
				<Plus class="size-5" />
				Buat library baru
			</button>
		{/if}

		{#if error}
			<p class="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-xs" role="alert">
				{error}
			</p>
		{/if}

		{#if loading}
			<div class="mt-4 grid gap-2" aria-label="Memuat library">
				{#each [0, 1, 2] as i (i)}
					<div class="h-12 animate-pulse rounded-2xl bg-secondary" aria-hidden="true"></div>
				{/each}
			</div>
		{:else}
			<ul class="mt-4 grid gap-2">
				{#each groups as group (group.id)}
					{@const membership = membershipOf(group)}
					<li
						class="flex items-center gap-3 rounded-2xl border p-2.5 transition {membership.saved ? "border-primary/40 bg-primary/10" : "border-border bg-background/60"}"
					>
						<p class="min-w-0 flex-1 truncate font-semibold text-sm {membership.saved ? "text-primary" : ""}">
							{decodeEntities(group.name)}
						</p>
						<button
							type="button"
							onclick={() => void toggle(group)}
							disabled={busyId !== null}
							aria-label={membership.saved
								? `Keluarkan dari ${group.name}`
								: `Simpan ke ${group.name}`}
							aria-pressed={membership.saved}
							title={membership.saved
								? `Keluarkan dari ${group.name}`
								: `Simpan ke ${group.name}`}
							class="grid size-10 shrink-0 place-items-center rounded-full transition disabled:opacity-60 {membership.saved
								? "bg-primary/15 text-primary hover:bg-destructive/15 hover:text-destructive"
								: "bg-secondary text-foreground hover:bg-primary hover:text-primary-foreground"}"
						>
							{#if busyId === group.id}
								<LoaderCircle class="size-5 animate-spin" />
							{:else if membership.saved}
								<Check class="size-5" />
							{:else}
								<Plus class="size-5" />
							{/if}
						</button>
					</li>
				{/each}
			</ul>
			{#if !loading && groups.length === 0 && !error}
				<p class="mt-4 rounded-2xl border border-dashed p-6 text-center text-muted-foreground text-sm">
					Belum ada library. Buat lewat tombol + di atas.
				</p>
			{/if}
		{/if}
	{/if}
{/snippet}

{#if open}
	<div class="sm:hidden">
		<BottomSheet {open} onClose={onClose} title="Simpan ke library">
			<div class="py-3">
				{@render content()}
			</div>
		</BottomSheet>
	</div>
	<div class="fixed inset-0 z-[999] hidden sm:block" style="z-index: 999;" role="presentation" use:portal>
		<button
			type="button"
			aria-label="Tutup drawer simpan"
			onclick={onClose}
			class="absolute inset-0 h-full w-full cursor-default bg-black/60"
		></button>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Simpan ke library"
			class="absolute top-0 right-0 hidden h-full w-full max-w-sm flex-col border-l bg-card shadow-2xl sm:flex"
		>
			<div class="flex items-center justify-between gap-4 border-b p-5">
				<h2 class="font-extrabold text-lg">Simpan ke library</h2>
				<button
					type="button"
					onclick={onClose}
					aria-label="Tutup"
					class="grid size-10 shrink-0 place-items-center rounded-full bg-secondary hover:bg-accent"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="flex-1 overflow-y-auto p-5">
				{@render content()}
			</div>
		</div>
	</div>
{/if}
