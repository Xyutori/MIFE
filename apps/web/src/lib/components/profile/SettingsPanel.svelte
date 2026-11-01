<script lang="ts">
import { LoaderCircle } from "lucide-svelte";
import { onMount } from "svelte";
import { apiBase, fetchUntilConnected, resolveMediaUrl } from "#lib/api.ts";
import { authClient } from "#lib/auth-client.ts";
import CropImageModal from "#lib/components/profile/CropImageModal.svelte";
import LoginCta from "#lib/components/profile/LoginCta.svelte";
import {
	type AnimePreferences,
	PLAYBACK_RATES,
	PLAYER_QUALITIES,
	readAnimePrefs,
	saveAnimePrefs,
} from "#lib/components/profile/preferences.ts";
import {
	fetchProfile,
	fetchSessions,
	patchProfile,
	revokeSessionById,
	type UserProfile,
	type UserSession,
	uploadAvatar,
	uploadHeader,
} from "#lib/components/profile/profile-api.ts";
import { parseUserAgent } from "#lib/components/profile/user-agent.ts";
import Select from "#lib/components/ui/select/Select.svelte";
import {
	type ReaderPrefs,
	readReaderPrefs,
	type ScrollMode,
	saveReaderPrefs,
} from "#lib/reader.ts";

type SettingsTab = "account" | "preference";

const session = authClient.useSession();
const loggedIn = $derived(!!$session.data?.user);

let tab = $state<SettingsTab>("account");

// --- Account: profil ---
let profile = $state<UserProfile | null>(null);
let profileLoading = $state(true);
let nameDraft = $state("");
let nameSaving = $state(false);
let nameMessage = $state("");
let nameError = $state("");

// --- Account: avatar & banner (crop lokal lalu diunggah ke server) ---
let avatarFileInput = $state<HTMLInputElement | null>(null);
let bannerFileInput = $state<HTMLInputElement | null>(null);
let cropTarget = $state<{ kind: "avatar" | "banner"; src: string } | null>(
	null,
);
let avatarPreview = $state<string | null>(null);
let bannerPreview = $state<string | null>(null);
let mediaUploading = $state<"avatar" | "banner" | null>(null);
let mediaError = $state("");

// --- Account: sesi perangkat ---
let sessions = $state<UserSession[]>([]);
let sessionsLoading = $state(false);
let sessionsError = $state("");
let revokingId = $state("");

// --- Preference ---
let reader = $state<ReaderPrefs>(readReaderPrefs());
let anime = $state<AnimePreferences>(readAnimePrefs());
let prefsLoading = $state(true);
let prefsError = $state("");
let prefsStatus = $state("");
let animeSyncTimer: ReturnType<typeof setTimeout> | undefined;
let animeServerAvailable = $state(false);

const BANNER_ASPECT = 3;

