<script lang="ts">
import {
	ArrowLeft,
	BookMarked,
	Clapperboard,
	Pencil,
	Trash2,
	X,
} from "lucide-svelte";
import { type BookmarkGroup } from "#lib/api.ts";
import { authClient } from "#lib/auth-client.ts";
import {
	deleteBookmarkGroup,
	fetchBookmarkGroup,
	renameBookmarkGroup,
	resolveBookmarkCover,
} from "#lib/components/library/bookmark-groups.ts";
import LibraryGroupDialogs from "#lib/components/library/LibraryGroupDialogs.svelte";
import LoginCta from "#lib/components/profile/LoginCta.svelte";
import { decodeEntities } from "#lib/text.ts";
import { goto } from "$app/navigation";
import { page } from "$app/state";

const session = authClient.useSession();

const groupId = $derived(page.params.groupId ?? "");

let group = $state<BookmarkGroup | null>(null);
let loading = $state(true);
let error = $state("");
let unauthorized = $state(false);
let renaming = $state(false);
let deleting = $state(false);
let actionError = $state("");

$effect(() => {
	const id = groupId;
	// Tunggu status sesi final sebelum memutuskan 401 vs data.
	const user = $session.data?.user;
	const pending = $session.isPending;
	if (!id) {
		group = null;
		loading = false;
		error = "Library tidak ditemukan.";
		return;
	}
	if (pending) return;
	if (!user) {
		group = null;
		loading = false;
		unauthorized = true;
		return;
	}
	const controller = new AbortController();
	let active = true;
	group = null;
	error = "";
	unauthorized = false;
	renaming = false;
	deleting = false;
	actionError = "";
	loading = true;
	void fetchBookmarkGroup(id, controller.signal)
		.then((payload) => {
			if (!active) return;
			group = payload;
		})
		.catch((cause: unknown) => {
			if (!active) return;
			if (cause instanceof DOMException && cause.name === "AbortError") return;
			if (
				cause instanceof Error &&
				(cause as { status?: number }).status === 401
			) {
				unauthorized = true;
				return;
			}
			error = cause instanceof Error ? cause.message : "Library gagal dimuat.";
		})
		.finally(() => {
			if (active) loading = false;
		});
	return () => {
		active = false;
		controller.abort();
	};
});

const backHref = $derived(group ? `/library?type=${group.type}` : "/library");
const isAnime = $derived(group?.type === "anime");

function openRename() {
	// Grup default (isDefault dari server) tidak bisa diubah.
	if (!group || group.isDefault) return;
	actionError = "";
	deleting = false;
	renaming = true;
}

function openDelete() {
	// Grup default (isDefault dari server) tidak bisa dihapus.
	if (!group || group.isDefault) return;
	actionError = "";
	renaming = false;
	deleting = true;
}

function closeGroupDialogs() {
	renaming = false;
	deleting = false;
}

async function handleRename(name: string) {
	const current = group;
	renaming = false;
	if (!current || current.isDefault || !name) return;
	const previous = current;
	// Optimistic: judul header langsung ikut berubah.
	group = { ...current, name };
	actionError = "";
	try {
		group = await renameBookmarkGroup(current.id, name);
	} catch (cause) {
		group = previous;
		actionError =
			cause instanceof Error ? cause.message : "Nama library gagal diubah.";
	}
}

async function handleDelete() {
	const current = group;
	deleting = false;
	if (!current || current.isDefault) return;
	// Pertahankan ?type= yang aktif saat kembali ke /library.
	const returnHref = `/library?type=${current.type}`;
	const previous = current;
	actionError = "";
	try {
		await deleteBookmarkGroup(current.id);
		group = null;
		await goto(returnHref);
	} catch (cause) {
		group = previous;
		actionError =
			cause instanceof Error ? cause.message : "Library gagal dihapus.";
	}
}
</script>

<svelte:head>
	<title>{group ? `${decodeEntities(group.name)} · Library · MIFE` : "Detail Library · MIFE"}</title>
</svelte:head>

