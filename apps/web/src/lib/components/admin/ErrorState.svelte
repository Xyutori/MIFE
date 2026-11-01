<script lang="ts">
interface Props {
	message: string;
	variant?: "page" | "inline";
}

let { message, variant = "inline" }: Props = $props();

// Port ringkas XyMI ErrorState + ServerRepairState: pesan koneksi/timeout
// ditampilkan sebagai status perbaikan server, sisanya sebagai alert biasa.
const isNetworkFailure = $derived(
	/tersambung|network|fetch|timeout|tidak dapat|gagal memuat/i.test(message),
);
</script>

{#if isNetworkFailure && variant === "page"}
	<div
		role="alert"
		class="flex w-full flex-col items-center justify-center px-4 py-10 text-center"
	>
		<p class="font-semibold">Server sedang diperbaiki.</p>
		<p class="mt-1 max-w-sm text-muted-foreground text-sm">{message}</p>
	</div>
{:else}
	<div
		role="alert"
		class="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm"
	>
		{message}
	</div>
{/if}
