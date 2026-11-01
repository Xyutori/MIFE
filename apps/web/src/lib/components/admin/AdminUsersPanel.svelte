<script lang="ts">
import { apiBase, type RoleItem, requestJson } from "#lib/admin.ts";
import { resolveMediaUrl } from "#lib/api.ts";
import Pagination from "#lib/components/Pagination.svelte";
import Select from "#lib/components/ui/select/Select.svelte";

const limit = 25;

type AdminUserRow = {
	id: string;
	name: string | null;
	email: string;
	image?: string | null;
	headerImage?: string | null;
	createdAt: string;
	lastActiveAt?: string | null;
	roles?: unknown;
};

type AdminUser = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	headerImage: string | null;
	role: string;
	createdAt: string;
	lastActiveAt: string | null;
};

let users = $state<AdminUser[]>([]);
let roles = $state<RoleItem[]>([]);
let search = $state("");
let query = $state("");
let total = $state(0);
let page = $state(1);
let loading = $state(true);
let busy = $state("");
let error = $state("");
let message = $state("");
let editing = $state<AdminUser | null>(null);
let editRole = $state("user");
let editName = $state("");
let avatarFile = $state<File | null>(null);
let headerFile = $state<File | null>(null);
let avatarPreview = $state<string | null>(null);
let headerPreview = $state<string | null>(null);
let avatarRemoved = $state(false);
let headerRemoved = $state(false);
let editBusy = $state(false);
let editError = $state("");
let avatarInput: HTMLInputElement | null = $state(null);
let headerInput: HTMLInputElement | null = $state(null);
let deleting = $state<AdminUser | null>(null);

const offset = $derived((page - 1) * limit);
const pageCount = $derived(Math.max(1, Math.ceil(total / limit)));

function toAdminUser(row: AdminUserRow): AdminUser {
	return {
		id: row.id,
		email: row.email,
		name: row.name ?? "",
		image: row.image ?? null,
		headerImage: row.headerImage ?? null,
		role:
			Array.isArray(row.roles) && row.roles.includes("admin")
				? "admin"
				: "user",
		createdAt: row.createdAt,
		lastActiveAt: row.lastActiveAt ?? null,
	};
}

