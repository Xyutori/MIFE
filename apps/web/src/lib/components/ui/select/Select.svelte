<script lang="ts">
import { Select as SelectPrimitive } from "bits-ui";
import { Check, ChevronDown } from "lucide-svelte";

export interface SelectOption {
	value: string;
	label: string;
}

interface Props {
	value: string;
	options: readonly SelectOption[];
	id?: string;
	placeholder?: string;
	disabled?: boolean;
	ariaLabel?: string;
	onChange: (value: string) => void;
}

let {
	value,
	options,
	id,
	placeholder = "Pilih…",
	disabled = false,
	ariaLabel,
	onChange,
}: Props = $props();

let internal = $state(value);

$effect(() => {
	if (value !== internal) internal = value;
});

$effect(() => {
	if (internal !== value) onChange(internal);
});

const selectedLabel = $derived(
	options.find((option) => option.value === internal)?.label ?? placeholder,
);
const typeaheadItems = $derived(
	options.map((option) => ({ value: option.value, label: option.label })),
);
</script>

<SelectPrimitive.Root type="single" bind:value={internal} {disabled} items={typeaheadItems}>
	<SelectPrimitive.Trigger
		{id}
		aria-label={ariaLabel}
		class="flex h-12 w-full items-center justify-between gap-2 rounded-xl border border-border/80 bg-card px-4 text-left text-sm outline-none focus:border-primary disabled:opacity-50"
	>
		<span class={internal ? "truncate text-foreground" : "truncate text-muted-foreground"}>
			{selectedLabel}
		</span>
		<ChevronDown class="size-4 shrink-0 text-muted-foreground" />
	</SelectPrimitive.Trigger>
	<SelectPrimitive.Portal>
		<SelectPrimitive.Content
			sideOffset={6}
			class="z-50 max-h-64 min-w-36 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
		>
			{#each options as option (option.value)}
				<SelectPrimitive.Item
					value={option.value}
					label={option.label}
					class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm outline-none hover:bg-accent data-[highlighted]:bg-accent"
				>
					{#snippet children({ selected }: { selected: boolean })}
						<span class="truncate">{option.label}</span>
						{#if selected}
							<Check class="size-4 shrink-0 text-primary" />
						{/if}
					{/snippet}
				</SelectPrimitive.Item>
			{/each}
		</SelectPrimitive.Content>
	</SelectPrimitive.Portal>
</SelectPrimitive.Root>
