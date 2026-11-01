<script lang="ts">
	import { type PermissionItem, type RoleItem, requestJson } from "#lib/admin.ts";
	import ErrorState from "#lib/components/admin/ErrorState.svelte";

	type RoleRow = RoleItem & { members?: number };

	let roles = $state<RoleRow[]>([]);
	let permissions = $state<PermissionItem[]>([]);
	let selected = $state("");
	let loading = $state(true);
	let error = $state("");
	let message = $state("");
	let editing = $state(false);
	let editLabel = $state("");
	let editDescription = $state("");
	let editPermissions = $state<string[]>([]);
	let saving = $state(false);
	let editError = $state("");

	const active = $derived(
		roles.find((role) => role.key === selected) ?? roles[0] ?? null,
	);

	const activePermissions = $derived.by(() => {
		const fromRole = active?.permissions;
		if (fromRole && fromRole.length > 0) return fromRole;
		if (active?.key === "admin")
			return permissions.map((item) => ({ key: item.key, label: item.label }));
		return [];
	});

	async function load(signal?: AbortSignal) {
		loading = true;
		error = "";
		try {
			const [roleData, permissionData] = await Promise.all([
				requestJson<{ roles?: RoleRow[] }>("/api/admin/roles", { signal }),
				requestJson<{ permissions?: PermissionItem[] }>(
					"/api/admin/permissions",
					{ signal },
				),
			]);
			const list = Array.isArray(roleData.roles) ? roleData.roles : [];
			roles = list;
			permissions = Array.isArray(permissionData.permissions)
				? permissionData.permissions
				: [];
			if (!list.some((role) => role.key === selected) && list[0]) {
				selected = list[0].key;
			}
		} catch (cause) {
			if ((cause as Error)?.name === "AbortError") return;
			error = cause instanceof Error ? cause.message : "Role gagal dimuat.";
		} finally {
			loading = false;
		}
	}

	function openEdit() {
		if (!active) return;
		editLabel = active.label;
		editDescription = active.description ?? "";
		const granted = new Set((active.permissions ?? []).map((p) => p.key));
		// Admin selalu memegang semua permission (bypass di server);
		// tampilkan centang penuh agar tidak menyesatkan.
		editPermissions =
			active.key === "admin" && granted.size === 0
				? permissions.map((p) => p.key)
				: permissions.map((p) => p.key).filter((key) => granted.has(key));
		editError = "";
		editing = true;
	}

	function togglePermission(key: string) {
		editPermissions = editPermissions.includes(key)
			? editPermissions.filter((item) => item !== key)
			: [...editPermissions, key];
	}

	async function saveEdit() {
		if (!active || saving) return;
		const label = editLabel.trim();
		if (!label) {
			editError = "Label role wajib diisi.";
			return;
		}
		saving = true;
		editError = "";
		try {
			await requestJson(`/api/admin/roles/${encodeURIComponent(active.key)}`, {
				method: "PATCH",
				body: JSON.stringify({
					label,
					description: editDescription.trim() ? editDescription.trim() : null,
					permissions: editPermissions,
				}),
			});
			message = "Role diperbarui.";
			editing = false;
			await load();
		} catch (cause) {
			editError =
				cause instanceof Error ? cause.message : "Role gagal diperbarui.";
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		const controller = new AbortController();
		void load(controller.signal);
		return () => controller.abort();
	});
</script>

