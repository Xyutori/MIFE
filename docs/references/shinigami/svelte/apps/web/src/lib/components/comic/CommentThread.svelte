<script lang="ts">
import Icon from "./Icon.svelte";
import type { ComicComment, CommentSort } from "./types.js";

interface Props {
	threadId: string;
	sort?: CommentSort;
	/** Whether the viewer is logged in. When false the form is replaced by a login notice. */
	isLoggedIn?: boolean;
	onSubmit?: (body: string) => void;
	onReply?: (parentId: string, body: string) => void;
	onLike?: (commentId: string, liked: boolean) => void;
}

let {
	threadId,
	sort = "latest",
	isLoggedIn = false,
	onSubmit,
	onReply,
	onLike,
}: Props = $props();

// ------------------------------------------------------------------
// Local mock data (placeholder until the real comment API lands).
// ------------------------------------------------------------------
interface MockComment extends ComicComment {
	createdAt: number;
	replies?: MockComment[];
}

const MOCK: MockComment[] = [
	{
		id: "c-001",
		nick: "Samijan",
		level: "Lv.12",
		time: "2 jam lalu",
		createdAt: 3,
		body: "Chapter kali ini gila banget, panel fight-nya rapi parah. Nggak sabar nunggu minggu depan!",
		likes: 49,
		replyCount: 15,
		replies: [
			{
				id: "c-001-r1",
				nick: "Crew Sakan",
				level: "Lv.8",
				time: "1 jam lalu",
				createdAt: 2,
				body: "Setuju, koreografinya naik level dibanding chapter kemarin.",
				likes: 6,
			},
			{
				id: "c-001-r2",
				nick: "HUBMU",
				level: "Lv.21",
				time: "40 menit lalu",
				createdAt: 1,
				body: "Apalagi pas halaman terakhir, merinding.",
				likes: 3,
			},
		],
	},
	{
		id: "c-002",
		nick: "NETERO 92",
		level: "Lv.5",
		time: "5 jam lalu",
		createdAt: 2,
		body: "Yang bingung sama alur Qi-nya MC, intinya dia nanem aliran Qi ke Somi dari awal diselametin.",
		spoiler:
			"MC balik ke penginapan pakai Qinggong tingkat tertinggi, bukan teleportasi.",
		likes: 18,
	},
	{
		id: "c-003",
		nick: "Aike Aulia",
		level: "Lv.3",
		time: "1 hari lalu",
		createdAt: 1,
		body: "First! Semoga translate-nya makin cepet min, semangat terus.",
		likes: 3,
	},
];

let comments = $state<MockComment[]>(
	JSON.parse(JSON.stringify(MOCK)) as MockComment[],
);
// `sort` is the default order; the user can override it locally afterwards.
let userSort = $state<CommentSort | null>(null);
let activeSort = $derived(userSort ?? sort);
let draft = $state("");
let replyOpenId = $state<string | null>(null);
let replyDrafts = $state<Record<string, string>>({});
let likedIds = $state<Set<string>>(new Set());

const sortOptions: Array<{ value: CommentSort; label: string }> = [
	{ value: "latest", label: "Terbaru" },
	{ value: "oldest", label: "Terlama" },
	{ value: "hottest", label: "Terpopuler" },
];

let visible = $derived.by(() => {
	const list = [...comments];
	if (activeSort === "oldest") list.sort((a, b) => a.createdAt - b.createdAt);
	else if (activeSort === "hottest")
		list.sort((a, b) => likeCount(b) - likeCount(a));
	else list.sort((a, b) => b.createdAt - a.createdAt);
	return list;
});

let totalCount = $derived(
	comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0),
);

function likeCount(comment: ComicComment): number {
	return comment.likes + (likedIds.has(comment.id) ? 1 : 0);
}

function toggleLike(comment: ComicComment): void {
	const next = new Set(likedIds);
	if (next.has(comment.id)) next.delete(comment.id);
	else next.add(comment.id);
	likedIds = next;
	onLike?.(comment.id, next.has(comment.id));
}

