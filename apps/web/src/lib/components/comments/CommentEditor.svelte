<script lang="ts">
import { createEditor, Edra } from "#lib/components/edra/shadcn/index.js";
import {
	type CommentItem,
	type CommentTargetType,
	createComment,
} from "./api.ts";

interface ReplyTarget {
	parentId: string | null;
	replyToCommentId: string | null;
	replyToUsername?: string | null;
}

interface Props {
	targetType: CommentTargetType;
	targetId: string;
	parentId?: string | null;
	replyTo?: ReplyTarget | null;
	autofocus?: boolean;
	onSuccess?: (comment: CommentItem) => void;
	onCancel?: () => void;
}

let {
	targetType,
	targetId,
	parentId = null,
	replyTo = null,
	autofocus = false,
	onSuccess,
	onCancel,
}: Props = $props();

const MAX_WORDS = 1000;

let sending = $state(false);
let error = $state<string | null>(null);
let plainText = $state("");
let wordCount = $state(0);
let hasSpoiler = $state(false);

const editor = createEditor({ onUpdate: sync });

function sync() {
	if (!editor) return;
	plainText = editor.getText({ blockSeparator: "\n" });
	wordCount =
		plainText.trim() === "" ? 0 : plainText.trim().split(/\s+/).length;
	let found = false;
	editor.state.doc.descendants((node) => {
		if (node.type.name === "spoilerBlock") {
			found = true;
			return false;
		}
	});
	hasSpoiler = found;
}

$effect(() => {
	if (autofocus && editor) editor.commands.focus();
});

const overLimit = $derived(wordCount > MAX_WORDS);
const canSubmit = $derived(
	plainText.trim().length > 0 && !overLimit && !sending,
);

// Sanitasi klien agar selaras dengan validasi server (hanya
// spoiler/callout/blockquote/bullet/ordered + bold/italic/underline/strike).
// Autolink (URL), backtick (code), `#` (heading), tabel/media hasil paste
// dilucuti diam-diam menjadi teks polos — isi terlihat tetap utuh.
const ALLOWED_BLOCKS = new Set([
	"paragraph",
	"spoilerBlock",
	"callout",
	"blockquote",
	"bulletList",
	"orderedList",
	"listItem",
	"hardBreak",
]);
const ALLOWED_MARKS = new Set(["bold", "italic", "underline", "strike"]);

type JsonNode = {
	type?: string;
	text?: string;
	marks?: { type?: string }[];
	content?: JsonNode[];
};

function cleanMarks(marks: JsonNode["marks"]) {
	if (!Array.isArray(marks)) return undefined;
	const kept = marks.filter((m) => m && ALLOWED_MARKS.has(m.type ?? ""));
	return kept.length > 0 ? kept : undefined;
}

function inlineTexts(node: JsonNode): JsonNode[] {
	if (!node || typeof node !== "object") return [];
	if (node.type === "text" && typeof node.text === "string") {
		return [
			{
				type: "text",
				text: node.text,
				...(cleanMarks(node.marks) ? { marks: cleanMarks(node.marks) } : {}),
			},
		];
	}
	if (node.type === "hardBreak") return [{ type: "hardBreak" }];
	if (!Array.isArray(node.content)) return [];
	return node.content.flatMap(inlineTexts);
}

function cleanBlock(node: JsonNode): JsonNode | null {
	if (!node || typeof node !== "object") return null;
	const type = node.type ?? "";
	if (type === "text") {
		const [t] = inlineTexts(node);
		// Teks telanjang di level blok dibungkus paragraf.
		return t && t.type === "text" ? { type: "paragraph", content: [t] } : null;
	}
	if (type === "hardBreak") return { type: "hardBreak" };
	if (
		type === "paragraph" ||
		type === "spoilerBlock" ||
		type === "callout" ||
		type === "blockquote"
	) {
		const inlines = (node.content ?? [])
			.flatMap(inlineTexts)
			.filter((n) => (n.type === "text" ? n.text !== "" : true));
		if (inlines.length === 0) return null;
		return { type, content: inlines };
	}
	if (type === "bulletList" || type === "orderedList") {
		const items = (node.content ?? [])
			.map(cleanBlock)
			.filter((n): n is JsonNode => !!n && n.type === "listItem");
		return items.length > 0 ? { type, content: items } : null;
	}
	if (type === "listItem") {
		const blocks = (node.content ?? [])
			.map(cleanBlock)
			.filter((n): n is JsonNode => !!n && n.type !== "hardBreak");
		if (blocks.length === 0) {
			const inlines = inlineTexts(node);
			if (inlines.length === 0) return null;
			return {
				type: "listItem",
				content: [{ type: "paragraph", content: inlines }],
			};
		}
		return { type: "listItem", content: blocks };
	}
	// Node lain (heading, codeBlock, tabel, media, hr, dsb): ambil teksnya saja.
	const inlines = inlineTexts(node);
	if (inlines.length === 0) return null;
	return { type: "paragraph", content: inlines };
}

