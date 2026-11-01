<script lang="ts">
import {
	ChevronRight,
	Clapperboard,
	Home,
	House,
	Image as ImageIcon,
	Layers,
	LibraryBig,
	PanelLeft,
	RefreshCw,
	ShieldCheck,
	Users,
} from "lucide-svelte";
import type { Snippet } from "svelte";
import { resolveMediaUrl } from "#lib/api.ts";
import { authClient } from "#lib/auth-client.ts";
import AppLogo from "#lib/components/AppLogo.svelte";
import AdminMobileNav from "./AdminMobileNav.svelte";

let {
	active,
	children,
	actions,
	title: titleProp,
	breadcrumbs: breadcrumbsProp,
}: {
	active: string;
	children: Snippet;
	actions?: Snippet;
	title?: string;
	breadcrumbs?: { label: string; href?: string }[];
} = $props();

let collapsed = $state(false);

const sessionQuery = authClient.useSession();

const displayName = $derived(
	$sessionQuery.data?.user.name ||
		$sessionQuery.data?.user.email?.split("@")[0] ||
		"Admin",
);
const initial = $derived((displayName || "A").slice(0, 1).toUpperCase());
const avatar = $derived(
	resolveMediaUrl($sessionQuery.data?.user.image ?? null),
);

const groups = [
	{
		label: "Platform",
		items: [
		    { href: "/", label: "Beranda", icon: Home },
			{ href: "/admin", label: "Comic", icon: LibraryBig },
			{ href: "/admin/anime", label: "Anime", icon: Clapperboard },
		],
	},
	{
		label: "Sistem",
		items: [
			{ href: "/admin/runs", label: "Scrapper", icon: RefreshCw },
			{ href: "/admin/media", label: "Media", icon: ImageIcon },
			{ href: "/admin/sources", label: "Sumber", icon: Layers },
		],
	},
	{
		label: "Akun",
		items: [
			{ href: "/admin/users", label: "Pengguna", icon: Users },
			{ href: "/admin/roles", label: "Role & permission", icon: ShieldCheck },
		],
	},
];

const titles: Record<string, string> = {
	"/admin": "Comic",
	"/admin/anime": "Anime",
	"/admin/sources": "Sumber",
	"/admin/runs": "Scrapper",
	"/admin/media": "Media",
	"/admin/users": "Pengguna",
	"/admin/roles": "Role & permission",
};

const resolvedTitle = $derived(titleProp ?? titles[active] ?? "Admin");
const breadcrumbs = $derived(
	breadcrumbsProp ?? [
		{ label: "Admin", href: "/admin" },
		{ label: resolvedTitle },
	],
);

const labelClass = $derived(
	collapsed
		? "pointer-events-none invisible w-0 opacity-0 duration-150"
		: "opacity-100 delay-150 duration-200",
);

function isActive(href: string) {
	if (href === "/admin") return active === "/admin";
	return active === href || active.startsWith(`${href}/`);
}
</script>

