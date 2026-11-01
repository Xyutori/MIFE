<script lang="ts">
import {
	BookMarked,
	LoaderCircle,
	Pencil,
	Plus,
	Trash2,
	X,
} from "lucide-svelte";
import { onMount } from "svelte";
import { type BookmarkGroup, getBookmarks } from "#lib/api.ts";
import { authClient } from "#lib/auth-client.ts";
import SegmentedTabs from "#lib/components/ui/SegmentedTabs.svelte";
import {
	createBookmarkGroup,
	deleteBookmarkGroup,
	renameBookmarkGroup,
	resolveBookmarkCover,
} from "#lib/components/library/bookmark-groups.ts";
import LibraryGroupDialogs from "#lib/components/library/LibraryGroupDialogs.svelte";
import LoginCta from "#lib/components/profile/LoginCta.svelte";
import { type BookmarkType, syncBookmarksToServer } from "#lib/reader.ts";
import { decodeEntities } from "#lib/text.ts";

const session = authClient.useSession();

let type = $state<BookmarkType>("comic");
let groups = $state<BookmarkGroup[]>([]);
let loading = $state(true);
let error = $state("");
let creating = $state(false);
let draftName = $state("");
let createError = $state("");
let saving = $state(false);
let renameTarget = $state<BookmarkGroup | null>(null);
let deleteTarget = $state<BookmarkGroup | null>(null);
let actionError = $state("");

// Status konten area server: tidak ada dua dari
// {skeleton, grid, CTA, error} yang tampil bersamaan.
// - pending-session: sesi masih diperiksa → skeleton saja.
// - logged-out: pending selesai dan user null → CTA saja.
// - loading: fetch awal → skeleton saja.
// - error: pesan error + tombol coba lagi saja.
// - ready: grid grup + kartu "+" (selalu ada, walau grup kosong).
// Sinkronisasi latar berjalan diam-diam tanpa badge/section/pesan apa pun.
type Phase = "pending-session" | "logged-out" | "loading" | "ready" | "error";
const phase = $derived<Phase>(
	$session.isPending
		? "pending-session"
		: !$session.data?.user
			? "logged-out"
			: error
				? "error"
				: loading
					? "loading"
					: "ready",
);

async function loadGroups() {
	// Saat sesi masih pending, $session.data null sementara — jangan
	// bersihkan state/loading; tunggu sesi selesai lalu $effect memuat ulang.
	if ($session.isPending) return;
	loading = true;
	error = "";
	actionError = "";
	if (!$session.data?.user) {
		groups = [];
		loading = false;
		return;
	}
	const controller = new AbortController();
	try {
		groups = await getBookmarks(type, controller.signal);
	} catch (cause) {
		if (cause instanceof DOMException && cause.name === "AbortError") return;
		if (
			cause instanceof Error &&
			(cause as { status?: number }).status === 401
		) {
			groups = [];
		} else {
			error = cause instanceof Error ? cause.message : "Library gagal dimuat.";
		}
	} finally {
		loading = false;
	}
}

async function syncSilently() {
	if (!$session.data?.user) return;
	try {
		const result = await syncBookmarksToServer(type);
		groups = result.groups;
	} catch {
		// Best-effort: tanpa badge/pesan; grid tetap menampilkan data terakhir.
	}
}

onMount(() => {
	const params = new URLSearchParams(window.location.search);
	if (params.get("type") === "anime") type = "anime";
});

$effect(() => {
	type;
	$session;
	void loadGroups();
});

$effect(() => {
	// Sinkronisasi last-write-wins setiap kali sesi login tersedia (diam-diam).
	if ($session.data?.user) void syncSilently();
});

function switchType(next: BookmarkType) {
	type = next;
	creating = false;
	draftName = "";
	createError = "";
	renameTarget = null;
	deleteTarget = null;
	actionError = "";
	history.replaceState(null, "", `/library?type=${next}`);
}

function openCreate() {
	draftName = "";
	createError = "";
	creating = true;
}

async function submitCreate(event: SubmitEvent) {
	event.preventDefault();
	const name = draftName.trim();
	if (!name || saving) return;
	saving = true;
	createError = "";
	try {
		const group = await createBookmarkGroup(type, name);
		groups = [...groups, group];
		creating = false;
		draftName = "";
	} catch (cause) {
		createError =
			cause instanceof Error ? cause.message : "Library gagal dibuat.";
	} finally {
		saving = false;
	}
}

