<script lang="ts">
import GenreMultiSelect from "#lib/components/ui/combobox/GenreMultiSelect.svelte";
import Select from "#lib/components/ui/select/Select.svelte";

interface Props {
	sort: string;
	comicType: string;
	genre: string;
	status: string;
	onSortChange: (value: string) => void;
	onComicTypeChange: (value: string) => void;
	onGenreChange: (value: string) => void;
	onStatusChange: (value: string) => void;
	onReset: () => void;
}

let {
	sort,
	comicType,
	genre,
	status,
	onSortChange,
	onComicTypeChange,
	onGenreChange,
	onStatusChange,
	onReset,
}: Props = $props();

// Taksonomi tipe ringkas (port XyMI COMIC_TYPES).
const SORT_OPTIONS = [
	{ value: "recent", label: "Update terbaru" },
	{ value: "popular", label: "Populer" },
	{ value: "title", label: "Judul A–Z" },
] as const;

const COMIC_TYPE_OPTIONS = [
	{ value: "", label: "Semua tipe komik" },
	{ value: "manga", label: "🇯🇵 Manga" },
	{ value: "manhua", label: "🇨🇳 Manhua" },
	{ value: "manhwa", label: "🇰🇷 Manhwa" },
] as const;

// Status mengikuti nilai umum XyMI ("ongoing" / "completed" / "hiatus").
const STATUS_OPTIONS = [
	{ value: "", label: "Semua status" },
	{ value: "ongoing", label: "Ongoing" },
	{ value: "completed", label: "Completed" },
	{ value: "hiatus", label: "Hiatus" },
] as const;
</script>

<div class="grid gap-4 sm:grid-cols-2">
	<div class="grid gap-2">
		<span class="font-semibold text-sm">Urutkan komik</span>
		<Select
			value={sort}
			options={SORT_OPTIONS}
			ariaLabel="Urutkan komik"
			onChange={onSortChange}
		/>
	</div>
	<div class="grid gap-2">
		<span class="font-semibold text-sm">Tipe komik</span>
		<Select
			value={comicType}
			options={COMIC_TYPE_OPTIONS}
			ariaLabel="Tipe komik"
			onChange={onComicTypeChange}
		/>
	</div>
	<GenreMultiSelect value={genre} workspace="comic" id="catalog-genre" onChange={onGenreChange} />
	<div class="grid gap-2">
		<span class="font-semibold text-sm">Status</span>
		<Select
			value={status}
			options={STATUS_OPTIONS}
			ariaLabel="Status"
			onChange={onStatusChange}
		/>
	</div>
</div>

<button
	type="button"
	onclick={onReset}
	class="mt-4 text-left text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
>
	Reset filter
</button>
