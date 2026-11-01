<script lang="ts">
import { X } from "lucide-svelte";
import type { Snippet } from "svelte";
import { portal } from "#lib/actions/portal.ts";

interface Props {
	open: boolean;
	onClose: () => void;
	title: string;
	description?: string;
	children: Snippet;
	footer?: Snippet;
	dismissible?: boolean;
	showHandle?: boolean;
	showClose?: boolean;
}

let {
	open,
	onClose,
	title,
	description,
	children,
	footer,
	dismissible = true,
	showHandle = true,
	showClose = true,
}: Props = $props();

let closeButton: HTMLButtonElement | null = $state(null);
let dragY = $state(0);
let dragging = $state(false);

let startY = 0;
let startTime = 0;
let lastY = 0;
let lastTime = 0;

function handleClose() {
	if (!dismissible) return;
	onClose();
}

function onHandlePointerDown(event: PointerEvent) {
	if (!dismissible) return;
	dragging = true;
	startY = event.clientY;
	lastY = event.clientY;
	startTime = performance.now();
	lastTime = startTime;
	dragY = 0;
	(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function onHandlePointerMove(event: PointerEvent) {
	if (!dragging) return;
	dragY = Math.max(0, event.clientY - startY);
	lastY = event.clientY;
	lastTime = performance.now();
}

function onHandlePointerUp() {
	if (!dragging) return;
	dragging = false;
	const dy = dragY;
	const dt = Math.max(1, lastTime - startTime);
	const velocity = (lastY - startY) / dt;
	if (dy >= 90 || velocity >= 0.6) {
		dragY = 0;
		handleClose();
		return;
	}
	dragY = 0;
}

$effect(() => {
	if (!open) return;
	closeButton?.focus();
	document.body.style.overflow = "hidden";
	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") handleClose();
	}
	document.addEventListener("keydown", onKeyDown);
	return () => {
		document.body.style.overflow = "";
		document.removeEventListener("keydown", onKeyDown);
	};
});
</script>

{#if open}
	<!-- z-index inline (bukan hanya class) agar overlay selalu menang
		dari konten halaman apapun, termasuk bila CSS tertinggal. -->
	<div class="fixed inset-0 z-[999]" style="z-index: 999;" use:portal>
		<button
			type="button"
			aria-label="Tutup dialog"
			onclick={handleClose}
			class="sheet-backdrop absolute inset-0 bg-black/60"
		></button>
		<div
			role="dialog"
			aria-modal="true"
			aria-label={title}
			class="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-3xl border-t bg-card shadow-2xl shadow-black/50"
			style="padding-bottom: max(1.25rem, env(safe-area-inset-bottom)); {dragging
				? `transform: translateY(${dragY}px); transition: none;`
				: dragY === 0
					? ''
					: ''} {dragging ? '' : 'transition: transform 200ms ease;'}"
		>
			{#if showHandle}
				<div
					role="presentation"
					class="cursor-grab touch-none pt-2.5 pb-1 select-none active:cursor-grabbing"
					style="touch-action: none;"
					onpointerdown={onHandlePointerDown}
					onpointermove={onHandlePointerMove}
					onpointerup={onHandlePointerUp}
					onpointercancel={onHandlePointerUp}
				>
					<div class="mx-auto h-1 w-10 rounded-full bg-border" aria-hidden="true"></div>
				</div>
			{/if}
			<div class="flex items-center justify-between gap-3 px-5 pt-2 pb-1">
				<div class="min-w-0">
					<p class="truncate font-display text-base font-bold tracking-tight">
						{title}
					</p>
					{#if description}
						<p class="truncate text-muted-foreground text-xs">{description}</p>
					{/if}
				</div>
				{#if showClose}
					<button
						type="button"
						bind:this={closeButton}
						onclick={handleClose}
						aria-label="Tutup dialog"
						class="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
					>
						<X class="size-5" aria-hidden="true" />
					</button>
				{/if}
			</div>
			<div class="overflow-y-auto px-3">
				{@render children()}
			</div>
			{#if footer}
				<div class="px-3 pt-2">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.sheet-backdrop {
		animation: sheet-fade 200ms ease;
	}
	div[role="dialog"] {
		animation: sheet-up 240ms cubic-bezier(0.32, 0.72, 0, 1);
	}
	@keyframes sheet-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes sheet-up {
		from {
			transform: translateY(24px);
			opacity: 0.6;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
