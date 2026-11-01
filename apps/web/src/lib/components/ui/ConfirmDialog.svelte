<script lang="ts">
interface Props {
	open: boolean;
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	confirming?: boolean;
	onClose: () => void;
	onConfirm: () => void;
}

let {
	open,
	title,
	message,
	confirmLabel = "Hapus",
	cancelLabel = "Batal",
	confirming = false,
	onClose,
	onConfirm,
}: Props = $props();

let cancelButton: HTMLButtonElement | null = $state(null);

$effect(() => {
	if (open) cancelButton?.focus();
});

function handleKey(event: KeyboardEvent) {
	if (!open || event.key !== "Escape") return;
	onClose();
}
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
	<div class="fixed inset-0 z-50 grid items-center justify-center bg-black/75 p-4" role="presentation">
		<div
			role="dialog"
			aria-modal="true"
			aria-label={title}
			class="w-full max-w-sm rounded-3xl border bg-card p-5 shadow-2xl sm:p-6"
		>
			<h2 class="font-extrabold text-xl">{title}</h2>
			<p class="mt-2 text-muted-foreground text-sm">{message}</p>
			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					bind:this={cancelButton}
					onclick={onClose}
					class="min-h-10 rounded-full border px-4 font-semibold text-sm"
				>
					{cancelLabel}
				</button>
				<button
					type="button"
					onclick={onConfirm}
					disabled={confirming}
					class="inline-flex min-h-10 items-center gap-2 rounded-full bg-destructive px-5 font-bold text-destructive-foreground text-sm transition hover:opacity-90 disabled:opacity-60"
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
