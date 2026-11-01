<script lang="ts">
let { providerId }: { providerId: string } = $props();
</script>

{#if providerId === "google"}
	<svg aria-hidden="true" viewBox="0 0 48 48" class="size-5 shrink-0">
		<path
			fill="#4285F4"
			d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.7c3.9-3.6 6-8.8 6-14.9Z"
		/>
		<path
			fill="#34A853"
			d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.7-5c-1.8 1.2-4 2-6.8 2-5.3 0-9.8-3.6-11.4-8.4H5.7v5.2A20 20 0 0 0 24 44Z"
		/>
		<path
			fill="#FBBC05"
			d="M12.6 27.8a12 12 0 0 1 0-7.6V15H5.7a20 20 0 0 0 0 18Z"
		/>
		<path
			fill="#EA4335"
			d="M24 11.8c3 0 5.7 1 7.8 3l5.8-5.8A19.5 19.5 0 0 0 24 4 20 20 0 0 0 5.7 15l6.9 5.2c1.6-4.8 6.1-8.4 11.4-8.4Z"
		/>
	</svg>
{:else if providerId === "github"}
	<svg
		aria-hidden="true"
		viewBox="0 0 24 24"
		class="size-5 shrink-0 fill-current"
	>
		<path
			d="M12 .9a11.1 11.1 0 0 0-3.5 21.6c.6.1.8-.3.8-.6v-2.2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 1.8 2.7 1.9 3.8 1.9.1-.7.4-1.2.7-1.5-2.5-.3-5.1-1.3-5.1-5.5 0-1.2.4-2.2 1.1-3-.1-.3-.5-1.5.1-3 0 0 .9-.3 3 1.1a10.4 10.4 0 0 1 5.5 0c2.1-1.4 3-1.1 3-1.1.6 1.5.2 2.7.1 3 .7.8 1.1 1.8 1.1 3 0 4.2-2.6 5.2-5.1 5.5.4.3.8 1 .8 2v3c0 .3.2.7.8.6A11.1 11.1 0 0 0 12 .9Z"
		/>
	</svg>
{:else if providerId === "discord"}
	<svg
		aria-hidden="true"
		viewBox="0 0 24 24"
		class="size-5 shrink-0 fill-[#5865F2]"
	>
		<path
			d="M19.7 5.2a18 18 0 0 0-4.4-1.4l-.5 1a16 16 0 0 0-5.6 0l-.5-1a18 18 0 0 0-4.4 1.4C1.5 9.3.7 13.3 1.1 17.3a18 18 0 0 0 5.4 2.7l1.2-2a11 11 0 0 1-1.8-.9l.4-.3a13 13 0 0 0 11.4 0l.4.3a11 11 0 0 1-1.8.9l1.2 2a18 18 0 0 0 5.4-2.7c.5-4.6-.8-8.6-3.2-12.1ZM8.8 14.6c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"
		/>
	</svg>
{:else}
	<span
		aria-hidden="true"
		class="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-[10px] text-secondary-foreground uppercase"
	>
		{providerId.slice(0, 1)}
	</span>
{/if}
