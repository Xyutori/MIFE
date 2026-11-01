<script lang="ts" module>
/** Guard sekali-per-id agar navigasi bolak-balik & HMR tidak dobel-fire. */
const recordedChapterViews = new Set<string>();
</script>

<script lang="ts">
import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	BookOpen,
	House,
	List,
	LoaderCircle,
	Pause,
	Play,
	Settings2,
	X,
} from "lucide-svelte";
import { onMount, tick } from "svelte";
import {
	apiBase,
	type ChapterInfo,
	getChapter,
	getChapterBySlug,
	getSeriesChapters,
	type PagePayload,
	pageImageUrl,
	recordView,
} from "#lib/api.ts";
import { markChapterRead } from "#lib/history.ts";
import {
	type LocalFormat,
	readerUrl,
	readReaderPrefs,
	readReadingPosition,
	type ScrollMode,
	saveReaderPrefs,
	saveReadingPosition,
} from "#lib/reader.ts";
import { decodeEntities, formatChapterLabel } from "#lib/text.ts";

interface Props {
	chapterId?: string;
	seriesSlug?: string;
	chapterNumber?: string;
	backHref?: string;
}

let {
	chapterId = "",
	seriesSlug,
	chapterNumber,
	backHref = "/",
}: Props = $props();

let chapter = $state<ChapterInfo | null>(null);
let pages = $state<PagePayload>({ pages: [] });
let source = $state("local");
let availableSources = $state<{ key: string; name: string }[]>([]);
let loading = $state(true);
let error = $state("");
let notice = $state("");
let failedPages = $state<Set<string>>(new Set());
let revealed = $state(0);

let autoNext = $state(false);
let autoScroll = $state(false);
let scrollMode = $state<ScrollMode>("viewport");
let autoScrollSpeed = $state(1);
let localFormat = $state<LocalFormat>("webp");
let prefsReady = $state(false);
let settingsOpen = $state(false);
let chapterMenuOpen = $state(false);
let chapterMenuItems = $state<
	{
		chapter: {
			id: string;
			numberText: string;
			normalizedNumber: string;
			title: string | null;
		};
	}[]
>([]);
let chapterMenuPage = $state(1);
let chapterMenuHasMore = $state(false);
let chapterMenuLoading = $state(false);
let chapterMenuError = $state("");
let chromeHidden = $state(false);
let restored = false;

let controlTap: { x: number; y: number } | null = null;
let hideTimer: number | undefined;
let screenEl: HTMLDivElement | null = $state(null);

/**
 * Layout kini `h-dvh` single-scroll: yang bergulir adalah `<main>`
 * induk milik +layout, BUKAN `window`. `.reader-screen` dirender
 * langsung di dalam `<main>` itu, jadi induk `<main>` pertama dari
 * root komponen adalah scroll container. (Ref root dipakai agar tak
 * salah kena `<main class="reader-main">` di dalam komponen.)
 */
function scrollContainer(): HTMLElement | null {
	let node: HTMLElement | null = screenEl?.parentElement ?? null;
	while (node) {
		if (node.tagName === "MAIN") return node;
		node = node.parentElement;
	}
	return null;
}

function clearHideTimer() {
	if (hideTimer !== undefined) window.clearTimeout(hideTimer);
	hideTimer = undefined;
}

function scheduleHide() {
	clearHideTimer();
	if (settingsOpen || chapterMenuOpen) return;
	hideTimer = window.setTimeout(() => {
		chromeHidden = true;
	}, 3600);
}

function chooseSource(info: ChapterInfo, preferred: string): string {
	if (preferred && info.sources.some((entry) => entry.key === preferred)) {
		return preferred;
	}
	// "local" hanya dipakai bila chapter ini benar-benar menyediakannya;
	// selain itu pakai sumber pertama yang diakui server.
	return info.sources[0]?.key ?? "";
}

type PagesFailure = Error & {
	status?: number;
	code?: string | null;
	available?: string[];
};

