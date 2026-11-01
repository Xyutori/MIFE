<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import Hls from "hls.js";
	import { onMount } from "svelte";
	import {
		decodeEntities,
		formatEpisodeLabel,
		requestJson,
		type EpisodeMedia,
		type EpisodeMediaSource,
	} from "#lib/admin.ts";
	import Select from "#lib/components/ui/select/Select.svelte";

	type AnimeSettings = {
		settings?: {
			playerQuality?: string;
			playbackRate?: number;
			autoplayNext?: boolean;
		};
	};

	let { episodeId }: { episodeId: string } = $props();

	let payload = $state<EpisodeMedia | null>(null);
	let error = $state("");
	let quality = $state("auto");
	let playbackRate = $state(1);
	let autoplayNext = $state(false);
	let selectedId = $state("");
	let playerError = $state("");
	let online = $state(true);
	let settingsOpen = $state(false);
	let videoEl: HTMLVideoElement | null = $state(null);
	let hls: Hls | null = null;

	const autoplayRequested = $derived(
		page.url.searchParams.get("autoplay") === "1",
	);
	const streams = $derived(payload?.sources ?? []);

	function streamResolution(value: string | null | undefined): string | null {
		if (!value) return null;
		const resolution = value.match(/\b(\d{3,4})\s*p\b/i);
		if (resolution) return `${resolution[1]}p`;
		const dimensions = value.match(/\b\d{3,4}\s*[x×]\s*(\d{3,4})\b/i);
		return dimensions ? `${dimensions[1]}p` : null;
	}

	function preferredStream(
		candidates: EpisodeMediaSource[],
	): EpisodeMediaSource | undefined {
		return [...candidates].sort(
			(a, b) => Number(b.type === "video") - Number(a.type === "video"),
		)[0];
	}

	const qualities = $derived(
		[...new Set(streams.map((source) => streamResolution(source.quality)))]
			.filter((value): value is string => Boolean(value))
			.sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10)),
	);
	const matchingQuality = $derived(
		quality === "auto"
			? streams
			: streams.filter(
					(source) => streamResolution(source.quality) === quality,
				),
	);
	const selected = $derived(
		streams.find((source) => source.id === selectedId) ??
			preferredStream(matchingQuality.length ? matchingQuality : streams),
	);
	const playerMessage = $derived(
		selected?.type === "embed"
			? "Sumber ini tidak dapat diputar. Pilih sumber lain melalui tombol pengaturan."
			: selected
				? playerError
				: streams.length > 0
					? "Video tidak dapat diputar. Pilih sumber lain melalui tombol pengaturan."
					: "Video belum tersedia.",
	);

	function positionKey(id: string): string {
		return `symi:anime:pos:${id}`;
	}

	function savePosition(video: HTMLVideoElement) {
		try {
			if (Number.isFinite(video.currentTime) && video.currentTime > 5)
				localStorage.setItem(positionKey(episodeId), String(video.currentTime));
			if (payload)
				localStorage.setItem(`symi:anime:last:${payload.animeId}`, episodeId);
		} catch {
			// localStorage tidak tersedia — abaikan.
		}
	}

	function restorePosition(video: HTMLVideoElement) {
		try {
			const saved = Number(localStorage.getItem(positionKey(episodeId)));
			if (
				Number.isFinite(saved) &&
				saved > 5 &&
				Number.isFinite(video.duration) &&
				saved < video.duration - 10
			)
				video.currentTime = saved;
		} catch {
			// Abaikan.
		}
	}

	function isHlsUrl(source: EpisodeMediaSource): boolean {
		return (
			source.url.includes(".m3u8") ||
			(source.mimeType?.includes("mpegurl") ?? false) ||
			(source.mimeType?.includes("x-mpegurl") ?? false)
		);
	}

	function attachStream(video: HTMLVideoElement, source: EpisodeMediaSource) {
		if (hls) {
			hls.destroy();
			hls = null;
		}
		playerError = "";
		if (isHlsUrl(source)) {
			if (Hls.isSupported()) {
				const instance = new Hls({ enableWorker: true });
				hls = instance;
				instance.on(Hls.Events.ERROR, (_event, data) => {
					if (data.fatal)
						playerError =
							"Video gagal dimuat. Pilih sumber lain melalui tombol pengaturan.";
				});
				instance.on(Hls.Events.MANIFEST_PARSED, () => {
					restorePosition(video);
					if (autoplayRequested) void video.play().catch(() => undefined);
				});
				instance.loadSource(source.url);
				instance.attachMedia(video);
				return;
			}
			if (video.canPlayType("application/vnd.apple.mpegurl")) {
				video.src = source.url;
				video.addEventListener(
					"loadedmetadata",
					() => {
						restorePosition(video);
						if (autoplayRequested) void video.play().catch(() => undefined);
					},
					{ once: true },
				);
				return;
			}
			playerError =
				"Peramban ini tidak mendukung HLS. Pilih sumber lain melalui tombol pengaturan.";
			return;
		}
		video.src = source.url;
		video.addEventListener(
			"loadedmetadata",
			() => {
				restorePosition(video);
				if (autoplayRequested) void video.play().catch(() => undefined);
			},
			{ once: true },
		);
	}

	// Pasang / lepas stream setiap pilihan berubah.
	$effect(() => {
		const video = videoEl;
		const source = selected;
		if (!video) return;
		if (!source || source.type !== "video") {
			video.removeAttribute("src");
			video.load();
			return;
		}
		video.playbackRate = playbackRate;
		attachStream(video, source);
	});

	// Bersihkan instance HLS saat komponen dilepas.
	$effect(() => {
		return () => {
			hls?.destroy();
			hls = null;
		};
	});

	onMount(() => {
		online = navigator.onLine;
		const goOnline = () => (online = true);
		const goOffline = () => (online = false);
		window.addEventListener("online", goOnline);
		window.addEventListener("offline", goOffline);

		const controller = new AbortController();
		payload = null;
		error = "";
		requestJson<EpisodeMedia>(
			`/api/v1/anime/episodes/${encodeURIComponent(episodeId)}/media`,
			{ signal: controller.signal },
		)
			.then((value) => {
				payload = value;
				selectedId = preferredStream(value.sources)?.id ?? "";
			})
			.catch((cause) => {
				if ((cause as Error)?.name === "AbortError") return;
				error =
					cause instanceof Error ? cause.message : "Video gagal dimuat.";
			});
		requestJson<AnimeSettings>("/api/v1/anime/settings", {
			signal: controller.signal,
		})
			.then((value) => {
				const savedQuality = value.settings?.playerQuality;
				quality =
					savedQuality === "auto"
						? "auto"
						: (streamResolution(savedQuality ?? null) ?? "auto");
				playbackRate = Number(value.settings?.playbackRate) || 1;
				autoplayNext = Boolean(value.settings?.autoplayNext);
			})
			.catch(() => undefined);
		return () => {
			controller.abort();
			window.removeEventListener("online", goOnline);
			window.removeEventListener("offline", goOffline);
		};
	});

	async function persistSettings(patch: Record<string, unknown>) {
		try {
			await requestJson("/api/v1/anime/settings", {
				method: "PATCH",
				body: JSON.stringify(patch),
			});
		} catch {
			// Pengaturan pemutar bersifat best-effort.
		}
	}

	function changeQuality(value: string) {
		quality = value;
		const candidates =
			value === "auto"
				? streams
				: streams.filter(
						(source) => streamResolution(source.quality) === value,
					);
		const next = preferredStream(candidates.length ? candidates : streams);
		if (next) selectedId = next.id;
		void persistSettings({ playerQuality: value });
	}

	function changeStream(value: string) {
		selectedId = value;
		const next = streams.find((stream) => stream.id === value);
		if (next) {
			const nextQuality = streamResolution(next.quality) ?? "auto";
			quality = nextQuality;
			void persistSettings({ playerQuality: nextQuality });
		}
	}

	function onEnded() {
		if (autoplayNext && payload?.nextEpisodeId)
			void goto(`/anime/watch/${payload.nextEpisodeId}?autoplay=1`);
	}
