<script lang="ts">
import type { MediaSummary } from "#lib/admin.ts";
import AdminPanel from "#lib/components/admin/AdminPanel.svelte";
import AdminStatCard from "#lib/components/admin/AdminStatCard.svelte";

interface Props {
	mediaSummary: MediaSummary | null;
	pendingMedia: number | null;
	showStats?: boolean;
	showByType?: boolean;
}

let { mediaSummary, pendingMedia, showStats = true, showByType = true }: Props = $props();

const fmt = (value: number) => value.toLocaleString("id-ID");
const prettyKey = (key: string) => key.replaceAll("_", " ");

const statusColumns = [
	"total",
	"detected",
	"pending",
	"downloading",
	"healthy",
	"verifyDue",
	"repairing",
	"missing",
	"corrupt",
	"failed",
	"stale",
	"unsupported",
] as const;
</script>

{#if showStats}
<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
	<AdminStatCard
		label="Media inventaris"
		value={mediaSummary ? fmt(mediaSummary.total) : "Memuat…"}
		loading={!mediaSummary}
	/>
	<AdminStatCard
		label="Media sehat"
		value={mediaSummary ? fmt(mediaSummary.healthy) : "Memuat…"}
		loading={!mediaSummary}
	/>
	<AdminStatCard
		label="Menunggu proses"
		value={pendingMedia === null ? "Memuat…" : fmt(pendingMedia)}
		loading={pendingMedia === null}
	/>
	<AdminStatCard
		label="Perlu verifikasi berkala"
		value={mediaSummary ? fmt(mediaSummary.verifyDue) : "Memuat…"}
		loading={!mediaSummary}
	/>
	<AdminStatCard
		label="Sedang mengunduh"
		value={mediaSummary ? fmt(mediaSummary.downloading) : "Memuat…"}
		loading={!mediaSummary}
	/>
	<AdminStatCard
		label="Sedang diperbaiki"
		value={mediaSummary ? fmt(mediaSummary.repairing) : "Memuat…"}
		loading={!mediaSummary}
	/>
	<AdminStatCard
		label="Hilang atau rusak"
		value={mediaSummary ? fmt(mediaSummary.missing + mediaSummary.corrupt) : "Memuat…"}
		loading={!mediaSummary}
	/>
	<AdminStatCard
		label="Gagal / usang / tak didukung"
		value={mediaSummary
			? fmt(mediaSummary.failed + mediaSummary.stale + mediaSummary.unsupported)
			: "Memuat…"}
		loading={!mediaSummary}
	/>
</div>
{/if}

{#if mediaSummary?.disabledSources && mediaSummary.disabledSources.length > 0}
	<div class="mt-3 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm">
		<p class="font-semibold">URL dari sumber nonaktif tetap diinventaris</p>
		<ul class="mt-2 space-y-1 text-muted-foreground">
			{#each mediaSummary.disabledSources as source (source.sourceKey)}
				<li>
					<span class="font-medium text-foreground">{source.sourceName}</span>
					: {source.reason}
				</li>
			{/each}
		</ul>
	</div>
{/if}

{#if showByType}
<AdminPanel
	title="Status menurut jenis media"
	description="Ringkasan inventaris dan pemeriksaan integritas untuk seluruh URL yang diketahui."
>
	<div class="overflow-x-auto">
		<table class="w-full min-w-[920px] text-left text-xs">
			<thead class="border-border border-b bg-secondary/40 text-muted-foreground">
				<tr>
					<th scope="col" class="sticky left-0 bg-secondary/95 px-4 py-3 font-semibold">
						Jenis media
					</th>
					{#each statusColumns as column (column)}
						<th scope="col" class="px-3 py-3 text-right font-semibold">
							{prettyKey(column)}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each Object.entries(mediaSummary?.byType ?? {}).sort( ([a], [b]) => a.localeCompare(b), ) as entry (entry[0])}
					{@const assetType = entry[0]}
					{@const counts = entry[1] as Record<string, number>}
					<tr class="border-border/70 border-b last:border-0">
						<th scope="row" class="sticky left-0 bg-card px-4 py-3 font-semibold">
							{prettyKey(assetType)}
						</th>
						{#each statusColumns as column (column)}
							<td class="px-3 py-3 text-right tabular-nums">
								{fmt(Number(counts[column] ?? 0))}
							</td>
						{/each}
					</tr>
				{:else}
					<tr>
						<td colspan={statusColumns.length + 1} class="px-4 py-5 text-center text-muted-foreground">
							{mediaSummary ? "Belum ada inventaris media." : "Memuat status media…"}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</AdminPanel>
{/if}
