<script lang="ts">
import { cn } from "#lib/utils.js";
import {
	NodeViewContent,
	type NodeViewProps,
	NodeViewWrapper,
} from "../../tiptap/index.js";

const props: NodeViewProps = $props();
const editor = $derived(props.editor);
// Read-only render (CommentItem) uses <details>; editable render
// (CommentEditor) keeps the content directly editable with a label.
const editable = $derived(editor?.isEditable ?? true);
</script>

<NodeViewWrapper
	class={cn(
		'my-2 rounded-xl border border-amber-300/25 bg-amber-300/5 p-2'
	)}
>
	{#if editable}
		<p
			contenteditable="false"
			class="mb-1 text-xs font-bold tracking-wide text-amber-200 select-none"
		>
			Spoiler
		</p>
		<NodeViewContent class="min-w-full text-sm break-words whitespace-pre-wrap text-white/90" />
	{:else}
		<details class="group">
			<summary
				class="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-bold text-amber-200"
			>
				<span aria-hidden="true" class="transition-transform group-open:rotate-90">▶</span>
				Spoiler
			</summary>
			<div class="mt-1">
				<NodeViewContent class="text-sm break-words whitespace-pre-wrap text-white/90" />
			</div>
		</details>
	{/if}
</NodeViewWrapper>
