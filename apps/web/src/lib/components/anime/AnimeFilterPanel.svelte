<script lang="ts">
import GenreMultiSelect from "#lib/components/ui/combobox/GenreMultiSelect.svelte";
import Select from "#lib/components/ui/select/Select.svelte";

interface Props {
	sort: string;
	genre: string;
	status: string;
	onSortChange: (value: string) => void;
	onGenreChange: (value: string) => void;
	onStatusChange: (value: string) => void;
	onReset: () => void;
}

let {
	sort,
	genre,
	status,
	onSortChange,
	onGenreChange,
	onStatusChange,
	onReset,
}: Props = $props();

const SORT_OPTIONS = [
	{ value: "recent", label: "Update terbaru" },
	{ value: "title", label: "Judul A–Z" },
] as const;

// Status mengikuti nilai umum XyMI ("ongoing" / "completed").
const STATUS_OPTIONS = [
	{ value: "", label: "Semua status" },
	{ value: "ongoing", label: "Ongoing" },
	{ value: "completed", label: "Completed" },
] as const;
</script>

<div class="grid gap-4 sm:grid-cols-2">
	<div class="grid gap-2">
		<span class="font-semibold text-sm">Urutkan anime</span>
		<Select
			value={sort}
			options={SORT_OPTIONS}
			ariaLabel="Urutkan anime"
			onChange={onSortChange}
		/>
	</div>
	<div class="grid gap-2">
		<span class="font-semibold text-sm">Status</span>
		<Select
			value={status}
			options={STATUS_OPTIONS}
			ariaLabel="Status"
			onChange={onStatusChange}
		/>
	</div>
	<div class="sm:col-span-2">
		<GenreMultiSelect value={genre} workspace="anime" id="anime-genre" onChange={onGenreChange} />
	</div>
</div>

<button
	type="button"
	onclick={onReset}
	class="mt-4 text-left text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
>
	Reset filter
</button>
