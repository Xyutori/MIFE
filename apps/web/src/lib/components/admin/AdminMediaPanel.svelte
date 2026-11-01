<script lang="ts">
import { type AdminMediaItem, apiBase, requestJson } from "#lib/admin.ts";
import ErrorState from "#lib/components/admin/ErrorState.svelte";
import Pagination from "#lib/components/Pagination.svelte";

const pageSize = 24;

type MediaAssetRow = {
	id: string;
	assetType: string | null;
	ownerType: string | null;
	ownerId: string | null;
	externalUrl: string;
	contentType: string | null;
	byteSize: number | null;
};

let items = $state<AdminMediaItem[]>([]);
let page = $state(1);
let total = $state(0);
let selected = $state<AdminMediaItem | null>(null);
let loading = $state(true);
let error = $state("");

const api = apiBase();
const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));

function absoluteMediaUrl(value: string): string {
	try {
		return new URL(value, api).toString();
	} catch {
		return value;
	}
}

function mediaLabel(item: AdminMediaItem): string {
	const labels: Record<string, string> = {
		profile_avatar: "Avatar",
		profile_header: "Header profil",
		bookmark_group_cover: "Sampul bookmark",
		comic_cover: "Sampul komik",
	};
	return (
		labels[item.type ?? ""] ??
		item.category ??
		item.kind ??
		item.type ??
		"Media"
	);
}

async function load(signal?: AbortSignal) {
	loading = true;
	error = "";
	try {
		const params = new URLSearchParams({
			limit: String(pageSize),
			offset: String((page - 1) * pageSize),
		});
		const payload = await requestJson<{
			assets?: MediaAssetRow[];
			total?: number;
		}>(`/api/admin/media?${params}`, { signal });
		items = (payload.assets ?? []).map(
			(asset): AdminMediaItem => ({
				id: asset.id,
				type: asset.assetType ?? undefined,
				category: asset.ownerType ?? undefined,
				ownerUserId: asset.ownerId ?? undefined,
				url: asset.externalUrl,
				downloadUrl: asset.externalUrl,
				contentType: asset.contentType ?? undefined,
				byteSize: asset.byteSize,
			}),
		);
		total = Number(payload.total ?? 0);
		const maxPage = Math.max(1, Math.ceil(total / pageSize));
		if (page > maxPage) page = maxPage;
	} catch (cause) {
		if ((cause as Error)?.name === "AbortError") return;
		error = cause instanceof Error ? cause.message : "Media gagal dimuat.";
	} finally {
		loading = false;
	}
}

$effect(() => {
	page;
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

<section class="rounded-3xl border bg-card p-4 sm:p-5" aria-label="Media">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<!-- Judul halaman dipegang shell di mobile: sembunyikan di mobile. -->
		<h2 class="hidden font-bold text-lg lg:block">Media</h2>
		<p class="text-muted-foreground text-xs">
			{total.toLocaleString("id-ID")} aset
		</p>
	</div>

	{#if loading}
		<div
			class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
			aria-hidden="true"
		>
			{#each Array.from({ length: 8 }, (_, index) => index) as index (index)}
				<div class="aspect-[.9] animate-pulse rounded-2xl bg-secondary"></div>
			{/each}
		</div>
	{:else if items.length === 0}
		<p class="mt-5 rounded-2xl border border-dashed p-12 text-center text-muted-foreground text-sm">
			Tidak ada media.
		</p>
	{:else}
		<div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each items as item (item.id)}
				{@const owner = item.ownerUserId ?? "Media"}
				<article
					class="overflow-hidden rounded-2xl border bg-background/60"
				>
					<button
						type="button"
						aria-label={`Pratinjau ${owner}`}
						onclick={() => (selected = item)}
						class="group relative block aspect-[1.18] w-full overflow-hidden bg-secondary"
					>
						<img
							src={absoluteMediaUrl(item.url)}
							alt=""
							loading="lazy"
							class="h-full w-full object-cover transition group-hover:scale-[1.03]"
						/>
					</button>
					<div class="p-3">
						<p class="truncate font-bold text-sm">{owner}</p>
						<p class="mt-1 truncate text-muted-foreground text-xs">
							{mediaLabel(item)}
						</p>
					</div>
				</article>
			{/each}
		</div>
	{/if}

	<div
		class="mt-5 border-t pt-4 text-center text-muted-foreground text-xs"
	>
		<span>Halaman {page} dari {pages} · {total.toLocaleString("id-ID")} aset</span>
	</div>
	<Pagination {page} pageCount={pages} {loading} onChange={(next) => (page = next)} />
</section>

{#if selected}
	<div
		role="presentation"
		onmousedown={(event) => {
			if (event.target === event.currentTarget) selected = null;
		}}
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Pratinjau media"
			class="w-full max-w-3xl overflow-hidden rounded-3xl border bg-card shadow-2xl"
		>
			<div class="flex justify-end p-3">
				<button
					type="button"
					onclick={() => (selected = null)}
					class="rounded-lg border border-border px-3 py-1.5 font-semibold text-xs"
				>
					Tutup
				</button>
			</div>
			<div class="max-h-[65vh] bg-background">
				<img
					src={absoluteMediaUrl(selected.url)}
					alt=""
					class="mx-auto max-h-[65vh] max-w-full object-contain"
				/>
			</div>
		</div>
	</div>
{/if}