{#if error}
	<div class="mb-4">
		<ErrorState message={error} />
	</div>
{/if}
{#if message}
	<p
		role="status"
		class="mb-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-primary text-sm"
	>
		{message}
	</p>
{/if}

<div class="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
	<section class="rounded-3xl border bg-card p-4" aria-label="Daftar role">
		<!-- Judul halaman dipegang shell di mobile: sembunyikan di mobile. -->
		<h2 class="mb-3 hidden font-bold text-lg lg:block">Role</h2>
		{#if loading}
			<div class="grid gap-2" aria-hidden="true">
				{#each [1, 2, 3] as item (item)}
					<div class="h-14 animate-pulse rounded-xl bg-secondary"></div>
				{/each}
			</div>
		{:else}
			<div class="space-y-2">
				{#each roles as role (role.key)}
					<button
						type="button"
						aria-current={selected === role.key ? "true" : undefined}
						onclick={() => {
							selected = role.key;
							message = "";
						}}
						class="w-full rounded-xl border p-3 text-left {selected === role.key
							? 'border-primary/40 bg-primary/5'
							: 'border-border'}"
					>
						<span class="block truncate font-bold text-sm">{role.label}</span>
						<span class="mt-0.5 block text-muted-foreground text-xs">
							{role.members ?? 0} anggota
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</section>

	<section class="rounded-3xl border bg-card p-5 sm:p-6" aria-label="Detail role">
		{#if loading}
			<div class="h-24 animate-pulse rounded-xl bg-secondary" aria-hidden="true"></div>
		{:else if active}
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="min-w-0">
					<p class="font-bold text-primary text-xs uppercase tracking-wider">
						{active.key}
					</p>
					<h2 class="mt-1 font-bold text-2xl">{active.label}</h2>
					{#if active.description}
						<p class="mt-1 text-muted-foreground text-sm">{active.description}</p>
					{/if}
					<p class="mt-2 text-muted-foreground text-xs">
						{active.members ?? 0} anggota
					</p>
				</div>
				<button
					type="button"
					onclick={openEdit}
					class="inline-flex h-9 shrink-0 items-center rounded-lg border border-border px-3 font-semibold text-xs hover:bg-secondary"
				>
					Edit
				</button>
			</div>
			<h3 class="mt-6 font-bold">Permission</h3>
			{#if activePermissions.length === 0}
				<p class="mt-2 text-muted-foreground text-sm">Tanpa permission.</p>
			{:else}
				<ul class="mt-3 flex flex-wrap gap-2">
					{#each activePermissions as permission (permission.key)}
						<li
							class="rounded-full border border-border bg-secondary px-3 py-1 text-xs"
							title={permission.label ?? permission.key}
						>
							{permission.label ?? permission.key}
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<p class="text-muted-foreground text-sm">Belum ada role.</p>
		{/if}
	</section>
</div>

{#if editing && active}
	<div
		role="presentation"
		onmousedown={(event) => {
			if (event.target === event.currentTarget) editing = false;
		}}
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="edit-role-title"
			class="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border bg-card p-5 shadow-2xl"
		>
			<h2 id="edit-role-title" class="font-bold text-lg">Edit role</h2>
			<p class="mt-1 text-muted-foreground text-xs">
				Perubahan tersimpan ke database dan langsung berlaku.
			</p>
			{#if editError}
				<p
					role="alert"
					class="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm"
				>
					{editError}
				</p>
			{/if}
			<label class="mt-4 block">
				<span class="mb-1.5 block text-muted-foreground text-xs">Label</span>
				<input
					bind:value={editLabel}
					maxlength={120}
					placeholder="Nama role"
					class="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
				/>
			</label>
			<label class="mt-3 block">
				<span class="mb-1.5 block text-muted-foreground text-xs">Deskripsi</span>
				<textarea
					bind:value={editDescription}
					rows={2}
					maxlength={500}
					placeholder="Deskripsi singkat role"
					class="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
				></textarea>
			</label>
			<fieldset class="mt-4">
				<legend class="font-semibold text-sm">Permission</legend>
				<div class="mt-2 grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-border/70 p-2">
					{#each permissions as permission (permission.key)}
						<label
							class="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-secondary"
						>
							<input
								type="checkbox"
								checked={editPermissions.includes(permission.key)}
								onchange={() => togglePermission(permission.key)}
								class="mt-0.5 size-4 shrink-0 accent-primary"
							/>
							<span class="min-w-0">
								<span class="block font-medium">{permission.label}</span>
								{#if permission.description}
									<span class="block text-muted-foreground text-xs">{permission.description}</span>
								{/if}
								<span class="block font-mono text-muted-foreground text-[11px]">{permission.key}</span>
							</span>
						</label>
					{/each}
				</div>
			</fieldset>
			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (editing = false)}
					class="h-10 rounded-xl border border-border px-4 font-semibold text-sm"
				>
					Batal
				</button>
				<button
					type="button"
					disabled={saving}
					onclick={() => void saveEdit()}
					class="h-10 rounded-xl bg-primary px-4 font-bold text-primary-foreground text-sm disabled:opacity-50"
				>
					{saving ? "Menyimpan…" : "Simpan"}
				</button>
			</div>
		</div>
	</div>
{/if}
