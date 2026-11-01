<script lang="ts">
import { onMount } from "svelte";
import { authClient } from "#lib/auth-client.ts";
import Pagination from "#lib/components/Pagination.svelte";
import Select from "#lib/components/ui/select/Select.svelte";
import {
	type CommentItem as Comment,
	type CommentSort,
	type CommentTargetType,
	listComments,
	listReplies,
} from "./api.ts";
import CommentEditor from "./CommentEditor.svelte";
import CommentItem, { type ReplyTarget } from "./CommentItem.svelte";

interface Props {
	targetType: CommentTargetType;
	targetId: string;
}

let { targetType, targetId }: Props = $props();

const session = authClient.useSession();

let sort = $state<CommentSort>("new");
let items = $state<Comment[]>([]);
let total = $state(0);
let page = $state(1);
let pageCount = $state(1);
let loading = $state(true);
let loadError = $state<string | null>(null);
let sectionEl: HTMLElement | null = $state(null);

const PAGE_SIZE = 10;

let replyTarget = $state<ReplyTarget | null>(null);

// Gulir ke form balasan setiap kali target berubah, agar form yang
// muncul tepat di bawah card yang dibalas langsung terlihat.
$effect(() => {
	if (!replyTarget) return;
	// Tunggu DOM form ter-render.
	requestAnimationFrame(() => {
		document
			.getElementById("balas-form")
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	});
});
// Balasan per komentar: id -> daftar balasan (lazy, maks 50).
let repliesById = $state<Record<string, Comment[]>>({});
let repliesLoading = $state<Record<string, boolean>>({});
let repliesError = $state<Record<string, string | null>>({});
let repliesExpanded = $state<Record<string, boolean>>({});

let aborter: AbortController | null = null;

async function fetchPage(targetPage: number) {
	aborter?.abort();
	aborter = new AbortController();
	loading = true;
	loadError = null;
	try {
		const payload = await listComments({
			targetType,
			targetId,
			sort,
			page: targetPage,
			limit: PAGE_SIZE,
			signal: aborter.signal,
		});
		items = payload.items;
		total = payload.total;
		page = payload.page;
		pageCount = payload.pageCount;
		repliesById = {};
		repliesExpanded = {};
		replyTarget = null;
	} catch (err) {
		if (err instanceof DOMException && err.name === "AbortError") return;
		loadError = err instanceof Error ? err.message : "Komentar gagal dimuat.";
	} finally {
		loading = false;
	}
}

function goToPage(targetPage: number) {
	const next = Math.min(Math.max(1, targetPage), pageCount);
	sectionEl?.scrollIntoView({ behavior: "smooth", block: "start" });
	if (next === page && items.length > 0) return;
	void fetchPage(next);
}

async function toggleReplies(comment: Comment) {
	const id = comment.id;
	repliesExpanded[id] = !repliesExpanded[id];
	if (!repliesExpanded[id] || repliesById[id]) return;
	repliesLoading[id] = true;
	repliesError[id] = null;
	try {
		repliesById[id] = await listReplies(id, 50);
	} catch (err) {
		repliesError[id] =
			err instanceof Error ? err.message : "Balasan gagal dimuat.";
		repliesExpanded[id] = false;
	} finally {
		repliesLoading[id] = false;
	}
}

/** Komentar baru: tampilkan langsung di halaman tempatnya berada. */
function handleNewComment(comment: Comment) {
	if (comment.parentId) {
		const key = comment.parentId;
		repliesById[key] = [comment, ...(repliesById[key] ?? [])];
		repliesExpanded[key] = true;
		replyTarget = null;
		return;
	}
	total += 1;
	if (sort === "new" && page === 1) {
		items = [comment, ...items].slice(0, PAGE_SIZE);
		replyTarget = null;
		return;
	}
	if (sort === "old") {
		// Komentar terbaru ada di halaman terakhir.
		void fetchPage(Math.max(1, Math.ceil(total / PAGE_SIZE)));
		return;
	}
	// "popular" (atau halaman >1): muat ulang halaman aktif.
	void fetchPage(page);
}

function setSort(next: CommentSort) {
	if (next === sort) return;
	sort = next;
	void fetchPage(1);
}

onMount(() => {
	void fetchPage(1);
});

$effect(() => {
	// Refetch saat target berpindah (chapter/episode lain).
	targetType;
	targetId;
	void fetchPage(1);
});
</script>

