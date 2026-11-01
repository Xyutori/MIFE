<script lang="ts">
import { authClient } from "#lib/auth-client.ts";
import AdSlot from "#lib/components/comic/AdSlot.svelte";
import CommentRules from "#lib/components/comic/CommentRules.svelte";
import CommentThread from "#lib/components/comic/CommentThread.svelte";
import ReactionBar from "#lib/components/comic/ReactionBar.svelte";
import ReaderNav from "#lib/components/comic/ReaderNav.svelte";
import ReaderView from "#lib/components/comic/ReaderView.svelte";
import { pushHistory } from "../../_library-store";
import { mockReactions } from "../../_mock";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();

const session = authClient.useSession();

let reportSent = $state(false);

const prevHref = $derived(data.prevId ? `/read/${data.prevId}` : null);
const nextHref = $derived(data.nextId ? `/read/${data.nextId}` : null);

$effect(() => {
	pushHistory({
		seriesId: data.series.id,
		chapterId: data.chapter.id,
		title: data.series.title,
		chapter: data.chapter.number,
		cover: data.series.cover,
		at: Date.now(),
	});
});
</script>

<div class="mx-auto w-full max-w-4xl space-y-6 px-4 pb-28 pt-4 lg:pb-12">
	<nav aria-label="Breadcrumb" class="text-sm text-neutral-400">
		<a href="/" class="hover:text-white">Home</a>
		<span aria-hidden="true"> / </span>
		<a href={data.series.href} class="hover:text-white">{data.series.title}</a>
		<span aria-hidden="true"> / </span>
		<span aria-current="page" class="text-white">{data.chapter.number}</span>
	</nav>

	<header>
		<h1 class="text-xl font-bold text-white sm:text-2xl">{data.series.title}</h1>
		<p class="mt-1 text-sm text-neutral-400">{data.chapter.number}</p>
	</header>

	<ReaderView pages={data.chapter.pages} alt={data.series.title} />

	{#if reportSent}
		<p role="status" class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
			Laporan chapter terkirim. Terima kasih atas bantuannya!
		</p>
	{/if}

	<ReaderNav
		prevHref={prevHref}
		nextHref={nextHref}
		seriesHref={data.series.href}
		onReport={() => (reportSent = true)}
	/>

	<ReactionBar reactions={mockReactions} />

	<AdSlot />

	<section class="space-y-4">
		<CommentRules variant="chapter" />
		<CommentThread threadId="chapter-{data.chapter.id}" isLoggedIn={$session?.data != null} />
	</section>
</div>