/**
 * Ambil halaman chapter tanpa cache agar bentuk error server tetap utuh.
 * Kontrak server: chapter hilang → 404 { error: "Chapter tidak ditemukan" };
 * sumber tak tersedia → 400 { code: "SOURCE_UNAVAILABLE", availableSources, error }.
 */
async function fetchPages(
	chapterId: string,
	sourceKey: string,
	signal?: AbortSignal,
): Promise<PagePayload> {
	const response = await fetch(
		`${apiBase()}/api/v1/chapters/${encodeURIComponent(chapterId)}/pages?source=${encodeURIComponent(sourceKey)}`,
		{ credentials: "include", signal },
	);
	const payload = (await response.json().catch(() => ({}))) as PagePayload & {
		error?: unknown;
		code?: unknown;
		availableSources?: unknown;
	};
	if (response.ok) return payload;
	const failure = new Error(
		typeof payload.error === "string" && payload.error
			? payload.error
			: response.status === 404
				? "Chapter tidak ditemukan."
				: "Halaman chapter gagal dimuat.",
	) as PagesFailure;
	failure.status = response.status;
	failure.code = typeof payload.code === "string" ? payload.code : null;
	const rawSources = Array.isArray(payload.availableSources)
		? payload.availableSources
		: [];
	failure.available = rawSources
		.map((entry) =>
			typeof entry === "string"
				? entry
				: typeof entry === "object" &&
						entry !== null &&
						typeof (entry as { key?: unknown }).key === "string"
					? (entry as { key: string }).key
					: null,
		)
		.filter((key): key is string => key !== null);
	throw failure;
}

function sourceDisplayName(key: string): string {
	return availableSources.find((entry) => entry.key === key)?.name ?? key;
}

async function load(signal: AbortSignal) {
	loading = true;
	error = "";
	notice = "";
	failedPages = new Set();
	revealed = 0;
	restored = false;
	chromeHidden = false;
	try {
		const info =
			seriesSlug && chapterNumber
				? await getChapterBySlug(seriesSlug, chapterNumber, signal)
				: await getChapter(chapterId, signal);
		if (signal.aborted) return;
		chapter = info;
		document.title = `${decodeEntities(info.seriesTitle)} · Chapter ${info.numberText} · MIFE`;
		// Hanya tawarkan sumber yang diakui chapter ini (tanpa "local" bawaan).
		availableSources = info.sources.map((entry) => ({
			key: entry.key,
			name: entry.name,
		}));
		const initial = chooseSource(info, source);
		if (!initial) {
			pages = { pages: [] };
			error = "Chapter ini belum memiliki sumber gambar.";
			return;
		}
		source = initial;
		try {
			const payload = await fetchPages(info.id, source, signal);
			if (signal.aborted) return;
			pages = payload;
		} catch (pagesCause) {
			if (signal.aborted) return;
			const failure = pagesCause as PagesFailure;
			const triedName = sourceDisplayName(source);
			const candidates = (failure.available ?? []).filter((key) =>
				info.sources.some((entry) => entry.key === key),
			);
			const fallbackKey = candidates.find((key) => key !== source) ?? "";
			const isSourceUnavailable =
				failure.code === "SOURCE_UNAVAILABLE" ||
				(failure.status === 400 && candidates.length > 0);
			if (isSourceUnavailable && fallbackKey) {
				// Coba sekali dengan sumber pertama dari daftar server.
				try {
					const retried = await fetchPages(info.id, fallbackKey, signal);
					if (signal.aborted) return;
					const fallbackName =
						info.sources.find((entry) => entry.key === fallbackKey)?.name ??
						fallbackKey;
					source = fallbackKey;
					pages = retried;
					notice = `Sumber "${triedName}" tidak tersedia untuk chapter ini, dialihkan ke "${fallbackName}".`;
					return;
				} catch (retryCause) {
					if (signal.aborted) return;
					const retryFailure = retryCause as PagesFailure;
					error =
						retryFailure.status === 404
							? "Chapter tidak ditemukan."
							: `Sumber "${triedName}" tidak tersedia untuk chapter ini. Sumber pengganti juga gagal dimuat.`;
					return;
				}
			}
			if (failure.status === 404) {
				error = "Chapter tidak ditemukan.";
			} else if (isSourceUnavailable) {
				error = `Sumber "${triedName}" tidak tersedia untuk chapter ini. Pilih sumber lain di pengaturan.`;
			} else {
				error = failure.message || "Halaman chapter gagal dimuat.";
			}
		}
	} catch (cause) {
		if (signal.aborted) return;
		error = cause instanceof Error ? cause.message : "Gagal memuat chapter.";
	} finally {
		if (!signal.aborted) loading = false;
	}
}