<section bind:this={sectionEl} aria-label="Komentar" class="flex scroll-mt-24 flex-col gap-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-base font-bold text-white">
			{total} Komentar
		</h2>
		<div role="group" aria-label="Urutkan komentar" class="hidden overflow-hidden rounded-xl border border-white/10 sm:flex">
			<button
				type="button"
				onclick={() => setSort("new")}
				aria-pressed={sort === "new"}
				class={`inline-flex min-h-11 items-center px-4 text-xs font-bold ${sort === "new" ? "bg-white text-black" : "text-white/60 hover:bg-white/10"}`}
			>
				Terbaru
			</button>
			<button
				type="button"
				onclick={() => setSort("old")}
				aria-pressed={sort === "old"}
				class={`inline-flex min-h-11 items-center px-4 text-xs font-bold ${sort === "old" ? "bg-white text-black" : "text-white/60 hover:bg-white/10"}`}
			>
				Terlama
			</button>
			<button
				type="button"
				onclick={() => setSort("popular")}
				aria-pressed={sort === "popular"}
				class={`inline-flex min-h-11 items-center px-4 text-xs font-bold ${sort === "popular" ? "bg-white text-black" : "text-white/60 hover:bg-white/10"}`}
			>
				Terpopuler
			</button>
		</div>
		<div class="sm:hidden">
			<Select
				value={sort}
				options={[
					{ value: "new", label: "Terbaru" },
					{ value: "old", label: "Terlama" },
					{ value: "popular", label: "Terpopuler" },
				]}
				ariaLabel="Urutkan komentar"
				onChange={(next) => setSort(next as CommentSort)}
			/>
		</div>
	</div>

	{#if $session.data?.user}
		<CommentEditor
			{targetType}
			{targetId}
			parentId={replyTarget?.parentId ?? null}
			replyTo={replyTarget}
			onSuccess={handleNewComment}
			onCancel={() => (replyTarget = null)}
		/>
	{:else}
		<a
			href="/login"
			class="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-bold text-white hover:bg-white/10"
		>
			Masuk untuk berkomentar
		</a>
	{/if}

	{#if loading}
		<div role="status" aria-live="polite" class="flex flex-col gap-2">
			{#each [0, 1, 2] as i (i)}
				<div class="h-20 animate-pulse rounded-2xl bg-white/5"></div>
			{/each}
			<span class="sr-only">Memuat komentar…</span>
		</div>
	{:else if loadError}
		<div role="alert" class="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
			<p>{loadError}</p>
			<button
				type="button"
				onclick={() => fetchPage(page)}
				class="mt-2 inline-flex min-h-11 items-center rounded-lg border border-red-300/30 px-4 text-xs font-bold hover:bg-red-400/20"
			>
				Coba lagi
			</button>
		</div>
	{:else if items.length === 0}
		<p class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-white/50">
			Belum ada komentar. Jadilah yang pertama! 🎉
		</p>
	{:else}
		<ol class="flex list-none flex-col gap-3 p-0">
			{#each items as comment (comment.id)}
				{@const replies = repliesById[comment.id] ?? []}
				{@const count = comment.replyCount ?? replies.length}
				{@const expanded = !!repliesExpanded[comment.id]}
				<li class="flex flex-col gap-2">
					<CommentItem
						{comment}
						isOwn={comment.authorId === $session.data?.user?.id}
						toggle={{
							count,
							expanded,
							loading: !!repliesLoading[comment.id],
							onToggle: () => toggleReplies(comment),
						}}
						onReply={(target) => (replyTarget = target)}
					/>
					{#if replyTarget?.replyToCommentId === comment.id}
						{#if $session.data?.user}
							<div id="balas-form" class="ml-4 border-l-2 border-white/10 pl-3">
								<CommentEditor
									{targetType}
									{targetId}
									parentId={replyTarget.parentId}
									replyTo={replyTarget}
									autofocus
									onSuccess={handleNewComment}
									onCancel={() => (replyTarget = null)}
								/>
							</div>
						{/if}
					{/if}
					{#if expanded}
						<div class="ml-4 flex flex-col gap-2 border-l-2 border-white/10 pl-3">
							{#if repliesLoading[comment.id]}
								<div role="status" class="h-14 animate-pulse rounded-xl bg-white/5"></div>
							{:else if repliesError[comment.id]}
								<p role="alert" class="text-xs text-red-400">{repliesError[comment.id]}</p>
							{:else}
								{#each replies as reply (reply.id)}
									<CommentItem
										comment={reply}
										isOwn={reply.authorId === $session.data?.user?.id}
										onReply={(target) => (replyTarget = target)}
									/>
									{#if replyTarget?.replyToCommentId === reply.id}
										{#if $session.data?.user}
											<div id="balas-form" class="ml-4 border-l-2 border-white/10 pl-3">
												<CommentEditor
													{targetType}
													{targetId}
													parentId={replyTarget.parentId}
													replyTo={replyTarget}
													autofocus
													onSuccess={handleNewComment}
													onCancel={() => (replyTarget = null)}
												/>
											</div>
										{/if}
									{/if}
								{/each}
								<button
									type="button"
									onclick={() => (repliesExpanded[comment.id] = false)}
									class="inline-flex min-h-11 w-fit items-center rounded-lg px-3 text-xs font-semibold text-white/50 hover:bg-white/10"
								>
									Sembunyikan balasan
								</button>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ol>
		{#if pageCount > 1}
			<Pagination
				page={page}
				pageCount={pageCount}
				loading={loading}
				label="komentar"
				onChange={goToPage}
			/>
		{/if}
	{/if}
</section>