</script>

{#if error}
	<main class="watch-page mx-auto max-w-5xl px-4 py-10">
		<a
			href="/anime"
			class="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
		>
			← Kembali
		</a>
		<div
			role="alert"
			class="mt-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center"
		>
			<p class="font-semibold text-destructive text-sm">{error}</p>
		</div>
	</main>
{:else if !payload}
	<main
		class="watch-page mx-auto max-w-7xl px-4 pt-6 pb-14 sm:px-6 lg:px-8"
		aria-busy="true"
	>
		<div
			class="mt-4 h-8 w-[86%] max-w-2xl animate-pulse rounded-xl bg-secondary sm:h-9"
			aria-hidden="true"
		></div>
		<div
			class="mt-5 aspect-video overflow-hidden rounded-3xl border border-border bg-black"
			aria-hidden="true"
		></div>
		<span class="sr-only" role="status">Memuat pemutar anime</span>
	</main>
{:else}
	<main class="watch-page mx-auto max-w-7xl px-4 pt-6 pb-14 sm:px-6 lg:px-8">
		<a
			href="/anime/{payload.animeId}"
			class="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
		>
			← {decodeEntities(payload.animeTitle)}
		</a>

		<h1 class="mt-4 font-display font-extrabold text-2xl sm:text-3xl">
			{decodeEntities(payload.animeTitle)}
			<span class="text-primary">
				· {formatEpisodeLabel(payload.episode.numberText, payload.episode.title)}
			</span>
		</h1>

		<p class="mt-2 text-xs text-muted-foreground">
			Video bersifat online-only dan tidak tersedia offline. Posisi tonton
			disimpan otomatis di perangkat ini.
		</p>
		{#if !online}
			<p
				role="alert"
				class="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm"
			>
				Perangkat sedang offline — video tidak dapat diputar sampai koneksi
				kembali.
			</p>
		{/if}

		<section
			class="watch-player relative mt-5 aspect-video overflow-hidden rounded-3xl border border-border bg-black shadow-2xl"
		>
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				bind:this={videoEl}
				class="watch-player-video absolute inset-0 h-full w-full"
				controls
				playsinline
				preload="metadata"
				ontimeupdate={(event) => savePosition(event.currentTarget)}
				onended={onEnded}
				onerror={() => {
					if (selected?.type === "video")
						playerError =
							"Video gagal dimuat. Pilih sumber lain melalui tombol pengaturan.";
				}}
			></video>
			{#if playerMessage}
				<div
					class="pointer-events-none absolute inset-x-0 bottom-12 z-10 flex justify-center px-6"
				>
					<p
						role="status"
						class="max-w-md rounded-xl bg-black/75 px-4 py-3 text-center text-sm text-white/85"
					>
						{playerMessage}
					</p>
				</div>
			{/if}
			{#if streams.length > 0}
				<div class="absolute top-3 right-3 z-30">
					<button
						type="button"
						aria-expanded={settingsOpen}
						aria-label="Pengaturan pemutar"
						onclick={() => (settingsOpen = !settingsOpen)}
						class="flex size-10 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white shadow-lg backdrop-blur hover:bg-black/90"
					>
						⚙
					</button>
					{#if settingsOpen}
						<div
							class="watch-settings absolute top-12 right-0 max-h-[calc(100%-4rem)] w-[min(21rem,calc(100vw-2rem))] space-y-4 overflow-y-auto rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
						>
							<div class="block font-semibold text-xs">
								Kualitas
								<div class="mt-2">
									<Select
										value={qualities.includes(quality) ? quality : "auto"}
										options={[
											{ value: "auto", label: "Otomatis" },
											...qualities.map((value) => ({ value, label: value })),
										]}
										ariaLabel="Kualitas"
										onChange={(value) => changeQuality(value)}
									/>
								</div>
							</div>
							<div class="block font-semibold text-xs">
								Variasi sumber
								<div class="mt-2">
									<Select
										value={selected?.id ?? ""}
										options={streams.map((stream, index) => ({
											value: stream.id,
											label: `Sumber ${index + 1}${stream.sourceName ? ` · ${decodeEntities(stream.sourceName)}` : ""}`,
										}))}
										ariaLabel="Variasi sumber"
										onChange={(value) => changeStream(value)}
									/>
								</div>
							</div>
							<div class="block font-semibold text-xs">
								Kecepatan
								<div class="mt-2">
									<Select
										value={String(playbackRate)}
										options={[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(
											(value) => ({ value: String(value), label: `${value}×` }),
										)}
										ariaLabel="Kecepatan"
										onChange={(value) => {
											const next = Number(value);
											playbackRate = next;
											if (videoEl) videoEl.playbackRate = next;
											void persistSettings({ playbackRate: next });
										}}
									/>
								</div>
							</div>
							<label
								class="flex items-center justify-between gap-3 font-semibold text-xs"
							>
								Putar episode selanjutnya otomatis
								<input
									type="checkbox"
									checked={autoplayNext}
									onchange={(event) => {
										autoplayNext = event.currentTarget.checked;
										void persistSettings({
											autoplayNext: event.currentTarget.checked,
										});
									}}
									class="size-4 accent-primary"
								/>
							</label>
						</div>
					{/if}
				</div>
			{/if}
		</section>

		{#if payload.nextEpisodeId}
			<div class="mt-4 flex justify-end">
				<a
					href="/anime/watch/{payload.nextEpisodeId}"
					class="inline-flex min-h-10 items-center rounded-full bg-primary px-5 font-bold text-primary-foreground text-sm"
				>
					Episode berikutnya →
				</a>
			</div>
		{/if}
	</main>
{/if}

<style>
	.watch-player-video::-webkit-media-controls-panel {
		background-image: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
	}
	.watch-player-video::-webkit-media-controls-play-button {
		background-color: var(--primary);
		border-radius: 9999px;
	}
	.watch-player-video::-webkit-media-controls-timeline {
		background-color: var(--primary);
		border-radius: 9999px;
	}
	.watch-player-video::-webkit-media-controls-volume-slider {
		background-color: var(--primary);
		border-radius: 9999px;
	}
	.watch-player-video::-webkit-media-controls-current-time-display,
	.watch-player-video::-webkit-media-controls-time-remaining-display {
		color: #fff;
	}
</style>