// Muat ulang saat identitas chapter berubah.
let loadKey = $derived(`${chapterId}|${seriesSlug}|${chapterNumber}`);
let lastMarkedChapterId: string | null = null;
$effect(() => {
	loadKey;
	const controller = new AbortController();
	void load(controller.signal);
	return () => controller.abort();
});

// Catat history sekali per chapter yang berhasil dimuat.
$effect(() => {
	const id = chapter?.id;
	if (!id || id === lastMarkedChapterId) return;
	const current = chapter;
	if (!current) return;
	lastMarkedChapterId = id;
	markChapterRead(
		"comic",
		current.seriesId,
		{
			id: current.id,
			numberText: current.numberText,
			normalizedNumber: current.normalizedNumber,
			title: current.title,
		},
		{
			slug: current.seriesSlug,
			title: current.seriesTitle,
			href: `/komik/${current.seriesSlug}`,
		},
	);
});

// Counter lokal: catat sekali per chapter, hanya setelah chapter sukses
// dimuat (bukan per halaman/gambar, bukan saat loading/error).
$effect(() => {
	const current = chapter;
	if (!current || loading || error) return;
	const id = current.id;
	if (recordedChapterViews.has(id)) return;
	let already = false;
	try {
		already = sessionStorage.getItem(`symi:view:chapter:${id}`) === "1";
	} catch {
		already = false;
	}
	if (already) {
		recordedChapterViews.add(id);
		return;
	}
	recordedChapterViews.add(id);
	try {
		sessionStorage.setItem(`symi:view:chapter:${id}`, "1");
	} catch {
		// Abaikan.
	}
	void recordView("chapter", id);
});

onMount(() => {
	document.body.dataset.area = "reader";
	const prefs = readReaderPrefs();
	autoNext = prefs.autoNext;
	autoScroll = prefs.autoScroll;
	scrollMode = prefs.scrollMode;
	autoScrollSpeed = prefs.autoScrollSpeed;
	localFormat = prefs.localFormat;
	prefsReady = true;
	return () => {
		delete document.body.dataset.area;
	};
});

$effect(() => {
	if (!prefsReady) return;
	saveReaderPrefs({
		autoNext,
		autoScroll,
		scrollMode,
		autoScrollSpeed,
		localFormat,
	});
});

// Auto scroll loop.
$effect(() => {
	if (!autoScroll) return;
	const scroller = scrollContainer();
	if (!scroller) return;
	let frame = 0;
	const tickScroll = () => {
		scroller.scrollBy(0, autoScrollSpeed * 2);
		frame = requestAnimationFrame(tickScroll);
	};
	frame = requestAnimationFrame(tickScroll);
	return () => cancelAnimationFrame(frame);
});