onMount(() => {
	if (!loggedIn) {
		profileLoading = false;
		prefsLoading = false;
		return;
	}
	const controller = new AbortController();
	void fetchProfile(controller.signal)
		.then((result) => {
			if (controller.signal.aborted) return;
			profile = result;
			nameDraft = result?.name ?? "";
		})
		.catch((cause: unknown) => {
			if (!controller.signal.aborted && cause instanceof Error) {
				nameError = cause.message;
			}
		})
		.finally(() => {
			if (!controller.signal.aborted) profileLoading = false;
		});
	sessionsLoading = true;
	void fetchSessions(controller.signal)
		.then((list) => {
			if (!controller.signal.aborted) sessions = list;
		})
		.catch((cause: unknown) => {
			if (!controller.signal.aborted) {
				sessionsError =
					cause instanceof Error ? cause.message : "Daftar sesi gagal dimuat.";
			}
		})
		.finally(() => {
			if (!controller.signal.aborted) sessionsLoading = false;
		});
	void fetchUntilConnected(`${apiBase()}/api/v1/anime/settings`, {
		credentials: "include",
		signal: controller.signal,
	})
		.then(async (animeResponse) => {
			const animePayload = (await animeResponse.json().catch(() => ({}))) as {
				settings?: {
					playerQuality?: unknown;
					autoplayNext?: unknown;
					playbackRate?: unknown;
				};
				error?: unknown;
			};
			if (!animeResponse.ok) {
				throw new Error(
					typeof animePayload.error === "string" && animePayload.error
						? animePayload.error
						: "Pengaturan anime tidak dapat dimuat.",
				);
			}
			if (controller.signal.aborted) return;
			const rate = Number(animePayload.settings?.playbackRate);
			const next: AnimePreferences = {
				playerQuality:
					typeof animePayload.settings?.playerQuality === "string" &&
					animePayload.settings.playerQuality
						? animePayload.settings.playerQuality
						: anime.playerQuality,
				autoplayNext: Boolean(animePayload.settings?.autoplayNext),
				playbackRate:
					Number.isFinite(rate) && rate >= 0.5 && rate <= 2
						? rate
						: anime.playbackRate,
			};
			anime = next;
			saveAnimePrefs(next);
			animeServerAvailable = true;
		})
		.catch((cause: unknown) => {
			if (!controller.signal.aborted) {
				prefsError =
					cause instanceof Error ? cause.message : "Server belum tersambung.";
			}
		})
		.finally(() => {
			if (!controller.signal.aborted) prefsLoading = false;
		});
	return () => controller.abort();
});

function switchTab(next: SettingsTab) {
	tab = next;
}

function handleTabKeydown(event: KeyboardEvent) {
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
	event.preventDefault();
	const next: SettingsTab = tab === "account" ? "preference" : "account";
	switchTab(next);
	// Pindahkan fokus ke tab yang baru aktif (pola roving tabindex manual).
	document.getElementById(`tab-${next}`)?.focus();
}

let nameTimer: ReturnType<typeof setTimeout> | undefined;

function queueNameSave() {
	nameError = "";
	nameMessage = "";
	clearTimeout(nameTimer);
	nameTimer = setTimeout(() => void saveName(), 800);
}

function flushNameSave() {
	clearTimeout(nameTimer);
	void saveName();
}

/** Segarkan sesi agar foto/nama di header ikut baru tanpa login ulang. */
async function refreshSession() {
	try {
		await authClient.getSession({ fetchOptions: { cache: "no-store" } });
	} catch {
		// Abaikan: header diperbarui saat sesi berikutnya.
	}
}

async function saveName() {
	if (!profile || nameSaving) return;
	const next = nameDraft.trim();
	if (!next) {
		nameError = "Nama tidak boleh kosong.";
		return;
	}
	if (next === profile.name) return;
	nameSaving = true;
	nameError = "";
	nameMessage = "";
	try {
		const saved = await patchProfile({
			name: next,
			username: profile.username ?? null,
			phone: profile.phone ?? null,
			image: profile.image ?? null,
			headerImage: profile.headerImage ?? null,
		});
		profile = saved;
		nameDraft = saved.name;
		nameMessage = "Nama tersimpan otomatis.";
		void refreshSession();
	} catch (cause) {
		nameError = cause instanceof Error ? cause.message : "Nama gagal disimpan.";
	} finally {
		nameSaving = false;
	}
}

function openCrop(input: HTMLInputElement | null) {
	input?.click();
}

function handleFileSelect(event: Event, kind: "avatar" | "banner") {
	const files = (event.currentTarget as HTMLInputElement).files;
	const file = files?.[0];
	// Reset agar file yang sama bisa dipilih ulang.
	(event.currentTarget as HTMLInputElement).value = "";
	if (!file?.type.startsWith("image/")) return;
	if (cropTarget) URL.revokeObjectURL(cropTarget.src);
	cropTarget = { kind, src: URL.createObjectURL(file) };
}

function discardPreview(kind: "avatar" | "banner") {
	if (kind === "avatar" && avatarPreview) {
		URL.revokeObjectURL(avatarPreview);
		avatarPreview = null;
	}
	if (kind === "banner" && bannerPreview) {
		URL.revokeObjectURL(bannerPreview);
		bannerPreview = null;
	}
}

