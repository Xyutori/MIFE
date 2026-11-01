<script lang="ts">
import { createEditor, Edra } from "#lib/components/edra/shadcn/index.js";
import type { CommentItem } from "./api.ts";

export interface ReplyTarget {
	parentId: string | null;
	replyToCommentId: string | null;
	replyToUsername?: string | null;
}

export interface RepliesToggle {
	count: number;
	expanded: boolean;
	loading: boolean;
	onToggle: () => void;
}

interface Props {
	comment: CommentItem;
	onReply: (target: ReplyTarget) => void;
	/** True bila komentar milik user yang sedang login. */
	isOwn?: boolean;
	/** Toggle Lihat/Sembunyikan balasan (hanya untuk komentar top-level). */
	toggle?: RepliesToggle | null;
}

let { comment, onReply, isOwn = false, toggle = null }: Props = $props();

// Read-only Edra renderer for the stored TipTap doc.
// Falls back to a single-paragraph doc built from plainText
// when contentJson is missing or invalid.
const editor = createEditor({});

function toDoc(value: unknown, fallback: string): Record<string, unknown> {
	if (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "doc"
	) {
		return value as Record<string, unknown>;
	}
	return {
		type: "doc",
		content: [
			{ type: "paragraph", content: [{ type: "text", text: fallback }] },
		],
	};
}

$effect(() => {
	if (!editor) return;
	editor.setEditable(false);
	try {
		editor.commands.setContent(toDoc(comment.contentJson, comment.plainText));
	} catch {
		editor.commands.setContent(toDoc(null, comment.plainText));
	}
});

const isPlaceholder = $derived(
	comment.status === "deleted" || comment.status === "hidden",
);
const placeholderText = $derived(
	comment.status === "hidden"
		? "Komentar ini disembunyikan moderator."
		: "Komentar ini telah dihapus.",
);
const replyToId = $derived(comment.replyToCommentId);
// Nama tampilan selalu dari server (replyToUsername); id hanya untuk
// kebutuhan sistem (anchor scroll), tidak pernah ditampilkan.
const replyToName = $derived(comment.replyToUsername ?? null);
const dateLabel = $derived(formatDate(comment.createdAt));
const authorImage = $derived(comment.author?.image ?? null);
const authorInitial = $derived(
	(comment.authorName ?? "?").trim().charAt(0).toUpperCase() || "?",
);
const showToggle = $derived(
	toggle !== null && (toggle.count > 0 || toggle.expanded),
);

function formatDate(value: string): string {
	const time = new Date(value).getTime();
	if (Number.isNaN(time)) return "";
	return new Date(time).toLocaleString("id-ID", {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function scrollToMention(event: MouseEvent) {
	if (!replyToId) return;
	event.preventDefault();
	const el = document.getElementById(`comment-${replyToId}`);
	if (!el) return;
	el.scrollIntoView({ behavior: "smooth", block: "center" });
	el.classList.add("comment-highlight");
	window.setTimeout(() => el.classList.remove("comment-highlight"), 2000);
	// Pindahkan fokus keyboard ke komentar tujuan agar aksesibel.
	if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
	(el as HTMLElement).focus({ preventScroll: true });
}
</script>

<article
	id={`comment-${comment.id}`}
	aria-label={`Komentar oleh ${comment.authorName ?? "pengguna"}`}
	class="comment-node scroll-mt-24 rounded-2xl border border-white/10 bg-white/5 p-3 transition-colors"
>
	{#if isPlaceholder}
		<p class="text-sm text-white/40 italic">{placeholderText}</p>
	{:else}
		<header class="mb-1.5 flex items-start gap-2.5">
			{#if authorImage}
				<img
					src={authorImage}
					alt=""
					loading="lazy"
					class="size-9 shrink-0 rounded-full object-cover"
				/>
			{:else}
				<span
					aria-hidden="true"
					class="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold text-white/80"
				>
					{authorInitial}
				</span>
			{/if}
			<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
				<span class={`text-sm font-bold ${isOwn ? "text-primary" : "text-white"}`}>
					{comment.authorName ?? "Pengguna"}
				</span>
				{#if dateLabel}
					<time datetime={comment.createdAt} class="text-xs text-white/40">{dateLabel}</time>
				{/if}
			</div>
		</header>

		{#if replyToId && replyToName}
			<a
				href={`#comment-${replyToId}`}
				onclick={scrollToMention}
				class="mb-1.5 inline-flex min-h-11 items-center gap-1 rounded-lg bg-white/5 px-2 text-xs font-semibold text-sky-300 hover:bg-white/10"
				aria-label={`Lompat ke komentar @${replyToName}`}
			>
				<span aria-hidden="true">↩</span> @{replyToName}
			</a>
		{/if}

		{#if editor}
			<Edra {editor}>
				<div class="text-sm break-words text-white/90">
					<Edra.Content />
				</div>
			</Edra>
		{:else}
			<p class="text-sm break-words whitespace-pre-wrap text-white/90">{comment.plainText}</p>
		{/if}

		<footer class={`mt-2 flex flex-wrap items-center gap-2 ${showToggle ? "justify-between" : "justify-end"}`}>
			{#if showToggle && toggle}
				<button
					type="button"
					onclick={toggle.onToggle}
					disabled={toggle.loading}
					class="inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-bold text-sky-300 hover:bg-white/10 disabled:opacity-50"
				>
					{toggle.loading
						? "Memuat…"
						: toggle.expanded
							? "Sembunyikan balasan"
							: toggle.count > 0
								? `Lihat ${toggle.count} balasan`
								: "Lihat balasan"}
				</button>
			{/if}
			<button
				type="button"
				onclick={() =>
					onReply({
						parentId: comment.parentId ?? comment.id,
						replyToCommentId: comment.id,
						replyToUsername: comment.authorName ?? null,
					})}
				class="inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-bold text-white/70 hover:bg-white/10 hover:text-white"
				aria-label={`Balas komentar ${comment.authorName ?? ""}`}
			>
				Balas
			</button>
			<!-- Laporkan: dinonaktifkan sementara (helper reportComment tetap ada di api.ts).
			<button ...Laporkan...> -->
		</footer>
	{/if}
</article>

<style>
	:global(.comment-highlight) {
		border-color: rgb(125 211 252 / 0.7) !important;
		box-shadow: 0 0 0 2px rgb(125 211 252 / 0.35);
	}
</style>