// Ganti sumber gambar: muat ulang halaman.
async function changeSource(next: string) {
	if (!chapter || next === source) return;
	// Jangan pernah meminta sumber di luar daftar chapter ini.
	if (!availableSources.some((entry) => entry.key === next)) return;
	const previous = source;
	source = next;
	error = "";
	notice = "";
	try {
		pages = await fetchPages(chapter.id, next);
		failedPages = new Set();
		revealed = 0;
	} catch (cause) {
		// Kembalikan pilihan ke sumber yang sedang tampil agar gambar tak basi.
		source = previous;
		const failure = cause as PagesFailure;
		if (failure.code === "SOURCE_UNAVAILABLE" || failure.status === 400) {
			error = `Sumber "${sourceDisplayName(next)}" tidak tersedia untuk chapter ini. Pilih sumber lain.`;
		} else if (failure.status === 404) {
			error = "Chapter tidak ditemukan.";
		} else {
			error = failure.message || "Sumber gambar gagal dimuat.";
		}
	}
}

// Ganti format lokal: cukup recompute URL (tanpa fetch ulang).
$effect(() => {
	localFormat;
	failedPages = new Set();
});

// Auto-hide ala XyMI: ketuk layar untuk toggle, sembunyi setelah 3,6 dtk.
$effect(() => {
	const onPointerDown = (event: PointerEvent) => {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest("[data-reader-controls]")) {
			controlTap = null;
			if (!chromeHidden) scheduleHide();
			return;
		}
		controlTap =
			target?.closest(".reader-screen") &&
			!target.closest("[data-reader-controls], .reader-sheet-backdrop")
				? { x: event.clientX, y: event.clientY }
				: null;
	};
	const onPointerUp = (event: PointerEvent) => {
		const start = controlTap;
		controlTap = null;
		const target = event.target instanceof Element ? event.target : null;
		if (
			!start ||
			!target?.closest(".reader-screen") ||
			target.closest("[data-reader-controls], .reader-sheet-backdrop") ||
			Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10 ||
			settingsOpen ||
			chapterMenuOpen
		) {
			return;
		}
		if (!chromeHidden) clearHideTimer();
		else scheduleHide();
		chromeHidden = !chromeHidden;
	};
	const onPointerCancel = () => {
		controlTap = null;
	};
	document.addEventListener("pointerdown", onPointerDown);
	document.addEventListener("pointerup", onPointerUp);
	document.addEventListener("pointercancel", onPointerCancel);
	return () => {
		document.removeEventListener("pointerdown", onPointerDown);
		document.removeEventListener("pointerup", onPointerUp);
		document.removeEventListener("pointercancel", onPointerCancel);
	};
});

$effect(() => {
	if (!settingsOpen && !chapterMenuOpen && !chromeHidden && chapter)
		scheduleHide();
	else if (settingsOpen || chapterMenuOpen) clearHideTimer();
});

// Simpan posisi baca (throttle via rAF sederhana).
let saveQueued = false;
function queueSavePosition() {
	if (!chapter || saveQueued) return;
	saveQueued = true;
	requestAnimationFrame(() => {
		saveQueued = false;
		if (chapter)
			saveReadingPosition(chapter.id, scrollContainer()?.scrollTop ?? 0);
	});
}

$effect(() => {
	if (!chapter) return;
	const scroller = scrollContainer();
	if (!scroller) return;
	const onScroll = () => queueSavePosition();
	scroller.addEventListener("scroll", onScroll, { passive: true });
	return () => scroller.removeEventListener("scroll", onScroll);
});

// Pulihkan posisi tersimpan sekali setelah halaman siap.
$effect(() => {
	if (!chapter || loading || restored || pages.pages.length === 0) return;
	restored = true;
	const saved = readReadingPosition(chapter.id);
	if (saved > 0) {
		const scroller = scrollContainer();
		void tick().then(() => scroller?.scrollTo({ top: saved }));
	}
});