async function handleCropConfirm(blob: Blob) {
	if (!cropTarget || !profile || mediaUploading) return;
	const kind = cropTarget.kind;
	URL.revokeObjectURL(cropTarget.src);
	cropTarget = null;
	// Pratinjau optimistis; dibuang bila unggah/PATCH gagal.
	if (avatarPreview) URL.revokeObjectURL(avatarPreview);
	if (bannerPreview) URL.revokeObjectURL(bannerPreview);
	if (kind === "avatar") avatarPreview = URL.createObjectURL(blob);
	else bannerPreview = URL.createObjectURL(blob);
	mediaUploading = kind;
	mediaError = "";
	try {
		const url =
			kind === "avatar" ? await uploadAvatar(blob) : await uploadHeader(blob);
		const saved = await patchProfile({
			name: profile.name,
			username: profile.username ?? null,
			phone: profile.phone ?? null,
			image: kind === "avatar" ? url : (profile.image ?? null),
			headerImage: kind === "banner" ? url : (profile.headerImage ?? null),
		});
		profile = saved;
		// Profil kini menunjuk URL sajian server; pratinjau lokal dibuang.
		discardPreview(kind);
		void refreshSession();
	} catch (cause) {
		mediaError =
			cause instanceof Error ? cause.message : "Unggahan gambar gagal.";
		discardPreview(kind);
	} finally {
		mediaUploading = null;
	}
}

function closeCrop() {
	if (cropTarget) URL.revokeObjectURL(cropTarget.src);
	cropTarget = null;
}

async function revokeSession(target: UserSession) {
	if (target.current || revokingId) return;
	revokingId = target.id;
	sessionsError = "";
	try {
		await revokeSessionById(target.id);
		sessions = sessions.filter((item) => item.id !== target.id);
	} catch (cause) {
		sessionsError =
			cause instanceof Error ? cause.message : "Sesi gagal dicabut.";
	} finally {
		revokingId = "";
	}
}

function persistPrefs() {
	saveReaderPrefs(reader);
	saveAnimePrefs(anime);
	prefsStatus = "";
	clearTimeout(animeSyncTimer);
	animeSyncTimer = setTimeout(() => void syncAnimePrefs(), 1000);
}

async function syncAnimePrefs() {
	if (!loggedIn || !animeServerAvailable) return;
	try {
		const response = await fetch(`${apiBase()}/api/v1/anime/settings`, {
			method: "PATCH",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(anime),
		});
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(
				typeof (payload as { error?: unknown }).error === "string" &&
					(payload as { error: string }).error
					? (payload as { error: string }).error
					: "Pengaturan gagal disimpan ke server (tersimpan lokal).",
			);
		}
		prefsStatus = "Tersimpan otomatis.";
	} catch (cause) {
		prefsError =
			cause instanceof Error ? cause.message : "Server belum tersambung.";
	}
}

const READER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
</script>