function openRename(group: BookmarkGroup) {
	// Grup default (isDefault dari server) tidak bisa diubah.
	if (group.isDefault) return;
	actionError = "";
	deleteTarget = null;
	renameTarget = group;
}

function openDelete(group: BookmarkGroup) {
	// Grup default (isDefault dari server) tidak bisa dihapus.
	if (group.isDefault) return;
	actionError = "";
	renameTarget = null;
	deleteTarget = group;
}

function closeGroupDialogs() {
	renameTarget = null;
	deleteTarget = null;
}

async function handleRename(name: string) {
	const target = renameTarget;
	renameTarget = null;
	if (!target || target.isDefault || !name) return;
	const previous = groups;
	// Optimistic: langsung ganti nama, sinkronkan ulang setelah PATCH sukses.
	groups = previous.map((entry) =>
		entry.id === target.id ? { ...entry, name } : entry,
	);
	actionError = "";
	try {
		const updated = await renameBookmarkGroup(target.id, name);
		groups = groups.map((entry) => (entry.id === target.id ? updated : entry));
	} catch (cause) {
		groups = previous;
		actionError =
			cause instanceof Error ? cause.message : "Nama library gagal diubah.";
	}
}

async function handleDelete() {
	const target = deleteTarget;
	deleteTarget = null;
	if (!target || target.isDefault) return;
	const previous = groups;
	// Optimistic: langsung hilangkan kartu, kembalikan bila DELETE gagal.
	groups = previous.filter((entry) => entry.id !== target.id);
	actionError = "";
	try {
		await deleteBookmarkGroup(target.id);
	} catch (cause) {
		groups = previous;
		actionError =
			cause instanceof Error ? cause.message : "Library gagal dihapus.";
	}
}
</script>

<svelte:head>
	<title>Library · MIFE</title>
</svelte:head>

