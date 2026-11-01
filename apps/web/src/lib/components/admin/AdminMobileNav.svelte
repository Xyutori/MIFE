<script lang="ts">
import {
	Clapperboard,
	House,
	Image as ImageIcon,
	Layers,
	LibraryBig,
	Menu,
	RefreshCw,
	ShieldCheck,
	Users,
} from "lucide-svelte";
import { resolveMediaUrl } from "#lib/api.ts";
import { authClient } from "#lib/auth-client.ts";
import BottomSheet from "#lib/components/ui/BottomSheet.svelte";

let { active }: { active: string } = $props();

let sheetOpen = $state(false);

const sessionQuery = authClient.useSession();

const displayName = $derived(
	$sessionQuery.data?.user.name ||
		$sessionQuery.data?.user.email?.split("@")[0] ||
		"Admin",
);
const email = $derived($sessionQuery.data?.user.email ?? "");
const initial = $derived((displayName || "A").slice(0, 1).toUpperCase());
const avatar = $derived(
	resolveMediaUrl($sessionQuery.data?.user.image ?? null),
);

const primary = [
	{
		href: "/admin",
		label: "Comic",
		ariaLabel: "Comic",
		icon: LibraryBig,
	},
	{
		href: "/admin/anime",
		label: "Anime",
		ariaLabel: "Anime",
		icon: Clapperboard,
	},
	{
		href: "/admin/runs",
		label: "Scrapper",
		ariaLabel: "Scrapper",
		icon: RefreshCw,
	},
	{ href: "/admin/media", label: "Media", ariaLabel: "Media", icon: ImageIcon },
];

const secondary = [
	{
		href: "/admin/sources",
		label: "Sumber",
		description: "Kelola sumber komik & anime",
		icon: Layers,
	},
	{
		href: "/admin/users",
		label: "Pengguna",
		description: "Kelola akun dan hak akses masuk",
		icon: Users,
	},
	{
		href: "/admin/roles",
		label: "Role & permission",
		description: "Atur peran dan izin",
		icon: ShieldCheck,
	},
];

function isActive(href: string) {
	if (href === "/admin") return active === "/admin";
	return active === href || active.startsWith(`${href}/`);
}

function openSheet() {
	sheetOpen = true;
}

function closeSheet() {
	sheetOpen = false;
}
</script>

<nav
	aria-label="Navigasi admin"
	class="fixed inset-x-0 bottom-0 z-40 border-t bg-[#111319]/92 backdrop-blur-xl lg:hidden"
	style="padding-bottom: env(safe-area-inset-bottom);"
>
	<div class="mx-auto grid w-full max-w-md grid-cols-5 gap-1 px-2 pt-1.5">
		{#each primary as item (item.href)}
			{@const Icon = item.icon}
			{@const current = isActive(item.href)}
			<a
				href={item.href}
				aria-label={item.ariaLabel}
				aria-current={current ? "page" : undefined}
				class="admin-mobile-link"
				class:is-active={current}
			>
				<Icon aria-hidden="true" class="size-[1.2rem]" />
				<span>{item.label}</span>
			</a>
		{/each}
		<button
			type="button"
			aria-haspopup="dialog"
			aria-expanded={sheetOpen}
			aria-label="Menu admin lainnya"
			onclick={openSheet}
			class="admin-mobile-link"
			class:is-active={sheetOpen ||
				secondary.some((item) => isActive(item.href))}
		>
			<Menu aria-hidden="true" class="size-[1.2rem]" />
			<span>Lainnya</span>
		</button>
	</div>
</nav>

<BottomSheet open={sheetOpen} onClose={closeSheet} title="Menu lainnya">
	<div class="space-y-1" role="group" aria-label="Pengaturan admin">
		{#each secondary as item (item.href)}
			{@const Icon = item.icon}
			{@const current = isActive(item.href)}
			<a
				href={item.href}
				onclick={closeSheet}
				aria-current={current ? "page" : undefined}
				class="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 transition-colors {current
					? 'bg-primary/10 font-semibold text-primary'
					: 'text-foreground hover:bg-accent/70'}"
			>
				<span
					class="grid size-9 shrink-0 place-items-center rounded-lg {current
						? 'bg-primary/15 text-primary'
						: 'bg-accent text-muted-foreground'}"
				>
					<Icon class="size-[1.15rem]" aria-hidden="true" />
				</span>
				<span class="min-w-0">
					<span class="block truncate text-sm">{item.label}</span>
					<span class="block truncate text-muted-foreground text-xs">
						{item.description}
					</span>
				</span>
			</a>
		{/each}
	</div>
	<div class="mt-2 border-t border-border px-0 pt-2">
		<a
			href="/"
			onclick={closeSheet}
			class="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
		>
			<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent">
				<House class="size-[1.15rem]" aria-hidden="true" />
			</span>
			<span>
				<span class="block text-sm">Kembali ke Beranda</span>
				<span class="block text-muted-foreground text-xs">
					Lihat situs sebagai pengunjung
				</span>
			</span>
		</a>
		<div class="flex items-center gap-3 px-3 py-3">
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
			<span class="min-w-0">
				<span class="block truncate text-sm font-semibold">{displayName}</span>
				<span class="block truncate text-muted-foreground text-xs">
					{email || "Administrator"}
				</span>
			</span>
		</div>
	</div>
</BottomSheet>
