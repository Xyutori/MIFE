<script lang="ts">
import {
	ArrowRight,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
} from "lucide-svelte";
import { tick } from "svelte";

interface Props {
	page: number;
	pageCount: number;
	loading?: boolean;
	/**
	 * Deprecated: tidak lagi dirender. Label pagination kini generik
	 * ("halaman") agar netral untuk semua entitas. Properti ini tetap ada
	 * supaya pemanggil lama (`label="komik"`, `label="anime"`, …) tidak breaking.
	 */
	label?: string;
	onChange: (page: number) => void;
}

let { page, pageCount, loading = false, onChange }: Props = $props();

let pickerOpen = $state(false);
let jumpValue = $state("");
// ID stabil per instance untuk asosiasi label/input picker.
let pickerId = $state(`page-picker-${Math.random().toString(36).slice(2)}`);
let triggerEl: HTMLButtonElement | null = $state(null);
let listEl: HTMLUListElement | null = $state(null);
let inputEl: HTMLInputElement | null = $state(null);

// Opsi list dropdown: semua halaman, posisi scroll mengikuti halaman aktif.
const pickerPages = $derived.by(() => {
	return Array.from({ length: pageCount }, (_, index) => index + 1);
});

// Halaman yang disorot (hover/keyboard) di dalam list.
let activePage = $state(1);

function clampPage(value: number): number {
	if (!Number.isFinite(value)) return page;
	return Math.min(pageCount, Math.max(1, Math.trunc(value)));
}

// Sinkronkan input dengan halaman aktif bila `page` berubah dari luar
// (mis. reset filter) saat picker terbuka.
$effect(() => {
	if (pickerOpen) jumpValue = String(clampPage(page));
});

// Jaga opsi aktif tetap terlihat di dalam list saat navigasi keyboard.
$effect(() => {
	if (!pickerOpen) return;
	activePage;
	listEl
		?.querySelector('[data-active="true"]')
		?.scrollIntoView({ block: "nearest" });
});

function go(next: number) {
	// Cegah double-fetch: abaikan klik ganda / spam Enter saat masih loading
	// maupun target yang sama dengan halaman aktif (tidak ada fetch baru).
	if (loading) return;
	const target = clampPage(next);
	const fromPicker = pickerOpen;
	pickerOpen = false;
	if (target === page) {
		jumpValue = String(page);
		return;
	}
	jumpValue = String(target);
	// Kembalikan fokus ke trigger tanpa menggeser scroll halaman —
	// hanya bila pilihan berasal dari picker (hindari focus-jump dari
	// tombol bernomor).
	if (fromPicker) triggerEl?.focus({ preventScroll: true });
	onChange(target);
}

async function openPicker() {
	if (loading) return;
	jumpValue = String(clampPage(page));
	activePage = clampPage(page);
	pickerOpen = true;
	await tick();
	// Posisikan list pada halaman saat ini, lalu fokus ke opsinya agar
	// navigasi keyboard langsung jalan tanpa menggeser scroll halaman.
	const active = listEl?.querySelector<HTMLElement>('[data-active="true"]');
	active?.scrollIntoView({ block: "center" });
	if (active) active.focus({ preventScroll: true });
	else {
		inputEl?.focus({ preventScroll: true });
		inputEl?.select();
	}
}

function closePicker(focusTrigger = false) {
	pickerOpen = false;
	if (focusTrigger) triggerEl?.focus({ preventScroll: true });
}

function togglePicker() {
	if (pickerOpen) closePicker();
	else void openPicker();
}

/** Tolak non-digit: saring tempel/IME/autofill yang lolos keydown. */
function sanitizeJump(event: Event) {
	const el = event.currentTarget as HTMLInputElement | null;
	const digitsOnly = (el?.value ?? "").replace(/[^0-9]/g, "");
	if (el && el.value !== digitsOnly) el.value = digitsOnly;
	jumpValue = digitsOnly;
}

/** Cegah karakter non-digit sejak keydown (membantu keyboard fisik). */
function onJumpKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		closePicker(true);
		return;
	}
	if (event.key.length !== 1) return;
	if (!/[0-9]/.test(event.key)) event.preventDefault();
}

function submitJump(event: SubmitEvent) {
	event.preventDefault();
	const parsed = Number.parseInt(jumpValue, 10);
	if (!Number.isFinite(parsed)) return;
	go(parsed);
}

function onTriggerKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") {
		closePicker();
		return;
	}
	if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
	event.preventDefault();
	void openPicker();
}

function moveActive(delta: number) {
	const index = pickerPages.indexOf(activePage);
	const base = index < 0 ? pickerPages.indexOf(clampPage(page)) : index;
	const next =
		pickerPages[Math.min(pickerPages.length - 1, Math.max(0, base + delta))];
	if (next !== undefined) activePage = next;
}

