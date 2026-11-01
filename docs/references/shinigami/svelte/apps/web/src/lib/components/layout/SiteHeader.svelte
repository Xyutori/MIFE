<script lang="ts">
import { Crown, Search } from "lucide-svelte";
import { page } from "$app/state";
import { cn } from "#lib/utils.js";
import UserMenu from "../../../components/UserMenu.svelte";

interface Props {
	transparent?: boolean;
}

let { transparent = false }: Props = $props();

const links = [
	{ href: "/", label: "Home" },
	{ href: "/explore", label: "Explore" },
	{ href: "/library", label: "Library" },
	{ href: "/search", label: "Search" },
];
</script>

<header
	class={cn(
		"sticky top-0 z-50 border-b",
		transparent ? "border-transparent bg-transparent" : "border-white/10 bg-[#1A1A1A]"
	)}
>
	<div class="mx-auto flex w-full max-w-[1440px] items-center gap-4 px-4 py-3">
		<a href="/" class="text-xl font-bold tracking-tight text-white" aria-label="SyMi home">
			SyMi<span class="text-[#E01B41]">.</span>
		</a>

		<nav class="ml-6 hidden items-center gap-1 lg:flex" aria-label="Primary">
			{#each links as link (link.href)}
				{@const active =
					link.href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(link.href)}
				<a
					href={link.href}
					aria-current={active ? "page" : undefined}
					class={cn(
						"rounded-md px-5 py-4 text-sm font-medium transition-colors",
						active ? "text-[#E01B41]" : "text-white hover:text-[#E01B41]"
					)}
				>
					{link.label}
				</a>
			{/each}
		</nav>

		<div class="ml-auto flex items-center gap-4">
			<a href="/search" class="text-[#E01B41] md:hidden" aria-label="Search">
				<Search class="size-6" />
			</a>
			<a href="/setting#plan" aria-label="Premium">
				<Crown class="size-5 text-[#E01B41]" />
			</a>
			<UserMenu />
		</div>
	</div>
</header>
