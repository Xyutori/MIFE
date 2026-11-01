<script lang="ts">
	import {
		ArrowDown,
		ArrowLeft,
		ArrowRight,
		ArrowUp,
		BookOpen,
		House,
	} from "lucide-svelte";
	import { onMount } from "svelte";
	import {
		getSuperKomikChapter,
		type SuperKomikReaderPayload,
	} from "#lib/super-komik.ts";
	import { decodeEntities } from "#lib/text.ts";
	import type { PageProps } from "./$types";

	let { data: routeData }: PageProps = $props();
	const chapterId = $derived(routeData.params.chapterId);

	let payload = $state<SuperKomikReaderPayload | null>(null);
	let error = $state("");
	let failedImages = $state<Set<string>>(new Set());
	let chromeHidden = $state(false);

	let controlTap: { x: number; y: number } | null = null;
	let hideTimer: number | undefined = undefined;
	let screenEl: HTMLDivElement | null = $state(null);

	/**
	 * Layout kini `h-dvh` single-scroll: yang bergulir adalah `<main>`
	 * induk milik +layout, BUKAN `window`. `.reader-screen` dirender
	 * langsung di dalam `<main>` itu, jadi induk `<main>` pertama dari
	 * root adalah scroll container.
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
		hideTimer = window.setTimeout(() => {
			chromeHidden = true;
		}, 3600);
	}

	onMount(() => {
		document.body.dataset.area = "reader";
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest("[data-reader-controls]")) {
				controlTap = null;
				if (!chromeHidden) scheduleHide();
				return;
			}
			controlTap =
				target?.closest(".reader-screen") &&
				!target.closest("[data-reader-controls]")
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
				target.closest("[data-reader-controls]") ||
				Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
			) {
				return;
			}
			if (!chromeHidden) clearHideTimer();
			else scheduleHide();
			chromeHidden = !chromeHidden;
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("pointerup", onPointerUp);
		scheduleHide();
		return () => {
			delete document.body.dataset.area;
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("pointerup", onPointerUp);
			clearHideTimer();
		};
	});

	$effect(() => {
		const id = chapterId;
		let active = true;
		const controller = new AbortController();
		payload = null;
		error = "";
		failedImages = new Set();
		chromeHidden = false;
		scheduleHide();
		void getSuperKomikChapter(id, controller.signal)
			.then((data) => {
				if (active) payload = data;
			})
			.catch((cause: unknown) => {
				if (!active) return;
				if (cause instanceof DOMException && cause.name === "AbortError") return;
				error = cause instanceof Error ? cause.message : "Chapter gagal dimuat.";
			});
		return () => {
			active = false;
			controller.abort();
		};
	});

	function retryImage(id: string) {
		failedImages = new Set([...failedImages].filter((key) => key !== id));
	}

	function scrollPage(direction: -1 | 1) {
		const scroller = scrollContainer();
		const viewport = scroller?.clientHeight ?? window.innerHeight;
		const delta = { top: direction * viewport * 0.78, behavior: "smooth" as const };
		if (scroller) scroller.scrollBy(delta);
		else window.scrollBy(delta);
	}
</script>

<svelte:head>
	<title>
		{payload
			? `${decodeEntities(payload.series.title)} · Chapter ${payload.chapter.numberText} · MIFE`
			: "Baca Super Komik · MIFE"}
	</title>
</svelte:head>

{#if error}
	<main class="mx-auto min-h-[70vh] max-w-5xl px-4 py-8">
		<a href="/super-komik" class="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
			<ArrowLeft class="size-4" />
			Kembali ke Super Komik
		</a>
		<div class="mt-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-6" role="alert">
			<p class="font-semibold">Chapter gagal dimuat</p>
			<p class="mt-1 text-sm text-white/60">{error}</p>
		</div>
	</main>
{:else if !payload}
	<main class="mx-auto max-w-5xl px-4 py-8" aria-busy="true" aria-label="Memuat chapter">
		<div class="grid gap-3">
			{#each [0, 1, 2] as i (i)}
				<div class="aspect-[3/4] animate-pulse rounded-xl bg-white/5" aria-hidden="true"></div>
			{/each}
		</div>
		<span class="sr-only" role="status">Memuat chapter</span>
	</main>
{:else}
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
		<header class="reader-toolbar" data-reader-controls>
			<div class="reader-toolbar-inner">
				<div class="reader-heading">
					<a
						class="reader-title reader-title-link truncate"
						href={`/super-komik/${encodeURIComponent(payload.series.id)}`}
					>
						{decodeEntities(payload.series.title)}
					</a>
					<p class="reader-title-subtitle truncate">
						Chapter {decodeEntities(payload.chapter.numberText)}
					</p>
				</div>
			</div>
		</header>

		<main
			class="reader-main"
			aria-label={`Chapter ${payload.chapter.numberText}, ${payload.pages.length} halaman`}
		>
			{#if payload.pages.length === 0}
				<div class="reader-message reader-message-centered">
					<BookOpen class="size-7 text-muted-foreground" />
					<p>Halaman chapter belum tersedia</p>
				</div>
			{:else}
				<div class="reader-pages">
					<section data-reader-chapter={payload.chapter.id} aria-label={`Chapter ${payload.chapter.numberText}`}>
						{#each payload.pages as image (image.id)}
							<figure class="reader-page">
								{#if failedImages.has(image.id)}
									<div class="reader-page-error" role="alert">
										<span>
											Gambar halaman gagal dimuat
											<button type="button" onclick={() => retryImage(image.id)} class="ml-2 underline" data-reader-controls>
												Coba lagi
											</button>
										</span>
									</div>
								{:else}
									<img
										src={image.url}
										alt={`${decodeEntities(payload.series.title)} chapter ${payload.chapter.numberText}, halaman ${image.pageIndex + 1}`}
										loading={image.pageIndex < 2 ? "eager" : "lazy"}
										draggable={false}
										class="reader-page-image"
										onerror={() => {
											failedImages = new Set([...failedImages, image.id]);
										}}
									/>
								{/if}
							</figure>
						{/each}
					</section>
				</div>
			{/if}
		</main>

		<nav class="reader-dock" aria-label="Navigasi chapter" data-reader-controls>
			{#if payload.previousChapterId}
				<a
					href={`/super-komik/read/${encodeURIComponent(payload.previousChapterId)}`}
					class="reader-icon-action"
					aria-label="Chapter sebelumnya"
					title="Chapter sebelumnya"
					data-tooltip="Chapter sebelumnya"
				>
					<ArrowLeft />
				</a>
			{:else}
				<a
					href={`/super-komik/${encodeURIComponent(payload.series.id)}`}
					class="reader-icon-action"
					aria-label="Kembali ke detail"
					title="Kembali ke detail"
					data-tooltip="Detail"
				>
					<House />
				</a>
			{/if}
			<a
				href={`/super-komik/${encodeURIComponent(payload.series.id)}`}
				class="reader-icon-action"
				aria-label="Semua chapter"
				title="Semua chapter"
				data-tooltip="Semua chapter"
			>
				<BookOpen />
			</a>
			{#if payload.nextChapterId}
				<a
					href={`/super-komik/read/${encodeURIComponent(payload.nextChapterId)}`}
					class="reader-icon-action"
					aria-label="Chapter berikutnya"
					title="Chapter berikutnya"
					data-tooltip="Chapter berikutnya"
				>
					<ArrowRight />
				</a>
			{:else}
				<a
					href={`/super-komik/${encodeURIComponent(payload.series.id)}`}
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
			<button type="button" onclick={() => scrollPage(-1)} aria-label="Gulir ke atas" title="Gulir ke atas">
				<ArrowUp />
			</button>
			<button type="button" onclick={() => scrollPage(1)} aria-label="Gulir ke bawah" title="Gulir ke bawah">
				<ArrowDown />
			</button>
		</nav>
	</div>
{/if}