function avatarFallback(nick: string): string {
	const letter = nick.trim().charAt(0).toUpperCase() || "?";
	return letter;
}

function submitComment(): void {
	const body = draft.trim();
	if (!body || !isLoggedIn) return;
	comments = [
		{
			id: `c-local-${Date.now()}`,
			nick: "Kamu",
			level: "Lv.1",
			time: "baru saja",
			createdAt: Date.now(),
			body,
			likes: 0,
		},
		...comments,
	];
	draft = "";
	onSubmit?.(body);
}

function submitReply(parentId: string): void {
	const body = (replyDrafts[parentId] ?? "").trim();
	if (!body || !isLoggedIn) return;
	comments = comments.map((c) =>
		c.id === parentId
			? {
					...c,
					replies: [
						...(c.replies ?? []),
						{
							id: `c-local-${Date.now()}`,
							nick: "Kamu",
							level: "Lv.1",
							time: "baru saja",
							createdAt: Date.now(),
							body,
							likes: 0,
						},
					],
				}
			: c,
	);
	replyDrafts = { ...replyDrafts, [parentId]: "" };
	replyOpenId = null;
	onReply?.(parentId, body);
}
</script>

{#snippet commentItem(comment: ComicComment, depth = 0)}
	<article class={depth > 0 ? "flex gap-3" : "flex gap-3 rounded-[8px] p-1"}>
		{#if comment.avatar}
			<img
				src={comment.avatar}
				alt={comment.nick}
				loading="lazy"
				decoding="async"
				class="h-10 w-10 shrink-0 rounded-full object-cover"
			/>
		{:else}
			<span
				aria-hidden="true"
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E01B41] text-sm font-bold text-white"
			>
				{avatarFallback(comment.nick)}
			</span>
		{/if}

		<div class="min-w-0 flex-1">
			<div class="mb-1 flex flex-wrap items-center gap-2">
				<span class="text-sm font-semibold text-white">{comment.nick}</span>
				{#if comment.level}
					<span class="rounded-[4px] bg-[#242424] px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
						{comment.level}
					</span>
				{/if}
				<span class="text-[11px] text-neutral-500">{comment.time}</span>
			</div>

			<p class="text-sm leading-relaxed whitespace-pre-line text-neutral-200">
				{comment.body}
			</p>

			{#if comment.spoiler}
				<details class="mt-2 rounded-[8px] bg-[#242424] px-3 py-2">
					<summary class="cursor-pointer text-xs font-semibold text-amber-400">
						Spoiler
					</summary>
					<p class="mt-1 text-sm leading-relaxed whitespace-pre-line text-neutral-300">
						{comment.spoiler}
					</p>
				</details>
			{/if}

			<div class="mt-2 flex items-center gap-3">
				<button
					type="button"
					onclick={() => toggleLike(comment)}
					aria-pressed={likedIds.has(comment.id)}
					class={likedIds.has(comment.id)
						? "flex items-center gap-1 text-xs font-medium text-[#E01B41]"
						: "flex items-center gap-1 text-xs text-neutral-400 transition-colors hover:text-white"}
				>
					<Icon name="thumbs-up" size={16} />
					{likeCount(comment)}
				</button>
				{#if depth === 0}
					<button
						type="button"
						onclick={() => (replyOpenId = replyOpenId === comment.id ? null : comment.id)}
						class="flex items-center gap-1 text-xs text-neutral-400 transition-colors hover:text-white"
					>
						<Icon name="reply" size={16} />
						Balas
					</button>
				{/if}
			</div>

			{#if depth === 0 && replyOpenId === comment.id}
				{#if isLoggedIn}
					<div class="mt-2 flex flex-col gap-2">
						<textarea
							rows="2"
							placeholder={`Balas ${comment.nick}...`}
							value={replyDrafts[comment.id] ?? ""}
							oninput={(e) => {
								replyDrafts = { ...replyDrafts, [comment.id]: e.currentTarget.value };
							}}
							class="w-full resize-y rounded-[8px] border border-white/10 bg-[#0F0F0F] px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#E01B41] focus:outline-none"
						></textarea>
						<div class="flex justify-end gap-2">
							<button
								type="button"
								onclick={() => (replyOpenId = null)}
								class="rounded-[6px] px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:text-white"
							>
								Batal
							</button>
							<button
								type="button"
								onclick={() => submitReply(comment.id)}
								disabled={!(replyDrafts[comment.id] ?? "").trim()}
								class="rounded-[6px] bg-[#E01B41] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
							>
								Kirim
							</button>
						</div>
					</div>
				{:else}
					<p class="mt-2 text-xs text-neutral-500">
						<a href="/login" class="font-semibold text-[#E01B41] hover:underline">Login</a>
						untuk membalas komentar.
					</p>
				{/if}
			{/if}

			{#if comment.replies && comment.replies.length > 0}
				<details class="mt-2" open={replyOpenId === comment.id}>
					<summary
						class="flex cursor-pointer items-center gap-1 text-xs text-neutral-400 hover:text-white"
					>
						<Icon name="chevron-down" size={14} />
						{comment.replyCount ?? comment.replies.length} balasan
					</summary>
					<div class="mt-2 flex flex-col gap-3 border-l border-white/10 pl-3">
						{#each comment.replies as reply (reply.id)}
							{@render commentItem(reply, depth + 1)}
						{/each}
					</div>
				</details>
			{/if}
		</div>
	</article>
{/snippet}

<section aria-label="Komentar" data-thread={threadId} class="flex flex-col gap-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h3 class="text-base font-semibold text-white">
			Komentar <span class="text-neutral-400">({totalCount})</span>
		</h3>
		<div
			role="group"
			aria-label="Urutkan komentar"
			class="flex gap-1 rounded-[8px] bg-[#242424] p-1"
		>
			{#each sortOptions as option (option.value)}
				<button
					type="button"
					onclick={() => (userSort = option.value)}
					aria-pressed={activeSort === option.value}
					class={activeSort === option.value
						? "rounded-[6px] bg-[#E01B41] px-3 py-1 text-xs font-semibold text-white"
						: "rounded-[6px] px-3 py-1 text-xs text-neutral-400 transition-colors hover:text-white"}
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>

	{#if isLoggedIn}
		<div class="flex flex-col gap-2">
			<textarea
				rows="3"
				bind:value={draft}
				placeholder="Tulis komentar... (dilarang spoiler ending & spam)"
				aria-label="Tulis komentar"
				class="w-full resize-y rounded-[8px] border border-white/10 bg-[#242424] px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#E01B41] focus:outline-none"
			></textarea>
			<div class="flex justify-end">
				<button
					type="button"
					onclick={submitComment}
					disabled={!draft.trim()}
					class="flex items-center gap-2 rounded-[6px] bg-[#E01B41] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<Icon name="send" size={14} />
					Kirim
				</button>
			</div>
		</div>
	{:else}
		<div
			class="flex items-center gap-3 rounded-[8px] border border-white/10 bg-[#242424] px-4 py-3"
		>
			<Icon name="log-in" size={18} class="shrink-0 text-[#E01B41]" />
			<p class="text-sm text-neutral-400">
				<a href="/login" class="font-semibold text-white hover:underline">Login</a>
				untuk ikut berkomentar.
			</p>
		</div>
	{/if}

	<div class="flex flex-col gap-4">
		{#each visible as comment (comment.id)}
			{@render commentItem(comment)}
		{:else}
			<p class="rounded-[8px] bg-[#242424] px-4 py-6 text-center text-sm text-neutral-500">
				Belum ada komentar. Jadilah yang pertama!
			</p>
		{/each}
	</div>
</section>
