<script lang="ts">
import { Compass, House, Library, Search, X } from "lucide-svelte";
import { cn } from "#lib/utils.js";
import { page } from "$app/state";

let showNotice = $state(true);

const links = [
	{ href: "/", label: "Home", icon: House },
	{ href: "/explore", label: "Explore", icon: Compass },
	{ href: "/library", label: "Library", icon: Library },
	{ href: "/search", label: "All Series", icon: Search },
];
</script>

<nav class="fixed inset-x-0 bottom-0 z-[201] bg-[#1A1A1A] px-4 lg:hidden" aria-label="Mobile">
	{#if showNotice}
		<div class="flex items-start justify-between gap-2 p-2 text-[13px] text-white">
			<p><span class="text-[#E84118]">Notice</span> : Sekarang kamu gak perlu login untuk membaca chapter.</p>
			<button type="button" aria-label="Tutup pengumuman" onclick={() => (showNotice = false)}>
				<X class="size-6" />
			</button>
		</div>
	{/if}
	<div class="grid grid-cols-4 gap-1">
		{#each links as link (link.href)}
			{@const Icon = link.icon}
			{@const active =
				link.href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(link.href)}
			<a
				href={link.href}
				aria-current={active ? "page" : undefined}
				class={cn(
					"flex flex-col items-center gap-1 pb-2 text-[10px] transition-colors",
					active ? "text-[#E01B41]" : "text-white"
				)}
			>
				<Icon class="size-6" />
				{link.label}
			</a>
		{/each}
	</div>
</nav>