async function openChapterMenu() {
	chapterMenuOpen = true;
	if (!chapter || chapterMenuItems.length > 0 || chapterMenuLoading) return;
	chapterMenuLoading = true;
	chapterMenuError = "";
	try {
		const payload = await getSeriesChapters(chapter.seriesId, {
			page: 1,
			pageSize: 30,
			sort: "recent",
		});
		chapterMenuItems = payload.items.map((entry) => ({
			chapter: {
				id: entry.chapter.id,
				numberText: entry.chapter.numberText,
				normalizedNumber: entry.chapter.normalizedNumber,
				title: entry.chapter.title,
			},
		}));
		chapterMenuHasMore = payload.hasMore;
		chapterMenuPage = 1;
	} catch (cause) {
		chapterMenuError =
			cause instanceof Error ? cause.message : "Daftar chapter gagal dimuat.";
	} finally {
		chapterMenuLoading = false;
	}
}

async function loadMoreMenuChapters() {
	if (!chapter || chapterMenuLoading || !chapterMenuHasMore) return;
	chapterMenuLoading = true;
	chapterMenuError = "";
	try {
		const nextPage = chapterMenuPage + 1;
		const payload = await getSeriesChapters(chapter.seriesId, {
			page: nextPage,
			pageSize: 30,
			sort: "recent",
		});
		chapterMenuItems = [
			...chapterMenuItems,
			...payload.items.map((entry) => ({
				chapter: {
					id: entry.chapter.id,
					numberText: entry.chapter.numberText,
					normalizedNumber: entry.chapter.normalizedNumber,
					title: entry.chapter.title,
				},
			})),
		];
		chapterMenuPage = nextPage;
		chapterMenuHasMore = payload.hasMore;
	} catch (cause) {
		chapterMenuError =
			cause instanceof Error ? cause.message : "Chapter lama gagal dimuat.";
	} finally {
		chapterMenuLoading = false;
	}
}

const pageCount = $derived(pages.pages.length);
const prevHref = $derived(
	chapter?.previousChapterNumber
		? readerUrl(chapter.seriesSlug, chapter.previousChapterNumber)
		: null,
);
const nextHref = $derived(
	chapter?.nextChapterNumber
		? readerUrl(chapter.seriesSlug, chapter.nextChapterNumber)
		: null,
);

function imgSrc(page: { url: string; local: boolean; id: string }): string {
	const found = pages.pages.find((p) => p.id === page.id);
	if (!found || !chapter) return "";
	return pageImageUrl(found, source, localFormat);
}

function retryPage(id: string) {
	failedPages = new Set([...failedPages].filter((key) => key !== id));
}

function scrollReader(direction: -1 | 1) {
	if (scrollMode === "chapter") {
		const section = document.querySelector("[data-reader-chapter]");
		if (section) {
			section.scrollIntoView({
				behavior: "smooth",
				block: direction < 0 ? "start" : "end",
			});
			return;
		}
	}
	const scroller = scrollContainer();
	const viewport = scroller?.clientHeight ?? window.innerHeight;
	const delta = {
		top: direction * viewport * 0.78,
		behavior: "smooth" as const,
	};
	if (scroller) scroller.scrollBy(delta);
	else window.scrollBy(delta);
}
</script>

<div
	bind:this={screenEl}
	class={chromeHidden ? "reader-screen reader-controls-hidden" : "reader-screen"}
	onwheel={() => {
		chromeHidden = true;
	}}
	ontouchmove={() => {
		chromeHidden = true;
	}}
