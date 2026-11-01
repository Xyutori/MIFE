<script lang="ts">
import { LayoutGrid, List } from "lucide-svelte";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "#lib/components/ui/toggle-group/index.js";

interface Props {
	value?: "grid" | "list";
}

let { value = $bindable("grid") }: Props = $props();
</script>

<ToggleGroup
	type="single"
	value={value}
	onValueChange={(next) => {
		if (next === "grid" || next === "list") value = next;
	}}
	aria-label="Tampilan"
>
	<ToggleGroupItem value="grid" aria-label="Tampilan grid">
		<LayoutGrid class="size-4" />
	</ToggleGroupItem>
	<ToggleGroupItem value="list" aria-label="Tampilan list">
		<List class="size-4" />
	</ToggleGroupItem>
</ToggleGroup>