<main class="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-6">
	<div>
		<h1 class="bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text font-extrabold text-2xl text-transparent">
			Pengaturan
		</h1>
	</div>

	<div
		role="tablist"
		aria-label="Jenis pengaturan"
		class="mt-5 grid w-full grid-cols-2 gap-1 rounded-full border bg-card p-1"
	>
		{#each [{ id: "account", label: "Account" }, { id: "preference", label: "Preference" }] as item (item.id)}
			<button
				type="button"
				role="tab"
				id={`tab-${item.id}`}
				aria-selected={tab === item.id}
				aria-controls={`panel-${item.id}`}
				tabindex={tab === item.id ? 0 : -1}
				onclick={() => switchTab(item.id as SettingsTab)}
				onkeydown={handleTabKeydown}
				class={`min-h-11 rounded-full font-bold text-sm transition ${tab === item.id ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
			>
				{item.label}
			</button>
		{/each}
	</div>

	{#if tab === "account"}
		<div role="tabpanel" id="panel-account" aria-labelledby="tab-account" class="mt-6 space-y-5">
			{#if !loggedIn && !profileLoading}
				<LoginCta callbackPath="/profile/settings" />
			{:else}
				<section aria-label="Profil akun" class="rounded-3xl border bg-card p-5 sm:p-7">
					{#if profileLoading}
						<div class="h-11 w-40 animate-pulse rounded bg-secondary" aria-hidden="true"></div>
					{:else}
						<div class="grid gap-4">
							<label class="block font-semibold text-sm">
								Nama
								<input
									type="text"
									required
									maxlength={120}
									bind:value={nameDraft}
									oninput={queueNameSave}
									onblur={flushNameSave}
									aria-label="Nama"
									class="mt-2 h-11 w-full rounded-xl border bg-background px-3 font-normal outline-none placeholder:text-muted-foreground focus:border-primary"
								/>
							</label>
							<label class="block font-semibold text-sm">
								Email
								<input
									type="email"
									readonly
									value={profile?.email ?? ""}
									aria-label="Email (tidak dapat diubah)"
									class="mt-2 h-11 w-full rounded-xl border bg-secondary/60 px-3 font-normal text-muted-foreground"
								/>
							</label>
							{#if nameError}
								<p role="alert" class="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm">
									{nameError}
								</p>
							{/if}
							{#if nameSaving}
								<p role="status" class="text-muted-foreground text-sm">Menyimpan…</p>
							{:else if nameMessage}
								<p role="status" class="text-primary text-sm">{nameMessage}</p>
							{/if}
						</div>
					{/if}
				</section>

				<section aria-label="Foto profil dan banner" class="rounded-3xl border bg-card p-5 sm:p-7">
					<h2 class="font-bold text-lg">Foto &amp; banner</h2>
					<div class="mt-4 grid gap-5">
						<div>
							<div class="flex items-center gap-4">
								{#if avatarPreview}
									<img src={avatarPreview} alt="Pratinjau foto profil" class="size-20 rounded-full border bg-secondary object-cover" />
								{:else if profile?.image}
									<img src={resolveMediaUrl(profile.image)} alt="Foto profil" referrerpolicy="no-referrer" class="size-20 rounded-full border bg-secondary object-cover" />
								{:else}
									<span aria-hidden="true" class="grid size-20 place-items-center rounded-full border bg-secondary font-bold text-2xl text-muted-foreground">
										{(nameDraft || profile?.email || "?").slice(0, 1).toUpperCase()}
									</span>
								{/if}
								<button
									type="button"
									onclick={() => openCrop(avatarFileInput)}
									disabled={mediaUploading !== null}
									class="inline-flex min-h-11 items-center rounded-full border px-5 font-semibold text-sm transition hover:bg-accent disabled:opacity-50"
								>
									{mediaUploading === "avatar" ? "Mengunggah…" : "Ubah foto"}
								</button>
							</div>
							<input
								bind:this={avatarFileInput}
								type="file"
								accept="image/*"
								hidden
								tabindex={-1}
								aria-hidden="true"
								onchange={(event) => handleFileSelect(event, "avatar")}
							/>
						</div>
						<div>
							{#if bannerPreview}
								<img src={bannerPreview} alt="Pratinjau banner" class="aspect-[3/1] w-full rounded-2xl border bg-secondary object-cover" />
							{:else if profile?.headerImage}
								<img src={resolveMediaUrl(profile.headerImage)} alt="Banner profil" referrerpolicy="no-referrer" class="aspect-[3/1] w-full rounded-2xl border bg-secondary object-cover" />
							{:else}
								<div aria-hidden="true" class="aspect-[3/1] w-full rounded-2xl border bg-gradient-to-br from-primary/40 via-secondary to-card"></div>
							{/if}
							<button
								type="button"
								onclick={() => openCrop(bannerFileInput)}
								disabled={mediaUploading !== null}
								class="mt-3 inline-flex min-h-11 items-center rounded-full border px-5 font-semibold text-sm transition hover:bg-accent disabled:opacity-50"
							>
								{mediaUploading === "banner" ? "Mengunggah…" : "Ubah banner"}
							</button>
							<input
								bind:this={bannerFileInput}
								type="file"
								accept="image/*"
								hidden
								tabindex={-1}
								aria-hidden="true"
								onchange={(event) => handleFileSelect(event, "banner")}
							/>
						</div>
					</div>
					{#if mediaUploading}
						<p role="status" class="mt-4 rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs">
							Mengunggah {mediaUploading === "avatar" ? "foto profil" : "banner"}…
						</p>
					{/if}
					{#if mediaError}
						<p role="alert" class="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-xs">
							{mediaError}
						</p>
					{/if}
				</section>

				<section aria-label="Sesi perangkat" class="rounded-3xl border bg-card p-5 sm:p-7">
					<h2 class="font-bold text-lg">Perangkat yang login</h2>
					{#if sessionsLoading}
						<div class="mt-4 space-y-2" aria-label="Memuat sesi">
							{#each [0, 1] as index (index)}
								<div class="h-16 animate-pulse rounded-2xl bg-secondary/60" aria-hidden="true"></div>
							{/each}
						</div>
					{:else if sessions.length === 0}
						<p class="mt-3 text-muted-foreground text-sm">Tidak ada sesi aktif.</p>
					{:else}
						<ul class="mt-4 space-y-2">
							{#each sessions as item (item.id)}
								{@const parsed = parseUserAgent(item.userAgent)}
								<li class="flex min-h-14 items-center justify-between gap-3 rounded-2xl border bg-secondary/60 px-4 py-2">
									<span class="min-w-0">
										<span class="block truncate font-semibold text-sm">
											{parsed.device} · {parsed.os}
										</span>
										<span class="block truncate text-muted-foreground text-xs">
											{parsed.browser}
											{#if item.current}
												<span class="ml-1 rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary text-[11px]">
													Perangkat ini
												</span>
											{/if}
										</span>
									</span>
									{#if !item.current}
										<button
											type="button"
											onclick={() => void revokeSession(item)}
											disabled={revokingId !== ""}
											aria-label={`Keluar dari ${parsed.device}`}
											class="inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 font-semibold text-destructive text-xs transition hover:bg-destructive/10 disabled:opacity-50"
										>
											{#if revokingId === item.id}
												<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
											{:else}
												Keluar
											{/if}
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if sessionsError}
						<p role="alert" class="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm">
							{sessionsError}
						</p>
					{/if}
				</section>
			{/if}
		</div>
	{:else}
		<div role="tabpanel" id="panel-preference" aria-labelledby="tab-preference" class="mt-6 space-y-5">
			{#if !$session.data?.user}
				<p class="rounded-xl border bg-card p-3 text-muted-foreground text-sm">
					Belum masuk: preferensi tersimpan di perangkat ini dan akan disinkron ke server setelah kamu masuk.
				</p>
			{/if}

			<section aria-label="Reader komik" class="rounded-3xl border bg-card p-5 sm:p-7">
				<h2 class="font-bold text-lg">Reader komik</h2>
				<div class="mt-4 grid gap-4 sm:grid-cols-2">
					<label class="flex min-h-11 cursor-pointer items-center justify-between gap-4 font-semibold text-sm sm:col-span-2">
						Lanjut otomatis ke chapter berikutnya
						<input
							type="checkbox"
							checked={reader.autoNext}
							disabled={prefsLoading}
							onchange={(event) => {
								persistPrefs();
								reader = { ...reader, autoNext: event.currentTarget.checked };
							}}
							class="size-4 shrink-0 accent-primary"
						/>
					</label>
					<label class="flex min-h-11 cursor-pointer items-center justify-between gap-4 font-semibold text-sm sm:col-span-2">
						Auto-scroll saat membaca
						<input
							type="checkbox"
							checked={reader.autoScroll}
							disabled={prefsLoading}
							onchange={(event) => {
								persistPrefs();
								reader = { ...reader, autoScroll: event.currentTarget.checked };
							}}
							class="size-4 shrink-0 accent-primary"
						/>
					</label>
					<div class="block font-semibold text-sm">
						Mode scroll
						<div class="mt-2">
							<Select
								value={reader.scrollMode}
								options={[
									{ value: "viewport", label: "Per viewport" },
									{ value: "chapter", label: "Per chapter" },
								]}
								disabled={prefsLoading}
								ariaLabel="Mode scroll"
								onChange={(value) => {
									persistPrefs();
									reader = { ...reader, scrollMode: value as ScrollMode };
								}}
							/>
						</div>
					</div>
					<div class="block font-semibold text-sm">
						Kecepatan auto-scroll
						<div class="mt-2">
							<Select
								value={String(reader.autoScrollSpeed)}
								options={READER_SPEEDS.map((speed) => ({
									value: String(speed),
									label: `${speed}×`,
								}))}
								disabled={prefsLoading}
								ariaLabel="Kecepatan auto-scroll"
								onChange={(value) => {
									persistPrefs();
									reader = { ...reader, autoScrollSpeed: Number(value) };
								}}
							/>
						</div>
					</div>
					<div class="block font-semibold text-sm">
						Format gambar lokal
						<div class="mt-2">
							<Select
								value={reader.localFormat}
								options={[
									{ value: "webp", label: "WebP (hemat kuota)" },
									{ value: "original", label: "Original" },
								]}
								disabled={prefsLoading}
								ariaLabel="Format gambar lokal"
								onChange={(value) => {
									persistPrefs();
									reader = {
										...reader,
										localFormat: value === "original" ? "original" : "webp",
									};
								}}
							/>
						</div>
					</div>
				</div>
			</section>

			<section aria-label="Pemutar anime" class="rounded-3xl border bg-card p-5 sm:p-7">
				<h2 class="font-bold text-lg">Pemutar anime</h2>
				<div class="mt-4 grid gap-4 sm:grid-cols-2">
					<div class="block font-semibold text-sm">
						Kualitas default
						<div class="mt-2">
							<Select
								value={anime.playerQuality}
								options={PLAYER_QUALITIES.map((quality) => ({
									value: quality,
									label: quality === "auto" ? "Otomatis" : quality,
								}))}
								disabled={prefsLoading}
								ariaLabel="Kualitas default"
								onChange={(value) => {
									persistPrefs();
									anime = { ...anime, playerQuality: value };
								}}
							/>
						</div>
					</div>
					<div class="block font-semibold text-sm">
						Kecepatan default
						<div class="mt-2">
							<Select
								value={String(anime.playbackRate)}
								options={PLAYBACK_RATES.map((rate) => ({
									value: String(rate),
									label: `${rate}×`,
								}))}
								disabled={prefsLoading}
								ariaLabel="Kecepatan default"
								onChange={(value) => {
									persistPrefs();
									anime = { ...anime, playbackRate: Number(value) };
								}}
							/>
						</div>
					</div>
					<label class="flex min-h-14 items-center justify-between gap-4 rounded-2xl border bg-secondary/60 px-4 py-3 font-semibold text-sm sm:col-span-2">
						Putar episode selanjutnya otomatis
						<input
							type="checkbox"
							checked={anime.autoplayNext}
							disabled={prefsLoading}
							onchange={(event) => {
								persistPrefs();
								anime = { ...anime, autoplayNext: event.currentTarget.checked };
							}}
							class="size-4 accent-primary"
						/>
					</label>
				</div>
			</section>

			{#if prefsError}
				<p role="alert" class="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm">
					{prefsError}
				</p>
			{/if}
			{#if prefsStatus}
				<p role="status" class="text-primary text-sm">{prefsStatus}</p>
			{/if}
		</div>
	{/if}
</main>

{#if cropTarget}
	<CropImageModal
		src={cropTarget.src}
		aspect={cropTarget.kind === "avatar" ? 1 : BANNER_ASPECT}
		title={cropTarget.kind === "avatar" ? "Potong foto profil" : "Potong banner"}
		onConfirm={handleCropConfirm}
		onClose={closeCrop}
	/>
{/if}