// Format relatif id-ID untuk "Aktivitas terakhir".
function formatLastActive(value: string | null): string {
	if (!value) return "Belum pernah";
	const at = Date.parse(value);
	if (!Number.isFinite(at)) return "—";
	const diff = Date.now() - at;
	if (diff < 0) return "baru saja";
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "baru saja";
	if (minutes < 60) return `${minutes} mnt lalu`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} jam lalu`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days} hari lalu`;
	if (days < 30) return `${Math.floor(days / 7)} mgg lalu`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months} bln lalu`;
	return `${Math.floor(months / 12)} thn lalu`;
}

function formatFullDate(value: string | null): string {
	if (!value) return "Belum ada aktivitas tercatat";
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) return "—";
	return new Intl.DateTimeFormat("id-ID", {
		day: "numeric",
		month: "long",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "Asia/Jakarta",
	}).format(date);
}

async function load(signal?: AbortSignal) {
	loading = true;
	error = "";
	try {
		const params = new URLSearchParams({
			limit: String(limit),
			offset: String(offset),
		});
		if (query.trim()) params.set("search", query.trim());
		const [userData, roleData] = await Promise.all([
			requestJson<{ users?: AdminUserRow[]; total?: number }>(
				`/api/admin/users?${params}`,
				{ signal },
			),
			requestJson<{ roles?: RoleItem[] }>("/api/admin/roles", { signal }),
		]);
		users = Array.isArray(userData.users)
			? userData.users.map(toAdminUser)
			: [];
		total = Number(userData.total ?? 0);
		roles = Array.isArray(roleData.roles) ? roleData.roles : [];
		// Total menyusut (mis. hapus di halaman terakhir): jepit ke halaman valid.
		const maxPage = Math.max(1, Math.ceil(total / limit));
		if (page > maxPage) page = maxPage;
	} catch (cause) {
		if ((cause as Error)?.name === "AbortError") return;
		error =
			cause instanceof Error ? cause.message : "Data pengguna gagal dimuat.";
	} finally {
		loading = false;
	}
}

function discardPreviews() {
	if (avatarPreview) URL.revokeObjectURL(avatarPreview);
	if (headerPreview) URL.revokeObjectURL(headerPreview);
	avatarPreview = null;
	headerPreview = null;
}

function openEdit(user: AdminUser) {
	discardPreviews();
	editing = user;
	editRole = user.role;
	editName = user.name;
	avatarFile = null;
	headerFile = null;
	avatarRemoved = false;
	headerRemoved = false;
	editError = "";
	error = "";
	message = "";
}

function closeEdit() {
	discardPreviews();
	editing = null;
	avatarFile = null;
	headerFile = null;
	editBusy = false;
	editError = "";
}

function pickAvatar(event: Event) {
	const file = (event.currentTarget as HTMLInputElement).files?.[0];
	(event.currentTarget as HTMLInputElement).value = "";
	if (!file) return;
	if (!file.type.startsWith("image/")) {
		editError = "File avatar harus gambar.";
		return;
	}
	if (avatarPreview) URL.revokeObjectURL(avatarPreview);
	avatarFile = file;
	avatarRemoved = false;
	avatarPreview = URL.createObjectURL(file);
}

function pickHeader(event: Event) {
	const file = (event.currentTarget as HTMLInputElement).files?.[0];
	(event.currentTarget as HTMLInputElement).value = "";
	if (!file) return;
	if (!file.type.startsWith("image/")) {
		editError = "File banner harus gambar.";
		return;
	}
	if (headerPreview) URL.revokeObjectURL(headerPreview);
	headerFile = file;
	headerRemoved = false;
	headerPreview = URL.createObjectURL(file);
}

async function uploadMedia(
	userId: string,
	kind: "avatar" | "header",
	file: File,
): Promise<string> {
	const form = new FormData();
	form.append("file", file, file.name || `${kind}.jpg`);
	const response = await fetch(
		`${apiBase()}/api/admin/users/${encodeURIComponent(userId)}/${kind}`,
		{ method: "POST", credentials: "include", body: form },
	);
	const payload = (await response.json().catch(() => ({}))) as {
		url?: unknown;
		error?: unknown;
	};
	if (!response.ok) {
		throw new Error(
			typeof payload.error === "string" && payload.error
				? payload.error
				: "Unggahan gambar gagal.",
		);
	}
	if (typeof payload.url !== "string" || !payload.url)
		throw new Error("Respons server tidak valid.");
	return payload.url;
}

async function saveEdit() {
	if (!editing || editBusy) return;
	const name = editName.trim();
	if (!name) {
		editError = "Nama wajib diisi.";
		return;
	}
	editBusy = true;
	editError = "";
	try {
		let image: string | null | undefined;
		let headerImage: string | null | undefined;
		if (avatarFile) image = await uploadMedia(editing.id, "avatar", avatarFile);
		else if (avatarRemoved) image = null;
		if (headerFile)
			headerImage = await uploadMedia(editing.id, "header", headerFile);
		else if (headerRemoved) headerImage = null;
		const patch: Record<string, unknown> = {};
		if (name !== editing.name) patch.name = name;
		if (image !== undefined) patch.image = image;
		if (headerImage !== undefined) patch.headerImage = headerImage;
		if (Object.keys(patch).length > 0) {
			await requestJson(`/api/admin/users/${encodeURIComponent(editing.id)}`, {
				method: "PATCH",
				body: JSON.stringify(patch),
			});
		}
		if (editRole !== editing.role) {
			await requestJson(
				`/api/admin/users/${encodeURIComponent(editing.id)}/role`,
				{ method: "PATCH", body: JSON.stringify({ role: editRole }) },
			);
		}
		message = "Data pengguna diperbarui.";
		const done = editing;
		closeEdit();
		await load();
		void done;
	} catch (cause) {
		editError =
			cause instanceof Error ? cause.message : "Data gagal diperbarui.";
	} finally {
		editBusy = false;
	}
}

async function deleteUser() {
	if (!deleting) return;
	busy = `${deleting.id}:delete`;
	error = "";
	message = "";
	try {
		await requestJson(`/api/admin/users/${encodeURIComponent(deleting.id)}`, {
			method: "DELETE",
		});
		message = "Pengguna dihapus.";
		deleting = null;
		if (page > 1 && users.length === 1) page -= 1;
		else await load();
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "Pengguna gagal dihapus.";
	} finally {
		busy = "";
	}
}

function submitSearch(event: SubmitEvent) {
	event.preventDefault();
	page = 1;
	query = search;
}

$effect(() => {
	page;
	query;
	const controller = new AbortController();
	void load(controller.signal);
	return () => controller.abort();
});
</script>

{#if error}
	<p
		role="alert"
		class="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm"
	>
		{error}
	</p>
{/if}
{#if message}
	<p
		role="status"
		class="mb-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-primary text-sm"
	>
		{message}
	</p>
{/if}
<section class="rounded-3xl border bg-card p-4 sm:p-6">
	<div class="mb-4 flex justify-end">
		<form onsubmit={submitSearch} class="flex w-full gap-2 sm:w-auto">
			<label class="relative min-w-0 flex-1 sm:w-72">
				<span class="sr-only">Cari pengguna</span>
				<input
					bind:value={search}
					placeholder="Cari nama atau email"
					class="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
				/>
			</label>
			<button
				class="h-10 rounded-xl bg-primary px-4 font-bold text-primary-foreground text-sm"
			>
				Cari
			</button>
		</form>
	</div>
	<div class="overflow-x-auto">
		<table class="w-full min-w-[640px] text-left text-sm">
			<thead>
				<tr
					class="border-b text-muted-foreground text-xs uppercase tracking-wide"
				>
					<th class="px-3 py-3">Pengguna</th>
					<th class="px-3 py-3">Role</th>
					<th class="hidden px-3 py-3 sm:table-cell">Aktivitas terakhir</th>
					<th class="px-3 py-3 text-right">Aksi</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					{#each Array.from({ length: 5 }, (_, index) => index) as index (index)}
						<tr class="border-b last:border-0" aria-hidden="true">
							<td class="px-3 py-3">
								<div class="flex items-center gap-3">
									<div
										class="size-10 shrink-0 animate-pulse rounded-full bg-secondary"
									></div>
									<div class="min-w-0 flex-1 space-y-2">
										<div class="h-4 w-36 max-w-full animate-pulse rounded bg-secondary"></div>
										<div class="h-3 w-48 max-w-full animate-pulse rounded bg-secondary"></div>
									</div>
								</div>
							</td>
							<td class="px-3 py-3">
								<div class="h-4 w-20 animate-pulse rounded bg-secondary"></div>
							</td>
							<td class="hidden px-3 py-3 sm:table-cell">
								<div class="h-4 w-24 animate-pulse rounded bg-secondary"></div>
							</td>
							<td class="px-3 py-3">
								<div
									class="ml-auto h-8 w-16 animate-pulse rounded-lg bg-secondary"
								></div>
							</td>
						</tr>
					{/each}
				{:else if users.length === 0}
					<tr>
						<td colspan={4} class="px-3 py-10 text-center text-muted-foreground">
							Belum ada akun.
						</td>
					</tr>
				{:else}
					{#each users as user (user.id)}
						<tr class="border-b border-border/70 last:border-0">
							<td class="px-3 py-3">
								<div class="flex items-center gap-3">
									{#if user.image}
										<img
											src={resolveMediaUrl(user.image)}
											alt=""
											referrerpolicy="no-referrer"
											class="size-10 rounded-full bg-secondary object-cover"
										/>
									{:else}
										<span
											class="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground"
											aria-hidden="true"
										>
											●
										</span>
									{/if}
									<div class="min-w-0">
										<p class="truncate font-semibold">
											{user.name || "Tanpa nama"}
										</p>
										<p class="truncate text-muted-foreground text-xs">
											{user.email}
										</p>
										<p
											class="mt-0.5 truncate text-muted-foreground text-[11px] sm:hidden"
											title={formatFullDate(user.lastActiveAt)}
										>
											Aktif {formatLastActive(user.lastActiveAt)}
										</p>
									</div>
								</div>
							</td>
							<td class="px-3 py-3">
								<span class="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">
									{roles.find((role) => role.key === user.role)?.label ?? user.role}
								</span>
							</td>
							<td
								class="hidden px-3 py-3 text-muted-foreground text-xs sm:table-cell"
								title={formatFullDate(user.lastActiveAt)}
							>
								{formatLastActive(user.lastActiveAt)}
							</td>
							<td class="px-3 py-3 text-right">
								<div class="inline-flex items-center gap-2">
									<button
										type="button"
										disabled={Boolean(busy)}
										onclick={() => openEdit(user)}
										class="inline-flex h-9 items-center rounded-lg border border-border px-3 font-semibold text-xs hover:bg-secondary disabled:opacity-50"
									>
										Edit
									</button>
									<button
										type="button"
										disabled={Boolean(busy)}
										onclick={() => {
											deleting = user;
											error = "";
											message = "";
										}}
										class="inline-flex h-9 items-center rounded-lg border border-destructive/30 px-3 font-semibold text-destructive text-xs hover:bg-destructive/10 disabled:opacity-50"
									>
										Hapus
									</button>
								</div>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
	<div
		class="mt-4 border-t pt-4 text-center text-muted-foreground text-xs"
	>
		<span>
			{total === 0
				? "0 pengguna"
				: `${offset + 1}–${Math.min(offset + users.length, total)} dari ${total}`}
		</span>
	</div>
	<Pagination {page} {pageCount} {loading} onChange={(next) => (page = next)} />
</section>

{#if editing}
	{@const avatarSrc = avatarPreview ?? (avatarRemoved ? null : resolveMediaUrl(editing.image))}
	{@const headerSrc = headerPreview ?? (headerRemoved ? null : resolveMediaUrl(editing.headerImage))}
	<div
		role="presentation"
		onmousedown={(event) => {
			if (event.target === event.currentTarget) closeEdit();
		}}
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="edit-user-title"
			class="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border bg-card p-5 shadow-2xl"
		>
			<h2 id="edit-user-title" class="font-bold text-lg">Edit pengguna</h2>
			{#if editError}
				<p
					role="alert"
					class="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm"
				>
					{editError}
				</p>
			{/if}
			<label class="mt-4 block">
				<span class="mb-1.5 block text-muted-foreground text-xs">Nama</span>
				<input
					bind:value={editName}
					maxlength={120}
					placeholder="Nama pengguna"
					class="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
				/>
			</label>
			<div class="mt-3">
				<span class="mb-1.5 block text-muted-foreground text-xs">Email</span>
				<input
					value={editing.email}
					disabled
					readonly
					title="Email tidak dapat diubah dari panel admin"
					class="h-10 w-full cursor-not-allowed rounded-xl border border-input bg-secondary/60 px-3 text-muted-foreground text-sm outline-none"
				/>
				<p class="mt-1 text-muted-foreground text-[11px]">
					Email read-only — pergantian email dikelola alur verifikasi better-auth.
				</p>
			</div>
			<div class="mt-4 grid gap-3">
				<div>
					<span class="mb-1.5 block text-muted-foreground text-xs">Foto profil</span>
					<div class="flex items-center gap-3">
						{#if avatarSrc}
							<img
								src={avatarSrc}
								alt="Pratinjau foto profil"
								referrerpolicy="no-referrer"
								class="size-14 shrink-0 rounded-full bg-secondary object-cover"
							/>
						{:else}
							<span
								class="grid size-14 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground"
								aria-hidden="true"
							>
								●
							</span>
						{/if}
						<div class="flex flex-wrap gap-2">
							<input
								bind:this={avatarInput}
								type="file"
								accept="image/jpeg,image/png,image/webp"
								class="hidden"
								onchange={pickAvatar}
							/>
							<button
								type="button"
								onclick={() => avatarInput?.click()}
								class="inline-flex h-9 items-center rounded-lg border border-border px-3 font-semibold text-xs hover:bg-secondary"
							>
								Unggah
							</button>
							{#if avatarSrc}
								<button
									type="button"
									onclick={() => {
										if (avatarPreview) URL.revokeObjectURL(avatarPreview);
										avatarPreview = null;
										avatarFile = null;
										avatarRemoved = true;
									}}
									class="inline-flex h-9 items-center rounded-lg border border-destructive/30 px-3 font-semibold text-destructive text-xs hover:bg-destructive/10"
								>
									Hapus
								</button>
							{/if}
						</div>
					</div>
				</div>
				<div>
					<span class="mb-1.5 block text-muted-foreground text-xs">Banner / header</span>
					{#if headerSrc}
						<img
							src={headerSrc}
							alt="Pratinjau banner profil"
							referrerpolicy="no-referrer"
							class="aspect-[3/1] w-full rounded-2xl border bg-secondary object-cover"
						/>
					{:else}
						<div
							class="grid aspect-[3/1] w-full place-items-center rounded-2xl border border-dashed bg-secondary/50 text-muted-foreground text-xs"
						>
							Tanpa banner
						</div>
					{/if}
					<div class="mt-2 flex flex-wrap gap-2">
						<input
							bind:this={headerInput}
							type="file"
							accept="image/jpeg,image/png,image/webp"
							class="hidden"
							onchange={pickHeader}
						/>
						<button
							type="button"
							onclick={() => headerInput?.click()}
							class="inline-flex h-9 items-center rounded-lg border border-border px-3 font-semibold text-xs hover:bg-secondary"
						>
							Unggah
						</button>
						{#if headerSrc}
							<button
								type="button"
								onclick={() => {
									if (headerPreview) URL.revokeObjectURL(headerPreview);
									headerPreview = null;
									headerFile = null;
									headerRemoved = true;
								}}
								class="inline-flex h-9 items-center rounded-lg border border-destructive/30 px-3 font-semibold text-destructive text-xs hover:bg-destructive/10"
							>
								Hapus
							</button>
						{/if}
					</div>
				</div>
			</div>
			<label class="mt-4 block">
				<span class="mb-1.5 block text-muted-foreground text-xs">Role</span>
				<Select
					value={editRole}
					options={roles.map((role) => ({ value: role.key, label: role.label }))}
					ariaLabel="Role pengguna"
					onChange={(value) => (editRole = value)}
				/>
			</label>
			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					onclick={closeEdit}
					class="h-10 rounded-xl border border-border px-4 font-semibold text-sm"
				>
					Batal
				</button>
				<button
					type="button"
					disabled={editBusy}
					onclick={() => void saveEdit()}
					class="h-10 rounded-xl bg-primary px-4 font-bold text-primary-foreground text-sm disabled:opacity-50"
				>
					{editBusy ? "Menyimpan…" : "Simpan"}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if deleting}
	<div
		role="presentation"
		onmousedown={(event) => {
			if (event.target === event.currentTarget) deleting = null;
		}}
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-user-title"
			class="w-full max-w-sm rounded-3xl border bg-card p-5 shadow-2xl"
		>
			<h2 id="delete-user-title" class="font-bold text-lg">Hapus pengguna?</h2>
			<p class="mt-1 break-words text-muted-foreground text-sm">
				{deleting.email} akan dihapus permanen beserta sesinya.
			</p>
			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (deleting = null)}
					class="h-10 rounded-xl border border-border px-4 font-semibold text-sm"
				>
					Batal
				</button>
				<button
					type="button"
					disabled={Boolean(busy)}
					onclick={() => void deleteUser()}
					class="h-10 rounded-xl bg-destructive px-4 font-bold text-destructive-foreground text-sm disabled:opacity-50"
				>
					{busy ? "Menghapus…" : "Hapus"}
				</button>
			</div>
		</div>
	</div>
{/if}