/** Navigasi keyboard di dalam dropdown (di luar input lompat). */
function onDialogKeydown(event: KeyboardEvent) {
	if (event.target instanceof HTMLInputElement) {
		if (event.key === "Escape") {
			event.preventDefault();
			closePicker(true);
		}
		return;
	}
	switch (event.key) {
		case "Escape":
			event.preventDefault();
			closePicker(true);
			break;
		case "ArrowDown":
			event.preventDefault();
			if (!pickerOpen) void openPicker();
			else moveActive(1);
			break;
		case "ArrowUp":
			event.preventDefault();
			if (!pickerOpen) void openPicker();
			else moveActive(-1);
			break;
		case "Home":
			event.preventDefault();
			if (pickerPages[0] !== undefined) activePage = pickerPages[0];
			break;
		case "End":
			event.preventDefault();
			if (pickerPages[pickerPages.length - 1] !== undefined)
				activePage = pickerPages[pickerPages.length - 1];
			break;
		case "Enter":
			event.preventDefault();
			go(activePage);
			break;
	}
}

const edgeButton =
	"grid size-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground disabled:opacity-40 hover:bg-accent hover:text-foreground";
</script>

{#snippet pagePicker()}
	<div class="relative shrink-0">
		<button
			type="button"
			bind:this={triggerEl}
			onclick={togglePicker}
			onkeydown={onTriggerKeydown}
			disabled={loading}
			aria-haspopup="dialog"
			aria-expanded={pickerOpen}
			aria-controls={pickerOpen ? `${pickerId}-dialog` : undefined}
			aria-label={`Pilih halaman, saat ini ${page} dari ${pageCount}`}
			title="Pilih halaman"
			class="flex h-9 max-w-40 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm disabled:opacity-40"
		>
			<span class="truncate font-semibold text-foreground">{page}</span>
			<span aria-hidden="true" class="shrink-0 text-muted-foreground">/</span>
			<span aria-hidden="true" class="shrink-0 truncate text-muted-foreground"
				>{pageCount}</span
			>
			<ChevronDown
				aria-hidden="true"
				class={`size-3.5 shrink-0 text-muted-foreground transition-transform ${pickerOpen ? "rotate-180" : ""}`}
			/>
		</button>
		{#if pickerOpen}
			<button
				type="button"
				tabindex={-1}
				aria-hidden="true"
				onclick={() => closePicker()}
				class="fixed inset-0 z-40 cursor-default bg-transparent"
			></button>
			<div
				id={`${pickerId}-dialog`}
				role="dialog"
				tabindex={-1}
				aria-label="Pilih halaman"
				onkeydown={onDialogKeydown}
				class="absolute bottom-full left-1/2 z-50 mb-2 w-56 max-w-[14rem] -translate-x-1/2 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-xl"
			>
				<ul
					role="listbox"
					aria-label="Daftar halaman"
					bind:this={listEl}
					class="max-h-60 overflow-y-auto rounded-lg"
				>
					{#each pickerPages as option (option)}
						<li>
							<button
								type="button"
								role="option"
								aria-selected={option === page}
								data-active={activePage === option}
								onclick={() => go(option)}
								onmouseenter={() => (activePage = option)}
								onfocus={() => (activePage = option)}
								class={`flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-sm font-semibold ${option === page ? "bg-primary text-primary-foreground" : activePage === option ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
							>
								<span>Halaman {option}</span>
								{#if option === page}
									<span aria-hidden="true">●</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
				<form onsubmit={submitJump} class="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
					<label for={`${pickerId}-input`} class="sr-only">Ke halaman…</label>
					<input
						id={`${pickerId}-input`}
						bind:this={inputEl}
						bind:value={jumpValue}
						oninput={sanitizeJump}
						onkeydown={onJumpKeydown}
						type="text"
						inputmode="numeric"
						pattern="[0-9]*"
						enterkeyhint="go"
						maxlength={String(pageCount).length}
						placeholder="Nomor halaman"
						autocomplete="off"
						class="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 text-sm outline-none focus:border-primary"
					/>
					<button
						type="submit"
						aria-label={jumpValue
							? `Ke halaman ${jumpValue}`
							: "Ke halaman yang dimasukkan"}
						title="Ke halaman"
						class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground hover:opacity-90"
					>
						<ArrowRight class="size-4" aria-hidden="true" />
					</button>
				</form>
			</div>
		{/if}
	</div>
{/snippet}

{#if pageCount > 1}
	<nav aria-label="Navigasi halaman" class="mt-8">
		<!-- Ringkas di semua ukuran: prev + picker lompat halaman + next. -->
		<div class="flex items-center justify-center gap-2">
			<button
				type="button"
				disabled={page <= 1 || loading}
				onclick={() => go(page - 1)}
				class={edgeButton}
				aria-label="Halaman sebelumnya"
				title="Halaman sebelumnya"
			>
				<ChevronLeft class="size-4" aria-hidden="true" />
			</button>
			{@render pagePicker()}
			<button
				type="button"
				disabled={page >= pageCount || loading}
				onclick={() => go(page + 1)}
				class={edgeButton}
				aria-label="Halaman berikutnya"
				title="Halaman berikutnya"
			>
				<ChevronRight class="size-4" aria-hidden="true" />
			</button>
		</div>
	</nav>
{/if}
