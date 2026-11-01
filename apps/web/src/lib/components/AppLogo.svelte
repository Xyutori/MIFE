<script lang="ts">
/**
 * AppLogo — brand-mark MIFE dari file logo kanonis.
 *
 * Props:
 * - `size`: tinggi/lebar kotak logo (px atau string CSS, default 32)
 * - `withWordmark`: tampilkan tulisan "MIFE" di samping logo (default true)
 * - `rounded`: radius sudut logo (string CSS, default "0.75rem")
 * - `alt`: teks alternatif logo (default "MIFE")
 */
let {
	size = 32,
	withWordmark = true,
	rounded = "0.75rem",
	alt = "MIFE",
}: {
	size?: number | string;
	withWordmark?: boolean;
	rounded?: string;
	alt?: string;
} = $props();

const dimension = $derived(typeof size === "number" ? `${size}px` : size);
</script>

<span class="app-logo" style:gap={withWordmark ? undefined : "0"}>
	<img
		src="/logo/mife-mark.png"
		{alt}
		width="512"
		height="512"
		draggable="false"
		style:width={dimension}
		style:height={dimension}
		style:border-radius={rounded}
	/>
	{#if withWordmark}
		<span class="app-logo-wordmark" aria-hidden="true">MIFE</span>
	{/if}
</span>

<style>
	.app-logo {
		display: inline-flex;
		align-items: center;
		gap: 0.65rem;
	}

	.app-logo img {
		display: block;
		flex: none;
		object-fit: cover;
		background: #000;
	}

	.app-logo-wordmark {
		font-family: "Bricolage Grotesque", "DM Sans", sans-serif;
		font-size: 1.1rem;
		font-weight: 800;
		letter-spacing: -0.04em;
	}
</style>
