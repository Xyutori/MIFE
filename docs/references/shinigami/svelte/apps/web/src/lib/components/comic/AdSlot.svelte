<script lang="ts">
import Icon from "./Icon.svelte";

interface Props {
	/**
	 * Master switch. When false nothing is rendered.
	 * Ad creative URLs are never hardcoded — pass them via props.
	 */
	enabled?: boolean;
	href?: string;
	imageSrc?: string;
	label?: string;
	class?: string;
}

let {
	enabled = true,
	href,
	imageSrc,
	label = "Advertisement",
	class: cls = "",
}: Props = $props();

let hasCreative = $derived(Boolean(href && imageSrc));
</script>

{#if enabled}
	<div class={`aspect-[16/2] w-full overflow-hidden rounded-[8px] bg-[#242424] ${cls}`}>
		{#if hasCreative}
			<a {href} target="_blank" rel="sponsored noopener" class="block h-full w-full">
				<img
					src={imageSrc}
					alt={label}
					loading="lazy"
					decoding="async"
					class="h-full w-full object-cover"
				/>
			</a>
		{:else}
			<div
				role="complementary"
				aria-label={label}
				class="flex h-full w-full items-center justify-center gap-2 border border-dashed border-white/10 text-xs text-neutral-600"
			>
				<Icon name="image-off" size={16} />
				{label}
			</div>
		{/if}
	</div>
{/if}