<main class="mx-auto max-w-7xl px-4 pt-3 pb-6 min-[521px]:pb-24 sm:px-6 sm:pt-4 sm:pb-10">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<h1 class="font-extrabold text-3xl">Library</h1>
	</div>

	<SegmentedTabs
		tabs={[
			{ id: "comic", label: "Comic" },
			{ id: "anime", label: "Anime" },
		]}
		value={type}
		onChange={(id) => switchType(id as BookmarkType)}
		ariaLabel="Jenis library"
		class="mt-5"
	/>

	{#if $session.error && phase === "logged-out"}
		<div class="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm" role="alert">
			Sesi tidak dapat dimuat. Periksa koneksi lalu muat ulang halaman.
		</div>
	{/if}

	{#if phase === "pending-session" || phase === "loading"}
		<div class="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label="Memuat library">
			{#each [0, 1, 2, 3, 4] as i (i)}
				<div class="h-64 animate-pulse rounded-2xl bg-card" aria-hidden="true"></div>
			{/each}
		</div>
	{:else if phase === "logged-out"}
		<div class="mt-8">
			<LoginCta callbackPath="/library" />
		</div>
	{:else if phase === "error"}
		<div class="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center" role="alert">
			<p class="text-destructive text-sm">{error}</p>
			<button
				type="button"
				onclick={() => void loadGroups()}
				class="mt-4 min-h-11 rounded-full bg-primary px-5 font-bold text-primary-foreground text-sm transition hover:opacity-90"
			>
				Coba lagi
			</button>
		</div>
	{:else}
		{#if actionError}
			<div class="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-destructive text-sm" role="alert">
				<p>{actionError}</p>
				<button
					type="button"
					onclick={() => (actionError = "")}
					aria-label="Tutup pesan error"
					class="grid size-9 shrink-0 place-items-center rounded-full transition hover:bg-destructive/15"
				>
					<X class="size-4" aria-hidden="true" />
				</button>
			</div>
		{/if}
		<section aria-label="Grup library" class="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
			{#each groups as group (group.id)}
				{@const cover = resolveBookmarkCover(group.customCoverUrl ?? group.coverUrl)}
				<div class="relative h-full min-w-0">
					<a
						href={`/library/${group.id}`}
						aria-label={`Buka ${group.name}`}
						class="group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card transition duration-200 hover:-translate-y-0.5 hover:border-primary/40"
					>
						<span class="relative block aspect-[.69] overflow-hidden bg-secondary">
							{#if cover}
								<img
									src={cover}
									alt=""
									loading="lazy"
									class="size-full object-cover transition duration-500 group-hover:scale-[1.04]"
								/>
							{:else}
								<span class="grid size-full place-items-center" aria-hidden="true">
									<BookMarked class="size-10 text-muted-foreground" />
								</span>
							{/if}
						</span>
						<span class="flex flex-1 items-center justify-between gap-2 p-2 sm:p-4">
							<span class="min-w-0 truncate font-semibold text-sm">
								{decodeEntities(group.name)}
							</span>
							<span class="shrink-0 rounded-full bg-secondary px-2.5 py-1 font-semibold text-secondary-foreground text-xs">
								{group.itemCount}
							</span>
						</span>
					</a>
					{#if !group.isDefault}
						<div class="absolute top-2 right-2 z-10 flex gap-1.5">
							<button
								type="button"
								onclick={(event) => {
									event.stopPropagation();
									event.preventDefault();
									openRename(group);
								}}
								aria-label={`Ubah nama ${decodeEntities(group.name)}`}
								title="Ubah nama"
								class="grid size-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/85"
							>
								<Pencil class="size-4" aria-hidden="true" />
							</button>
							<button
								type="button"
								onclick={(event) => {
									event.stopPropagation();
									event.preventDefault();
									openDelete(group);
								}}
								aria-label={`Hapus ${decodeEntities(group.name)}`}
								title="Hapus"
								class="grid size-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-destructive"
							>
								<Trash2 class="size-4" aria-hidden="true" />
							</button>
						</div>
					{/if}
				</div>
			{/each}
			<button
				type="button"
				onclick={openCreate}
				aria-label="Buat library baru"
				title="Library baru"
				class="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border-2 border-dashed bg-card/40 text-muted-foreground transition hover:border-primary hover:bg-primary/5 hover:text-primary"
			>
				<span class="grid aspect-[.69] place-items-center" aria-hidden="true">
					<Plus class="size-12" />
				</span>
				<span class="flex flex-1 items-center justify-center p-2 font-semibold text-sm sm:p-4">
					Tambah library
				</span>
			</button>
		</section>
	{/if}

	{#if creating}
		<div class="fixed inset-0 z-50 grid items-center justify-center bg-black/75 p-4" role="presentation">
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`Buat library ${type === "comic" ? "komik" : "anime"} baru`}
				class="w-full max-w-sm rounded-3xl border bg-card p-5 shadow-2xl sm:p-6"
			>
				<h2 class="font-extrabold text-xl">Library baru</h2>
				<p class="mt-1 text-muted-foreground text-xs">
					Tipe mengikuti tab aktif: {type === "comic" ? "Comic" : "Anime"}.
				</p>
				<form onsubmit={submitCreate} class="mt-4 space-y-4">
					<label class="block font-semibold text-sm">
						Nama library
						<input
							type="text"
							bind:value={draftName}
							required
							maxlength={80}
							placeholder={type === "comic" ? "mis. Favorit komik" : "mis. Favorit anime"}
							aria-label="Nama library"
							class="mt-2 h-11 w-full rounded-xl border bg-background px-3 font-normal outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						/>
					</label>
					{#if createError}
						<p class="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-xs" role="alert">
							{createError}
						</p>
					{/if}
					<div class="flex justify-end gap-2">
						<button
							type="button"
							onclick={() => (creating = false)}
							class="min-h-10 rounded-full border px-4 font-semibold text-sm"
						>
							Batal
						</button>
						<button
							type="submit"
							disabled={!draftName.trim() || saving}
							class="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-5 font-bold text-primary-foreground text-sm disabled:opacity-60"
						>
							{#if saving}
								<LoaderCircle class="size-4 animate-spin" />
							{/if}
							Buat
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<LibraryGroupDialogs
		renameTarget={renameTarget}
		deleteTarget={deleteTarget}
		onClose={closeGroupDialogs}
		onRename={(name) => void handleRename(name)}
		onConfirmDelete={() => void handleDelete()}
	/>
</main>