<div class="bg-background lg:flex lg:items-start lg:gap-4 lg:p-4">
	<aside
		aria-label="Panel samping admin"
		class="sticky top-4 hidden h-[calc(100dvh-2rem)] shrink-0 flex-col overflow-hidden rounded-2xl border bg-card transition-[width] duration-300 lg:flex {collapsed
			? 'w-[4.75rem]'
			: 'w-64'}"
	>
		<div
			class="flex h-16 shrink-0 items-center gap-3 border-b px-4 {collapsed
				? 'justify-center px-0'
				: ''}"
		>
			<a
				href="/"
				class="flex min-h-11 min-w-11 items-center gap-3"
				aria-label="MIFE · Kembali ke beranda"
			>
				<AppLogo size={36} withWordmark={false} rounded="0.8rem" />
				<span
					class="leading-tight whitespace-nowrap overflow-hidden transition-opacity {labelClass}"
					aria-hidden={collapsed}
				>
					<span class="block font-display text-base font-extrabold tracking-tight">
						MIFE
					</span>
					<span
						class="block font-semibold text-muted-foreground text-[10px] uppercase tracking-[0.18em]"
					>
						Panel admin
					</span>
				</span>
			</a>
		</div>

		<nav aria-label="Navigasi admin" class="flex-1 space-y-6 overflow-y-auto px-3 py-5">
			{#each groups as group (group.label)}
				<div>
					<p
						class="h-7 overflow-hidden px-3 pb-2 font-semibold text-muted-foreground text-[10px] uppercase tracking-[0.16em]"
					>
						<span
							class="block whitespace-nowrap transition-opacity {labelClass}"
							aria-hidden={collapsed}
						>
							{group.label}
						</span>
					</p>
					<div class="space-y-1">
						{#each group.items as item (item.href)}
							{@const Icon = item.icon}
							{@const current = isActive(item.href)}
							<a
								href={item.href}
								title={collapsed ? item.label : undefined}
								aria-label={collapsed ? item.label : undefined}
								aria-current={current ? "page" : undefined}
								class="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors {current
									? 'bg-primary/10 font-semibold text-primary'
									: 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'} {collapsed
									? 'justify-center px-0'
									: ''}"
							>
								<Icon class="size-[1.15rem] shrink-0" aria-hidden="true" />
								<span
									class="truncate whitespace-nowrap overflow-hidden transition-opacity {labelClass}"
									aria-hidden={collapsed}
								>
									{item.label}
								</span>
							</a>
						{/each}
					</div>
				</div>
			{/each}
		</nav>

		<div class="shrink-0 space-y-1 border-t border-border p-3">
			<div
				class="flex items-center gap-3 rounded-xl px-3 py-2 {collapsed
					? 'justify-center px-0'
					: ''}"
			>
				{#if $sessionQuery.isPending}
					<span
						class="size-9 shrink-0 animate-pulse rounded-full bg-secondary"
						aria-label="Memuat profil"
					></span>
				{:else if avatar}
					<img
						src={avatar}
						alt="Foto profil {displayName}"
						referrerpolicy="no-referrer"
						class="size-9 shrink-0 rounded-full bg-secondary object-cover"
					/>
				{:else}
					<span
						class="grid size-9 shrink-0 place-items-center rounded-full bg-primary font-bold text-primary-foreground text-sm"
						aria-hidden="true"
					>
						{initial}
					</span>
				{/if}
				<span
					class="min-w-0 whitespace-nowrap overflow-hidden transition-opacity {labelClass}"
					aria-hidden={collapsed}
				>
					<span class="block truncate text-sm font-semibold">{displayName}</span>
					<span class="block text-muted-foreground text-xs">Administrator</span>
				</span>
			</div>
		</div>
	</aside>

	<div class="min-w-0 flex-1">
		<div
			class="flex min-h-dvh flex-col bg-card/35 lg:min-h-[calc(100dvh-2rem)] lg:rounded-2xl lg:border"
		>
			<header
				class="sticky top-0 z-30 shrink-0 border-b bg-background/85 backdrop-blur-xl lg:rounded-t-2xl"
			>
				<div class="flex min-h-16 items-center gap-3 px-4 sm:px-6">
					<button
						type="button"
						onclick={() => (collapsed = !collapsed)}
						aria-label={collapsed ? "Lebarkan sidebar" : "Ciutkan sidebar"}
						aria-expanded={!collapsed}
						class="hidden size-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground lg:grid"
					>
						<PanelLeft class="size-5" aria-hidden="true" />
					</button>
					<div class="min-w-0">
						<nav aria-label="Breadcrumb" class="hidden lg:block">
							<ol class="flex min-w-0 items-center gap-1 text-xs">
								{#each breadcrumbs as crumb, i (crumb.label)}
									{#if i > 0}
										<li aria-hidden="true" class="shrink-0 text-muted-foreground">
											<ChevronRight class="size-3.5" />
										</li>
									{/if}
									<li
										aria-current={i === breadcrumbs.length - 1 ? "page" : undefined}
										class="truncate font-semibold uppercase tracking-[0.14em] {i ===
										breadcrumbs.length - 1
											? 'text-primary'
											: 'text-muted-foreground'}"
									>
										{#if crumb.href && i < breadcrumbs.length - 1}
											<a
												href={crumb.href}
												class="transition-colors hover:text-foreground"
											>
												{crumb.label}
											</a>
										{:else}
											{crumb.label}
										{/if}
									</li>
								{/each}
							</ol>
						</nav>
						<h1
							class="truncate font-display text-lg font-bold tracking-tight sm:text-xl lg:hidden"
						>
							{resolvedTitle}
						</h1>
					</div>
					<div class="ml-auto flex shrink-0 items-center gap-2">
						{#if actions}
							{@render actions()}
						{/if}
					</div>
				</div>
			</header>
			<div class="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-32 sm:px-6 lg:px-8 lg:py-8">
				{@render children()}
			</div>
		</div>
	</div>
</div>

<AdminMobileNav {active} />
