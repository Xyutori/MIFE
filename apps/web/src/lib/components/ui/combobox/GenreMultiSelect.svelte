<script lang="ts">
import { Plus, X } from "lucide-svelte";
import { onDestroy, onMount } from "svelte";
import { fetchGenreSuggestions, type GenreWorkspace } from "./genres.ts";

interface Props {
	/** Genre terpilih, gabungan koma (cth. `"Action,Fantasy"`). */
	value: string;
	workspace: GenreWorkspace;
	id?: string;
	onChange: (value: string) => void;
}

let { value, workspace, id = "genre-combobox", onChange }: Props = $props();

let query = $state("");
let open = $state(false);
let suggestions = $state<string[]>([]);
let activeIndex = $state(-1);

const selected = $derived(
	value
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0),
);
const selectedKeys = $derived(
	new Set(selected.map((genre) => genre.toLowerCase())),
);
const visible = $derived(
	suggestions.filter((suggestion) => {
		if (selectedKeys.has(suggestion.toLowerCase())) return false;
		const needle = query.trim().toLowerCase();
		if (!needle) return true;
		return suggestion.toLowerCase().includes(needle);
	}),
);

const listId = `${id}-list`;

let controller: AbortController | null = null;
onMount(() => {
	controller = new AbortController();
	void fetchGenreSuggestions(workspace, controller.signal).then((genres) => {
		suggestions = genres;
	});
});
onDestroy(() => controller?.abort());

function emit(next: string[]) {
	query = "";
	activeIndex = -1;
	open = false;
	onChange(next.join(","));
}

function addGenre(raw: string) {
	const name = raw.trim();
	if (!name || selectedKeys.has(name.toLowerCase())) {
		query = "";
		activeIndex = -1;
		return;
	}
	emit([...selected, name]);
}

function removeGenre(raw: string) {
	emit(selected.filter((genre) => genre.toLowerCase() !== raw.toLowerCase()));
}

function onInputKeydown(event: KeyboardEvent) {
	if (event.key === "ArrowDown" && visible.length > 0) {
		event.preventDefault();
		open = true;
		activeIndex = (activeIndex + 1) % visible.length;
	} else if (event.key === "ArrowUp" && visible.length > 0) {
		event.preventDefault();
		activeIndex = (activeIndex - 1 + visible.length) % visible.length;
	} else if (event.key === "Enter") {
		event.preventDefault();
		if (activeIndex >= 0 && activeIndex < visible.length) {
			addGenre(visible[activeIndex] ?? "");
		} else {
			addGenre(query);
		}
	} else if (event.key === "Escape") {
		open = false;
		activeIndex = -1;
	}
}

function onFocusOut(event: FocusEvent) {
	if (
		!(event.currentTarget as HTMLElement).contains(
			event.relatedTarget as Node | null,
		)
	) {
		open = false;
		activeIndex = -1;
	}
}
</script>

<div class="grid gap-2">
	<label for={id} class="font-semibold text-sm">Genre</label>
	<div class="relative" onfocusout={onFocusOut}>
		{#if selected.length > 0}
			<ul class="mb-2 flex flex-wrap gap-1.5" aria-label="Genre terpilih">
				{#each selected as genre (genre.toLowerCase())}
					<li
						class="inline-flex h-7 items-center gap-1 rounded-full bg-secondary py-0 pr-1.5 pl-2.5 text-xs font-semibold text-secondary-foreground"
					>
						{genre}
						<button
							type="button"
							onclick={() => removeGenre(genre)}
							aria-label={`Hapus genre ${genre}`}
							class="grid size-5 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							<X class="size-3.5" />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<input
			{id}
			type="text"
			role="combobox"
			aria-expanded={open}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={activeIndex >= 0
				? `${listId}-option-${activeIndex}`
				: undefined}
			value={query}
			oninput={(event) => {
				query = event.currentTarget.value;
				activeIndex = -1;
				open = true;
			}}
			onfocus={() => {
				open = true;
			}}
			onkeydown={onInputKeydown}
			placeholder="Ketik genre, Enter untuk tambah…"
			maxlength={60}
			autocomplete="off"
			class="h-12 w-full rounded-xl border border-border/80 bg-card px-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
		/>
		{#if open && (visible.length > 0 || query.trim())}
			<div
				class="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
			>
				{#if visible.length > 0}
					<ul
						id={listId}
						role="listbox"
						aria-label="Saran genre"
						class="max-h-56 overflow-y-auto p-1"
					>
						{#each visible as suggestion, index (suggestion.toLowerCase())}
							<li
								id={`${listId}-option-${index}`}
								role="option"
								aria-selected={selectedKeys.has(suggestion.toLowerCase())}
								data-active={activeIndex === index}
							>
								<button
									type="button"
									onclick={() => addGenre(suggestion)}
									onpointermove={() => {
										activeIndex = index;
									}}
									class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm outline-none hover:bg-accent data-[active=true]:bg-accent"
								>
									<span class="truncate">{suggestion}</span>
									<Plus class="size-4 shrink-0 text-muted-foreground" />
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				{#if query.trim()}
					<button
						type="button"
						onclick={() => addGenre(query)}
						class="flex w-full items-center gap-2 border-border/60 border-t px-3 py-2.5 text-left text-sm outline-none hover:bg-accent"
					>
						<Plus class="size-4 shrink-0 text-primary" />
						<span class="truncate">
							Tambah “{query.trim()}”
						</span>
					</button>
				{/if}
			</div>
		{/if}
	</div>
	<p class="text-muted-foreground text-xs">Bisa pilih lebih dari satu genre.</p>
</div>
