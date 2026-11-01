<script lang="ts">
import Icon from "./Icon.svelte";

export interface ChapterReport {
	reason: string;
	details: string;
}

interface Props {
	prevHref: string | null;
	nextHref: string | null;
	seriesHref: string;
	onReport?: (report: ChapterReport) => void;
}

let { prevHref, nextHref, seriesHref, onReport }: Props = $props();

let dialogRef: HTMLDialogElement | null = $state(null);
let reason = $state("");
let details = $state("");

const reasons = [
	"Gambar tidak tampil / rusak",
	"Urutan halaman salah",
	"Terjemahan bermasalah",
	"Chapter salah / tertukar",
	"Lainnya",
];

function openReport(): void {
	reason = "";
	details = "";
	dialogRef?.showModal();
}

function closeReport(): void {
	dialogRef?.close();
}

function submitReport(): void {
	if (!reason) return;
	onReport?.({ reason, details: details.trim() });
	closeReport();
}

const navButton =
	"flex flex-1 items-center justify-center gap-2 rounded-[6px] px-4 py-2.5 text-sm font-semibold transition-opacity";
</script>

<nav
	aria-label="Navigasi chapter"
	class="sticky bottom-0 z-40 flex items-center gap-2 border-t border-white/10 bg-[#1A1A1A]/95 px-4 py-3 backdrop-blur"
>
	{#if prevHref}
		<a href={prevHref} class={`${navButton} bg-[#242424] text-white hover:opacity-80`}>
			<Icon name="arrow-left" size={16} />
			<span class="hidden sm:inline">Prev</span>
		</a>
	{:else}
		<span
			aria-disabled="true"
			class={`${navButton} cursor-not-allowed bg-[#242424] text-neutral-600 opacity-50`}
		>
			<Icon name="arrow-left" size={16} />
			<span class="hidden sm:inline">Prev</span>
		</span>
	{/if}

	<a
		href={seriesHref}
		aria-label="Kembali ke daftar chapter"
		class={`${navButton} bg-[#242424] text-white hover:opacity-80`}
	>
		<Icon name="list" size={16} />
		<span class="hidden sm:inline">Series</span>
	</a>

	{#if nextHref}
		<a href={nextHref} class={`${navButton} bg-[#E01B41] text-white hover:opacity-90`}>
			<span class="hidden sm:inline">Next</span>
			<Icon name="arrow-right" size={16} />
		</a>
	{:else}
		<span
			aria-disabled="true"
			class={`${navButton} cursor-not-allowed bg-[#242424] text-neutral-600 opacity-50`}
		>
			<span class="hidden sm:inline">Next</span>
			<Icon name="arrow-right" size={16} />
		</span>
	{/if}

	<button
		type="button"
		onclick={openReport}
		class="flex items-center justify-center gap-2 rounded-[6px] border border-[#E01B41] px-3 py-2.5 text-sm font-semibold text-[#E01B41] transition-colors hover:bg-[#E01B41] hover:text-white"
	>
		<Icon name="flag" size={16} />
		<span class="hidden sm:inline">Lapor</span>
	</button>
</nav>

<dialog
	bind:this={dialogRef}
	aria-label="Laporkan chapter"
	class="m-auto w-[min(92vw,420px)] rounded-[16px] border border-white/10 bg-[#1A1A1A] p-0 text-white backdrop:bg-black/70"
>
	<div class="flex flex-col gap-4 p-5">
		<div class="flex items-center justify-between">
			<h3 class="text-base font-semibold">Report Chapter</h3>
			<button
				type="button"
				onclick={closeReport}
				aria-label="Tutup dialog"
				class="flex h-8 w-8 items-center justify-center rounded-[6px] text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
			>
				<Icon name="x" size={18} />
			</button>
		</div>

		<label class="flex flex-col gap-1.5 text-sm">
			<span class="font-medium text-neutral-300">Alasan</span>
			<select
				bind:value={reason}
				class="rounded-[8px] border border-white/10 bg-[#242424] px-3 py-2 text-sm text-white focus:border-[#E01B41] focus:outline-none"
			>
				<option value="" disabled>Pilih alasan...</option>
				{#each reasons as item (item)}
					<option value={item}>{item}</option>
				{/each}
			</select>
		</label>

		<label class="flex flex-col gap-1.5 text-sm">
			<span class="font-medium text-neutral-300">Detail (opsional)</span>
			<textarea
				rows="3"
				bind:value={details}
				placeholder="Jelaskan masalahnya..."
				class="w-full resize-y rounded-[8px] border border-white/10 bg-[#242424] px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#E01B41] focus:outline-none"
			></textarea>
		</label>

		<div class="flex justify-end gap-2">
			<button
				type="button"
				onclick={closeReport}
				class="rounded-[6px] px-4 py-2 text-sm text-neutral-400 transition-colors hover:text-white"
			>
				Batal
			</button>
			<button
				type="button"
				onclick={submitReport}
				disabled={!reason}
				class="rounded-[6px] bg-[#E01B41] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
			>
				Kirim Laporan
			</button>
		</div>
	</div>
</dialog>