>
	<header class="reader-toolbar" data-reader-controls aria-busy={loading}>
		<div class="reader-toolbar-inner">
			{#if chapter}
				<div class="reader-heading">
					<a
						class="reader-title reader-title-link truncate"
						href={`/komik/${chapter.seriesSlug}`}
					>
						{decodeEntities(chapter.seriesTitle)}
					</a>
					<p class="reader-title-subtitle truncate">
						{formatChapterLabel(chapter.numberText, chapter.title)}
					</p>
				</div>
			{:else if loading}
				<div class="reader-heading reader-skeleton-heading" aria-hidden="true">
					<div class="reader-skeleton-title animate-pulse"></div>
					<div class="reader-skeleton-subtitle animate-pulse"></div>
				</div>
			{:else}
				<div class="reader-heading">
					<span class="reader-title">Chapter tidak tersedia</span>
				</div>
			{/if}
		</div>
	</header>

	<main class="reader-main" aria-label="Halaman chapter">
		{#if error}
			<div class="reader-message" role="alert">
				<p class="font-semibold">Gagal memuat</p>
				<p class="mt-1 text-sm opacity-70">{error}</p>
			</div>
		{/if}
		{#if notice}
			<div class="reader-message" role="status">
				<p class="mt-1 text-sm opacity-70">{notice}</p>
			</div>
		{/if}

		{#if loading}
			<div class="reader-skeleton" aria-busy="true">
				<div class="reader-pages reader-skeleton-pages" aria-hidden="true">
					{#each [0, 1, 2] as i (i)}
						<div class="reader-skeleton-page animate-pulse"></div>
					{/each}
				</div>
				<span class="sr-only" role="status">Memuat chapter</span>
			</div>
		{:else if pageCount === 0 && !error}
			<div class="reader-message reader-message-centered">
				<BookOpen class="size-7 text-muted-foreground" />
				<p>Halaman chapter belum tersedia</p>
			</div>
		{:else}
			<div class="reader-pages">
				<section data-reader-chapter={chapter?.id ?? ""} aria-label={chapter ? `Chapter ${chapter.numberText}` : "Chapter"}>
					{#each pages.pages as page, i (page.id)}
						{@const failed = failedPages.has(page.id)}
						{@const pending = i >= revealed}
						<figure class={`reader-page${pending ? " reader-page-pending" : ""}`}>
							{#if pending && !failed}
								<div class="reader-page-loading-skeleton" aria-hidden="true"></div>
							{/if}
							{#if !failed && i <= revealed}
								<img
									src={imgSrc(page)}
									alt={`${decodeEntities(chapter?.seriesTitle ?? "")} chapter ${chapter?.numberText ?? ""} halaman ${i + 1}`}
									loading={i === 0 ? "eager" : "lazy"}
									draggable={false}
									class={revealed > i ? "reader-page-image" : "reader-page-image is-pending"}
									onload={() => {
										revealed = Math.max(revealed, i + 1);
									}}
									onerror={() => {
										failedPages = new Set([...failedPages, page.id]);
									}}
								/>
							{/if}
							{#if failed}
								<div class="reader-page-error" role="alert">
									<span>
										Gambar halaman {i + 1} gagal dimuat
										<button
											type="button"
											class="ml-2 underline"
											data-reader-controls
											onclick={() => retryPage(page.id)}
										>
											Coba lagi
										</button>
									</span>
								</div>
							{/if}
						</figure>
					{/each}
				</section>
			</div>
		{/if}

		{#if chapter && nextHref && autoNext && revealed >= pageCount && pageCount > 0}
			<a
				href={nextHref}
				class="mx-auto mt-6 flex min-h-12 w-[min(calc(100%-2rem),42rem)] items-center justify-center gap-2 rounded-full bg-primary font-bold text-primary-foreground text-sm"
			>
				Chapter berikutnya
				<ArrowRight class="size-4" />
			</a>
		{/if}
	</main>

	<nav class="reader-dock" aria-label="Kontrol membaca" data-reader-controls>
		{#if prevHref}
			<a
				href={prevHref}
				class="reader-icon-action"
				aria-label="Chapter sebelumnya"
				title="Chapter sebelumnya"
				data-tooltip="Chapter sebelumnya"
			>
				<ArrowLeft />
			</a>
		{:else}
			<a
				href={chapter ? `/komik/${chapter.seriesSlug}` : backHref}
				class="reader-icon-action"
				aria-label="Kembali ke detail"
				title="Kembali ke detail"
				data-tooltip="Detail"
			>
				<House />
			</a>
		{/if}
		<button
			type="button"
			class="reader-icon-action"
			aria-label="Pengaturan membaca"
			title="Pengaturan membaca"
			data-tooltip="Pengaturan"
			disabled={!chapter}
			onclick={() => (settingsOpen = true)}
		>
			<Settings2 />
		</button>
		<button
			type="button"
			class={autoScroll ? "reader-icon-action is-active" : "reader-icon-action"}
			aria-label={autoScroll ? "Hentikan auto scroll" : "Mulai auto scroll"}
			title={autoScroll ? "Hentikan auto scroll" : "Mulai auto scroll"}
			data-tooltip={autoScroll ? "Jeda scroll" : "Auto scroll"}
			aria-pressed={autoScroll}
			onclick={() => (autoScroll = !autoScroll)}
		>
			{#if autoScroll}
				<Pause />
			{:else}
				<Play />
			{/if}
		</button>
		<button
			type="button"
			class="reader-icon-action"
			aria-label="Pilih chapter"
			title="Pilih chapter"
			data-tooltip="Daftar chapter"
			disabled={!chapter}
			onclick={() => void openChapterMenu()}
		>
			<List />
		</button>
		{#if nextHref}
			<a
				href={nextHref}
				class="reader-icon-action"
				aria-label="Chapter berikutnya"
				title="Chapter berikutnya"
				data-tooltip="Chapter berikutnya"
			>
				<ArrowRight />
			</a>
		{:else}
			<a
				href={chapter ? `/komik/${chapter.seriesSlug}` : backHref}
				class="reader-icon-action"
				aria-label="Kembali ke detail"
				title="Kembali ke detail"
				data-tooltip="Detail"
			>
				<House />
			</a>
		{/if}
	</nav>

	<nav class="reader-scroll-controls" aria-label="Navigasi halaman" data-reader-controls>
		<button
			type="button"
			onclick={() => scrollReader(-1)}
			aria-label={scrollMode === "chapter" ? "Ke awal chapter" : "Gulir ke atas"}
			title={scrollMode === "chapter" ? "Ke awal chapter" : "Gulir ke atas"}
		>
			<ArrowUp />
		</button>
		<button
			type="button"
			onclick={() => scrollReader(1)}
			aria-label={scrollMode === "chapter" ? "Ke akhir chapter" : "Gulir ke bawah"}
			title={scrollMode === "chapter" ? "Ke akhir chapter" : "Gulir ke bawah"}
		>
			<ArrowDown />
		</button>
	</nav>

	{#if settingsOpen && chapter}
		<div class="reader-sheet-backdrop">
			<button
				type="button"
				class="reader-sheet-backdrop-dismiss"
				aria-hidden="true"
				tabindex={-1}
				onclick={() => (settingsOpen = false)}
			></button>
			<section
				class="reader-sheet"
				role="dialog"
				aria-modal="true"
				aria-labelledby="reader-settings-title"
			>
				<div class="mb-5 flex items-center justify-between gap-4">
					<h2 id="reader-settings-title" class="font-display font-bold text-lg">
						Pengaturan baca
					</h2>
					<button
						type="button"
						class="reader-icon-action"
						onclick={() => (settingsOpen = false)}
						aria-label="Tutup pengaturan"
					>
						<X />
					</button>
				</div>
				<label class="mb-5 block font-semibold text-sm">
					<span class="mb-2 block">Sumber gambar</span>
					<select
						class="reader-setting-control"
						value={source}
						onchange={(event) => void changeSource(event.currentTarget.value)}
					>
						{#each availableSources as option (option.key)}
							<option value={option.key}>{option.name}</option>
						{/each}
					</select>
				</label>
				{#if source === "local" && pages.pages.some((page) => page.local)}
					<label class="mb-5 block font-semibold text-sm">
						<span class="mb-2 block">Format gambar</span>
						<select
							class="reader-setting-control"
							value={localFormat}
							onchange={(event) =>
								(localFormat = event.currentTarget.value as LocalFormat)}
						>
							<option value="webp">WebP · lebih ringan</option>
							<option value="original">Asli</option>
						</select>
					</label>
				{/if}
				<label class="mb-5 block font-semibold text-sm">
					<span class="mb-1 flex items-center justify-between">
						<span>Kecepatan auto scroll</span>
						<span class="text-muted-foreground">{autoScrollSpeed.toFixed(1)}×</span>
					</span>
					<input
						class="w-full accent-primary"
						type="range"
						min="0.5"
						max="3"
						step="0.5"
						bind:value={autoScrollSpeed}
					/>
				</label>
				<label class="mb-5 block font-semibold text-sm">
					<span class="mb-2 block">Aksi tombol atas/bawah</span>
					<select
						class="reader-setting-control"
						value={scrollMode}
						onchange={(event) =>
							(scrollMode = event.currentTarget.value as ScrollMode)}
					>
						<option value="viewport">Gulir per layar</option>
						<option value="chapter">Awal / akhir chapter</option>
					</select>
				</label>
				<div class="flex min-h-12 items-center justify-between gap-4 border-white/10 border-t pt-4 font-semibold text-sm">
					<span>Auto next chapter</span>
					<button
						type="button"
						role="switch"
						aria-checked={autoNext}
						class="reader-toggle"
						onclick={() => (autoNext = !autoNext)}
						aria-label="Toggle auto next chapter"
					></button>
				</div>
			</section>
		</div>
	{/if}

	{#if chapterMenuOpen && chapter}
		<div class="reader-sheet-backdrop">
			<button
				type="button"
				class="reader-sheet-backdrop-dismiss"
				aria-hidden="true"
				tabindex={-1}
				onclick={() => (chapterMenuOpen = false)}
			></button>
			<section
				class="reader-sheet"
				role="dialog"
				aria-modal="true"
				aria-labelledby="reader-chapters-title"
			>
				<div class="mb-4 flex items-center justify-between gap-4">
					<h2 id="reader-chapters-title" class="font-display font-bold text-lg">
						Pilih chapter
					</h2>
					<button
						type="button"
						class="reader-icon-action"
						onclick={() => (chapterMenuOpen = false)}
						aria-label="Tutup daftar chapter"
					>
						<X />
					</button>
				</div>
				{#if chapterMenuError}
					<p class="mb-3 text-destructive text-sm" role="alert">{chapterMenuError}</p>
				{/if}
				{#if chapterMenuLoading && chapterMenuItems.length === 0}
					<div class="flex min-h-32 items-center justify-center">
						<LoaderCircle class="size-5 animate-spin text-primary" />
					</div>
				{:else}
					<div class="reader-chapter-list">
						{#each chapterMenuItems as { chapter: item } (item.id)}
							<a
								href={readerUrl(chapter.seriesSlug, item.normalizedNumber)}
								aria-current={item.id === chapter.id ? "page" : undefined}
								class="reader-menu-row"
								onclick={() => (chapterMenuOpen = false)}
							>
								<span class="truncate">
									{formatChapterLabel(item.numberText, item.title)}
								</span>
								{#if item.id === chapter.id}
									<span class="font-bold text-xs">Dibaca</span>
								{/if}
							</a>
						{/each}
						{#if chapterMenuItems.length === 0 && !chapterMenuLoading}
							<p class="py-8 text-center text-muted-foreground text-sm">
								Daftar chapter belum tersedia.
							</p>
						{/if}
					</div>
				{/if}
				{#if chapterMenuHasMore}
					<button
						type="button"
						disabled={chapterMenuLoading}
						onclick={() => void loadMoreMenuChapters()}
						class="mt-3 min-h-11 w-full rounded-full bg-white/5 font-semibold text-sm disabled:opacity-50"
					>
						{chapterMenuLoading ? "Memuat chapter…" : "Muat chapter lama"}
					</button>
				{/if}
			</section>
		</div>
	{/if}
</div>
