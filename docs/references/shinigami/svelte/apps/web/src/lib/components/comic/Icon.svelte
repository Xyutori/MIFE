<script lang="ts">
/**
 * Minimal inline SVG icon set (lucide-style paths, stroke-based).
 * Dependency-free stand-in until `lucide-svelte` is added by the
 * foundation lane. All artwork is static — no `{@html}` anywhere.
 */

export type IconName =
	| "arrow-left"
	| "arrow-right"
	| "bookmark"
	| "chevron-down"
	| "chevron-left"
	| "chevron-right"
	| "clock"
	| "eye"
	| "flag"
	| "image-off"
	| "info"
	| "list"
	| "log-in"
	| "megaphone"
	| "message-circle"
	| "reply"
	| "send"
	| "star"
	| "thumbs-up"
	| "triangle-alert"
	| "x";

interface Props {
	name: IconName;
	size?: number;
	class?: string;
}

let { name, size = 16, class: cls = "" }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={cls}
	aria-hidden="true"
>
	{#if name === "arrow-left"}
		<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
	{:else if name === "arrow-right"}
		<path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
	{:else if name === "bookmark"}
		<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
	{:else if name === "chevron-down"}
		<path d="m6 9 6 6 6-6" />
	{:else if name === "chevron-left"}
		<path d="m15 18-6-6 6-6" />
	{:else if name === "chevron-right"}
		<path d="m9 18 6-6-6-6" />
	{:else if name === "clock"}
		<circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
	{:else if name === "eye"}
		<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
	{:else if name === "flag"}
		<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" x2="4" y1="22" y2="15" />
	{:else if name === "image-off"}
		<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path
			d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
		 /><line x1="2" x2="22" y1="2" y2="22" />
	{:else if name === "info"}
		<circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
	{:else if name === "list"}
		<line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line
			x1="8"
			x2="21"
			y1="18"
			y2="18"
		/><line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line
			x1="3"
			x2="3.01"
			y1="18"
			y2="18"
		/>
	{:else if name === "log-in"}
		<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line
			x1="15"
			x2="3"
			y1="12"
			y2="12"
		/>
	{:else if name === "megaphone"}
		<path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
	{:else if name === "message-circle"}
		<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
	{:else if name === "reply"}
		<polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
	{:else if name === "send"}
		<path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
	{:else if name === "star"}
		<polygon
			points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
		/>
	{:else if name === "thumbs-up"}
		<path d="M7 10v12" /><path
			d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
		/>
	{:else if name === "triangle-alert"}
		<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path
			d="M12 9v4"
		/><path d="M12 17h.01" />
	{:else if name === "x"}
		<path d="M18 6 6 18" /><path d="m6 6 12 12" />
	{/if}
</svg>