<main class="mx-auto max-w-7xl px-4 pt-3 pb-6 min-[521px]:pb-24 sm:px-6 sm:pt-4 sm:pb-10">
	<a
		href={backHref}
		class="inline-flex min-h-10 items-center gap-2 rounded-full border px-4 font-semibold text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
	>
		<ArrowLeft class="size-4" />
		Kembali ke library
	</a>

	{#if $session.isPending || loading}
		<div class="mt-6" aria-label="Memuat library">
			<div class="h-8 w-48 animate-pulse rounded-xl bg-card" aria-hidden="true"></div>
			<div class="mt-2 h-4 w-32 animate-pulse rounded-lg bg-card" aria-hidden="true"></div>
			<div class="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-hidden="true">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<div class="h-64 animate-pulse rounded-2xl bg-card"></div>
				{/each}
			</div>
		</div>
	{:else if unauthorized}
		<div class="mt-8">
			<LoginCta callbackPath={`/library/${groupId}`} />
		</div>
	{:else if error || !group}
		<div class="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center" role="alert">
			<p class="text-destructive text-sm">{error || "Library tidak ditemukan."}</p>
			<a
				href="/library"
				class="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-bold text-primary-foreground text-sm transition hover:opacity-90"
			>
				Ke daftar library
			</a>
		</div>
	{:else}
		{@const cover = resolveBookmarkCover(group.customCoverUrl ?? group.coverUrl)}
		<header class="mt-6 flex items-center gap-4">
			<span class="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-card sm:size-24">
				{#if cover}
					<img src={cover} alt="" loading="lazy" class="h-full w-full object-cover" />
				{:else if isAnime}
					<Clapperboard class="size-8 text-muted-foreground" />
				{:else}
					<BookMarked class="size-8 text-muted-foreground" />
				{/if}
			</span>
			<div class="min-w-0 flex-1">
				<p class="font-bold text-[10px] text-primary uppercase tracking-[0.18em]">
					{isAnime ? "Anime" : "Comic"} · {group.itemCount}
				</p>
				<div class="mt-1 flex items-center gap-2">
					<h1 class="min-w-0 flex-1 truncate font-extrabold text-2xl sm:text-3xl">
						{decodeEntities(group.name)}
					</h1>
					{#if !group.isDefault}
						<button
							type="button"
							onclick={openRename}
							aria-label={`Ubah nama ${decodeEntities(group.name)}`}
							title="Ubah nama"
							class="grid size-10 shrink-0 place-items-center rounded-full border text-muted-foreground transition hover:bg-accent hover:text-foreground"
						>
							<Pencil class="size-4" aria-hidden="true" />
						</button>
					{/if}
				</div>
			</div>
			{#if !group.isDefault}
				<button
					type="button"
					onclick={openDelete}
					aria-label={`Hapus ${decodeEntities(group.name)}`}
					title="Hapus"
					class="grid size-10 shrink-0 place-items-center self-start rounded-full border text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
				>
					<Trash2 class="size-4" aria-hidden="true" />
				</button>
			{/if}
		</header>

		{#if actionError}
			<div class="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-destructive text-sm" role="alert">
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

		{#if group.items.length === 0}
			<p class="mt-6 rounded-2xl border border-dashed bg-card/60 p-8 text-center text-muted-foreground text-sm">
				{isAnime ? "Belum ada anime di library ini." : "Belum ada komik di library ini."}
			</p>
		{:else}
			<section aria-label={`Isi ${group.name}`} class="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
				{#each group.items as item (item.id)}
					{@const itemCover = resolveBookmarkCover(item.coverUrl)}
					<a
						href={item.href ?? "#"}
						class="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card transition duration-200 hover:-translate-y-0.5 hover:border-primary/40"
					>
						<span class="relative block aspect-[.69] overflow-hidden bg-secondary">
							{#if itemCover}
								<img
									src={itemCover}
									alt=""
									loading="lazy"
									class="size-full object-cover transition duration-500 group-hover:scale-[1.04]"
								/>
							{:else}
								<span class="grid size-full place-items-center" aria-hidden="true">
									{#if isAnime}
										<Clapperboard class="size-8 text-muted-foreground" />
									{:else}
										<BookMarked class="size-8 text-muted-foreground" />
									{/if}
								</span>
							{/if}
						</span>
						<span class="line-clamp-2 min-h-10 p-2 font-semibold text-xs leading-4 sm:p-4 sm:text-sm sm:leading-5">
							{decodeEntities(item.title)}
						</span>
					</a>
				{/each}
			</section>
		{/if}
	{/if}

	<LibraryGroupDialogs
		renameTarget={renaming ? group : null}
		deleteTarget={deleting ? group : null}
		onClose={closeGroupDialogs}
		onRename={(name) => void handleRename(name)}
		onConfirmDelete={() => void handleDelete()}
	/>
</main>
