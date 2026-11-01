<script lang="ts">
import type { BookmarkGroup } from "#lib/api.ts";
import { decodeEntities } from "#lib/text.ts";

interface Props {
	renameTarget: BookmarkGroup | null;
	deleteTarget: BookmarkGroup | null;
	onClose: () => void;
	onRename: (name: string) => void;
	onConfirmDelete: () => void;
}

let { renameTarget, deleteTarget, onClose, onRename, onConfirmDelete }: Props =
	$props();

let draft = $state("");
let lastRenameId = $state<string | null>(null);
let nameInput: HTMLInputElement | null = $state(null);
let cancelDeleteButton: HTMLButtonElement | null = $state(null);

const open = $derived(renameTarget !== null || deleteTarget !== null);
const renameLabel = $derived(
	renameTarget ? decodeEntities(renameTarget.name) : "",
);
const deleteLabel = $derived(
	deleteTarget ? decodeEntities(deleteTarget.name) : "",
);
// Nonaktifkan simpan bila kosong atau tidak berubah dari nama saat ini.
const renameUnchanged = $derived(
	!draft.trim() || draft.trim() === renameLabel.trim(),
);

// Prefill sekali per target (jangan timpa saat pengguna mengetik).
$effect(() => {
	const target = renameTarget;
	if (target && target.id !== lastRenameId) {
		lastRenameId = target.id;
		draft = decodeEntities(target.name);
	}
	if (!target) lastRenameId = null;
});

$effect(() => {
	if (renameTarget) nameInput?.focus();
});

$effect(() => {
	if (deleteTarget) cancelDeleteButton?.focus();
});

function handleKey(event: KeyboardEvent) {
	if (!open || event.key !== "Escape") return;
	onClose();
}

function submitRename(event: SubmitEvent) {
	event.preventDefault();
	const name = draft.trim();
	if (!name || renameUnchanged) return;
	onRename(name);
}
</script>

<svelte:window onkeydown={handleKey} />

{#if renameTarget}
	<div class="fixed inset-0 z-50 grid items-center justify-center bg-black/75 p-4" role="presentation">
		<div
			role="dialog"
			aria-modal="true"
			aria-label={`Ubah nama ${renameLabel}`}
			class="w-full max-w-sm rounded-3xl border bg-card p-5 shadow-2xl sm:p-6"
		>
			<h2 class="font-extrabold text-xl">Ubah nama library</h2>
			<p class="mt-1 text-muted-foreground text-xs">
				Nama baru untuk "{renameLabel}".
			</p>
			<form onsubmit={submitRename} class="mt-4 space-y-4">
				<label class="block font-semibold text-sm">
					Nama library
					<input
						type="text"
						bind:this={nameInput}
						bind:value={draft}
						required
						maxlength={80}
						aria-label="Nama library"
						class="mt-2 h-11 w-full rounded-xl border bg-background px-3 font-normal outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
					/>
				</label>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={onClose}
						class="min-h-10 rounded-full border px-4 font-semibold text-sm"
					>
						Batal
					</button>
					<button
						type="submit"
						disabled={renameUnchanged}
						class="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-5 font-bold text-primary-foreground text-sm disabled:opacity-60"
					>
						Simpan
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if deleteTarget}
	<div class="fixed inset-0 z-50 grid items-center justify-center bg-black/75 p-4" role="presentation">
		<div
			role="dialog"
			aria-modal="true"
			aria-label={`Hapus ${deleteLabel}`}
			class="w-full max-w-sm rounded-3xl border bg-card p-5 shadow-2xl sm:p-6"
		>
			<h2 class="font-extrabold text-xl">Hapus library?</h2>
			<p class="mt-2 text-muted-foreground text-sm">
				"{deleteLabel}" berisi {deleteTarget.itemCount} judul dan akan dihapus
				beserta seluruh isinya. Tindakan ini tidak bisa dibatalkan.
			</p>
			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					bind:this={cancelDeleteButton}
					onclick={onClose}
					class="min-h-10 rounded-full border px-4 font-semibold text-sm"
				>
					Batal
				</button>
				<button
					type="button"
					onclick={onConfirmDelete}
					aria-label={`Hapus ${deleteLabel}`}
					class="inline-flex min-h-10 items-center gap-2 rounded-full bg-destructive px-5 font-bold text-destructive-foreground text-sm transition hover:opacity-90"
				>
					Hapus
				</button>
			</div>
		</div>
	</div>
{/if}
