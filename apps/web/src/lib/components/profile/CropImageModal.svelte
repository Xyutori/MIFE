<script lang="ts">
interface Props {
	/** Object URL / data URL gambar sumber. */
	src: string;
	/** Rasio lebar:tinggi area crop (1 = persegi avatar, 3 = banner). */
	aspect: number;
	title?: string;
	onConfirm: (blob: Blob) => void;
	onClose: () => void;
}

let {
	src,
	aspect,
	title = "Potong gambar",
	onConfirm,
	onClose,
}: Props = $props();

let dialog = $state<HTMLElement | null>(null);
let stageW = $state(0);
let stageH = $state(0);
let naturalW = $state(0);
let naturalH = $state(0);
let zoom = $state(1);
let offsetX = $state(0);
let offsetY = $state(0);
let dragging = $state(false);
let processing = $state(false);
let error = $state("");
let imageEl = $state<HTMLImageElement | null>(null);

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const OUTPUT_MAX = 1600;

const baseScale = $derived(
	stageW > 0 && stageH > 0 && naturalW > 0 && naturalH > 0
		? Math.max(stageW / naturalW, stageH / naturalH)
		: 0,
);
const scale = $derived(baseScale * zoom);
const imageW = $derived(naturalW * scale);
const imageH = $derived(naturalH * scale);

function clampOffsets(x: number, y: number): { x: number; y: number } {
	if (stageW <= 0 || stageH <= 0) return { x, y };
	const minX = Math.min(0, stageW - imageW);
	const minY = Math.min(0, stageH - imageH);
	return {
		x: Math.min(0, Math.max(minX, x)),
		y: Math.min(0, Math.max(minY, y)),
	};
}

function center() {
	const next = clampOffsets((stageW - imageW) / 2, (stageH - imageH) / 2);
	offsetX = next.x;
	offsetY = next.y;
}

function handleImageLoad(event: Event) {
	const target = event.currentTarget as HTMLImageElement | null;
	naturalW = target?.naturalWidth ?? 0;
	naturalH = target?.naturalHeight ?? 0;
	zoom = 1;
	center();
}

function handleZoomInput(event: Event) {
	const value = Number((event.currentTarget as HTMLInputElement).value);
	if (!Number.isFinite(value)) return;
	zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
	const next = clampOffsets(offsetX, offsetY);
	offsetX = next.x;
	offsetY = next.y;
}

let lastX = 0;
let lastY = 0;

function handlePointerDown(event: PointerEvent) {
	if (processing) return;
	dragging = true;
	lastX = event.clientX;
	lastY = event.clientY;
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function handlePointerMove(event: PointerEvent) {
	if (!dragging || processing) return;
	const next = clampOffsets(
		offsetX + (event.clientX - lastX),
		offsetY + (event.clientY - lastY),
	);
	offsetX = next.x;
	offsetY = next.y;
	lastX = event.clientX;
	lastY = event.clientY;
}

function handlePointerUp() {
	dragging = false;
}

async function handleConfirm() {
	if (!imageEl || processing || scale <= 0) return;
	processing = true;
	error = "";
	try {
		const sourceX = -offsetX / scale;
		const sourceY = -offsetY / scale;
		const sourceW = stageW / scale;
		const sourceH = stageH / scale;
		const longest = Math.max(sourceW, sourceH);
		const downscale = longest > OUTPUT_MAX ? OUTPUT_MAX / longest : 1;
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(sourceW * downscale));
		canvas.height = Math.max(1, Math.round(sourceH * downscale));
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas tidak didukung.");
		context.fillStyle = "#000";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(
			imageEl,
			sourceX,
			sourceY,
			sourceW,
			sourceH,
			0,
			0,
			canvas.width,
			canvas.height,
		);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", 0.92),
		);
		if (!blob) throw new Error("Gambar gagal dipotong.");
		onConfirm(blob);
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "Gambar gagal dipotong.";
	} finally {
		processing = false;
	}
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.stopPropagation();
		onClose();
		return;
	}
	// Fokus-terperangkap sederhana: putar Tab di dalam dialog.
	if (event.key !== "Tab" || !dialog) return;
	const focusable = dialog.querySelectorAll<HTMLElement>(
		'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
	);
	if (focusable.length === 0) return;
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
}

$effect(() => {
	// Fokus awal ke tombol Batal demi aksesibilitas keyboard.
	dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" role="presentation">
	<div
		bind:this={dialog}
		role="dialog"
		aria-modal="true"
		aria-label={title}
		class="w-full max-w-lg rounded-3xl border bg-card p-5 shadow-2xl sm:p-6"
	>
		<h2 class="font-extrabold text-xl">{title}</h2>
		<p class="mt-1 text-muted-foreground text-xs">
			Geser gambar untuk mengatur posisi, gunakan slider untuk zoom.
		</p>

		<div
			bind:clientWidth={stageW}
			bind:clientHeight={stageH}
			class="relative mt-4 w-full touch-none overflow-hidden rounded-2xl border bg-secondary select-none"
			style={`aspect-ratio: ${aspect};`}
		>
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<img
				bind:this={imageEl}
				{src}
				alt="Pratinjau potongan gambar"
				draggable="false"
				onload={handleImageLoad}
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerUp}
				class="absolute top-0 left-0 max-w-none cursor-grab active:cursor-grabbing"
				style={`width: ${imageW}px; height: ${imageH}px; transform: translate(${offsetX}px, ${offsetY}px);`}
			/>
		</div>

		<label class="mt-4 block font-semibold text-sm">
			Zoom
			<input
				type="range"
				min={ZOOM_MIN}
				max={ZOOM_MAX}
				step="0.05"
				value={zoom}
				disabled={processing}
				oninput={handleZoomInput}
				aria-label="Zoom gambar"
				class="mt-2 h-11 w-full accent-primary"
			/>
		</label>

		{#if error}
			<p role="alert" class="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm">
				{error}
			</p>
		{/if}

		<div class="mt-4 flex justify-end gap-2">
			<button
				type="button"
				data-autofocus
				onclick={onClose}
				disabled={processing}
				class="inline-flex min-h-11 items-center rounded-full border px-5 font-semibold text-sm transition hover:bg-accent disabled:opacity-50"
			>
				Batal
			</button>
			<button
				type="button"
				onclick={() => void handleConfirm()}
				disabled={processing || naturalW === 0}
				class="inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-bold text-primary-foreground text-sm transition hover:bg-primary/90 disabled:opacity-50"
			>
				{processing ? "Memproses…" : "Gunakan foto"}
			</button>
		</div>
	</div>
</div>
