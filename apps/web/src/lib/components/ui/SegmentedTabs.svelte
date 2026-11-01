<script lang="ts">
export interface SegmentedTab {
	id: string;
	label: string;
}

interface Props {
	tabs: SegmentedTab[];
	value: string;
	onChange?: (id: string) => void;
	ariaLabel: string;
	class?: string;
}

let {
	tabs,
	value = $bindable(),
	onChange,
	ariaLabel,
	class: className = "",
}: Props = $props();

function select(id: string) {
	if (id === value) return;
	value = id;
	onChange?.(id);
}
</script>

<div
	role="tablist"
	aria-label={ariaLabel}
	class={`grid w-full gap-1 rounded-full border bg-card p-1 ${className}`}
	style={`grid-template-columns: repeat(${tabs.length}, minmax(0, 1fr));`}
>
	{#each tabs as tab (tab.id)}
		<button
			type="button"
			role="tab"
			id={`tab-${tab.id}`}
			aria-selected={value === tab.id}
			aria-controls={`panel-${tab.id}`}
			onclick={() => select(tab.id)}
			class={`min-h-11 rounded-full font-bold text-sm transition ${value === tab.id ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
		>
			{tab.label}
		</button>
	{/each}
</div>