function toAllowedDoc() {
	const raw = editor?.getJSON() as JsonNode | undefined;
	const content = (Array.isArray(raw?.content) ? raw.content : [])
		.map(cleanBlock)
		.filter((n): n is JsonNode => !!n);
	return { type: "doc", content };
}

async function submit(event: SubmitEvent) {
	event.preventDefault();
	if (!canSubmit || !editor) return;
	sending = true;
	error = null;
	try {
		const comment = await createComment({
			targetType,
			targetId,
			parentId: replyTo?.parentId ?? parentId,
			replyToCommentId: replyTo?.replyToCommentId ?? null,
			contentJson: toAllowedDoc(),
			hasSpoiler,
		});
		editor.commands.clearContent();
		sync();
		onSuccess?.(comment);
	} catch (err) {
		error = err instanceof Error ? err.message : "Gagal mengirim komentar.";
	} finally {
		sending = false;
	}
}
</script>

<form
	onsubmit={submit}
	class="relative flex flex-col gap-2 rounded-3xl border border-white/10 bg-white/5 p-3 transition-all duration-200 focus-within:border-white/20 focus-within:shadow-[0_0_0_4px_rgba(255,255,255,0.05)]"
>
	{#if replyTo?.replyToUsername}
		<p class="pr-12 text-xs text-white/60">
			Membalas <span class="font-semibold text-white">@{replyTo.replyToUsername}</span>
		</p>
		{#if onCancel}
			<button
				type="button"
				onclick={onCancel}
				aria-label="Batalkan balasan"
				title="Batalkan balasan"
				class="absolute top-2 right-2 inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-white/70 underline underline-offset-2 hover:text-white"
			>
				Batal
			</button>
		{/if}
	{/if}
	{#if editor}
		<Edra {editor}>
			<div aria-label="Tulis komentar" class="comment-composer">
				<Edra.Content
					class="min-h-24 text-sm text-white [&_.ProseMirror]:min-h-24 [&_.ProseMirror]:outline-none [&_.ProseMirror]:focus-visible:outline-none"
				/>
			</div>
		</Edra>
	{:else}
		<p class="p-3 text-sm text-white/40">Memuat editor…</p>
	{/if}
	<div class="flex min-h-11 flex-wrap items-center justify-between gap-2">
		<span class="text-xs text-white/40">
			Ketik <kbd class="rounded bg-white/10 px-1 font-sans">/</kbd> untuk menu
		</span>
		<div class="flex items-center gap-3">
			<span
				id="komentar-hitung"
				aria-live="polite"
				class={`text-xs tabular-nums ${overLimit ? "font-semibold text-red-400" : "text-white/50"}`}
			>
				{wordCount}/{MAX_WORDS} kata
			</span>
			<button
				type="submit"
				disabled={!canSubmit}
				class="inline-flex min-h-11 items-center rounded-xl bg-white px-5 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
			>
				{sending ? "Mengirim…" : "Kirim"}
			</button>
		</div>
	</div>
	{#if overLimit}
		<p role="alert" class="text-xs text-red-400">
			Komentar melebihi {MAX_WORDS} kata. Persingkat dulu ya.
		</p>
	{/if}
	{#if error}
		<p role="alert" class="text-xs text-red-400">{error}</p>
	{/if}
</form>

<style>
	/* Matikan outline fokus bawaan (global :focus-visible + browser) yang
	menempel di ProseMirror sebagai "box" tambahan di dalam kartu.
	Indikasi fokus tetap ada di kartu luar via focus-within. */
	:global(.comment-composer .ProseMirror),
	:global(.comment-composer .ProseMirror-focused) {
		outline: none !important;
		border-radius: 0.75rem;
	}
</style>
