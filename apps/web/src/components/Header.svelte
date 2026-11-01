<script lang="ts">
import { Bookmark, Clapperboard, LibraryBig, UserRound } from "lucide-svelte";
import AppLogo from "#lib/components/AppLogo.svelte";
import { page } from "$app/state";
import UserMenu from "./UserMenu.svelte";

const pathname = $derived(page.url.pathname);

const comicActive = $derived(
	pathname === "/" ||
		pathname.startsWith("/komik") ||
		pathname.startsWith("/baca"),
);
const animeActive = $derived(pathname.startsWith("/anime"));
const libraryActive = $derived(pathname.startsWith("/library"));
const profileActive = $derived(
	pathname.startsWith("/profile") || pathname.startsWith("/settings"),
);

// Bottom-nav mobile hanya di halaman utama (exact match): disembunyikan di
// /komik/*, /baca/*, /anime/*, /library/*, /profile/*, /settings, /admin/*, ...
const showMobileNav = $derived(
	pathname === "/" ||
		pathname === "/anime" ||
		pathname === "/library" ||
		pathname === "/profile",
);

// Top bar mobile: hanya di halaman utama komik, anime, library, dan
// detail library. Selain itu (termasuk /profile) tidak tampil.
const showMobileTopBar = $derived(
	pathname === "/" ||
		pathname === "/anime" ||
		pathname === "/library" ||
		pathname.startsWith("/library/"),
);
</script>

<header class="site-nav" class:site-nav--no-mobile-nav={!showMobileNav && !showMobileTopBar}>
	<div class="site-nav-inner">
		<a href="/" class="site-brand" aria-label="MIFE · Beranda">
			<AppLogo size={32} />
		</a>
		<nav aria-label="Navigasi utama" class="site-links desktop-links">
			<a href="/" class="site-nav-link" class:is-active={comicActive} aria-current={comicActive ? "page" : undefined}>Comic</a>
			<a href="/anime" class="site-nav-link" class:is-active={animeActive} aria-current={animeActive ? "page" : undefined}>Anime</a>
			<a href="/library" class="site-nav-link" class:is-active={libraryActive} aria-current={libraryActive ? "page" : undefined}>Library</a>
			<a href="/profile" class="site-nav-link" class:is-active={profileActive} aria-current={profileActive ? "page" : undefined}>Profile</a>
			<UserMenu />
		</nav>
	</div>
	{#if showMobileNav}
		<nav aria-label="Navigasi utama" class="mobile-bottom-nav">
			<a href="/" class="mobile-nav-link" class:is-active={comicActive} aria-current={comicActive ? "page" : undefined}>
				<LibraryBig aria-hidden="true" />
				<span>Comic</span>
			</a>
			<a href="/anime" class="mobile-nav-link" class:is-active={animeActive} aria-current={animeActive ? "page" : undefined}>
				<Clapperboard aria-hidden="true" />
				<span>Anime</span>
			</a>
			<a href="/library" class="mobile-nav-link" class:is-active={libraryActive} aria-current={libraryActive ? "page" : undefined}>
				<Bookmark aria-hidden="true" />
				<span>Library</span>
			</a>
			<a href="/profile" class="mobile-nav-link" class:is-active={profileActive} aria-current={profileActive ? "page" : undefined}>
				<UserRound aria-hidden="true" />
				<span>Profile</span>
			</a>
		</nav>
	{/if}
</header>
{#if showMobileTopBar}
	<!-- Di luar <header>: .site-nav punya backdrop-filter sehingga menjadi
		containing block bagi position:fixed di dalamnya (top bar akan
		menempel ke header bawah, bukan viewport). -->
	<div class="mobile-top-bar">
		<a href="/" class="site-brand" aria-label="MIFE · Beranda">
		<AppLogo size={32} />
		</a>
		<UserMenu minimal />
	</div>
{/if}
