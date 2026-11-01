<script lang="ts">
import AdminNotice from "#lib/components/admin/AdminNotice.svelte";

export type AdminSourceField = "baseUrl" | "prefix" | "requestDelayMs";

interface Props {
	id: string;
	name: string;
	baseUrl: string;
	prefix: string;
	requestDelayMs: number;
	enabled: boolean;
	busy?: boolean;
	minimumDelay?: number;
	note?: string | null;
	enableDisabledReason?: string;
	onFieldChange: (field: AdminSourceField, value: string) => void;
	onEnabledChange?: (enabled: boolean) => void;
	onSubmit: (event: SubmitEvent) => void;
}

let {
	id,
	name,
	baseUrl,
	prefix,
	requestDelayMs,
	enabled,
	busy = false,
	minimumDelay = 250,
	note,
	enableDisabledReason,
	onFieldChange,
	onEnabledChange,
	onSubmit,
}: Props = $props();

const inputId = (field: AdminSourceField) => `${id}-${field}`;
</script>

<form
	onsubmit={onSubmit}
	class="rounded-2xl border border-border/70 bg-background/60 p-4"
	aria-label={`Konfigurasi sumber ${name}`}
>
	<div class="mb-4 flex items-center justify-between gap-3">
		<p class="min-w-0 truncate font-semibold text-sm">{name}</p>
		{#if onEnabledChange}
			<label class="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
				<input
					type="checkbox"
					checked={enabled}
					disabled={!enabled && Boolean(enableDisabledReason)}
					onchange={(event) => onEnabledChange(event.currentTarget.checked)}
					class="size-4 accent-primary"
				/>
				Aktif
			</label>
		{:else}
			<span
				class="shrink-0 rounded-full border border-border bg-secondary px-2.5 py-1 text-muted-foreground text-[11px]"
			>
				{enabled ? "Aktif" : "Nonaktif"}
			</span>
		{/if}
	</div>

	<label class="mb-1.5 block text-muted-foreground text-xs" for={inputId("baseUrl")}>
		Base URL
	</label>
	<input
		id={inputId("baseUrl")}
		value={baseUrl}
		oninput={(event) => onFieldChange("baseUrl", event.currentTarget.value)}
		autocomplete="url"
		class="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
	/>

	<div class="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(6rem,7.5rem)] gap-3">
		<div>
			<label class="mb-1.5 block text-muted-foreground text-xs" for={inputId("prefix")}>
				Prefix
			</label>
			<input
				id={inputId("prefix")}
				value={prefix}
				oninput={(event) => onFieldChange("prefix", event.currentTarget.value)}
				placeholder="/v1"
				class="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
			/>
		</div>
		<div>
			<label class="mb-1.5 block text-muted-foreground text-xs" for={inputId("requestDelayMs")}>
				Jeda · ms
			</label>
			<input
				id={inputId("requestDelayMs")}
				type="number"
				min={minimumDelay}
				max={30000}
				step={100}
				value={requestDelayMs}
				oninput={(event) => onFieldChange("requestDelayMs", event.currentTarget.value)}
				class="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
			/>
		</div>
	</div>

	{#if enableDisabledReason}
		<div class="mt-3">
			<AdminNotice tone="warning">Aktivasi diblokir: {enableDisabledReason}</AdminNotice>
		</div>
	{/if}
	{#if note}
		<div class="mt-3">
			<AdminNotice tone="warning">{note}</AdminNotice>
		</div>
	{/if}

	<button
		type="submit"
		disabled={busy}
		class="mt-4 inline-flex h-9 items-center rounded-lg bg-secondary px-4 font-semibold text-secondary-foreground text-sm disabled:opacity-50"
	>
		{busy ? "Menyimpan…" : "Simpan sumber"}
	</button>
</form>
