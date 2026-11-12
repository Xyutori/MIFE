<script lang="ts">
import { ArrowLeft, Bookmark, Clapperboard, LibraryBig, UserRound } from "lucide-svelte";
import AppLogo from "#lib/components/AppLogo.svelte";
import { page } from "$app/state";
import UserMenu from "./UserMenu.svelte";

const pathname = $derived(page.url.pathname);

const comicActive = $derived(
	pathname === "/" ||
		pathname.startsWith("/komik") ||
		pathname.startsWith("/baca") ||
		pathname.startsWith("/super-komik") ||
		pathname.startsWith("/dashboard"),
);
const animeActive = $derived(pathname.startsWith("/anime"));
const libraryActive = $derived(pathname.startsWith("/library"));
const profileActive = $derived(
	pathname.startsWith("/profile") || pathname.startsWith("/settings"),
);

// Rute immersive/admin tidak memakai chrome publik sama sekali (+layout
// sudah menyembunyikan Header di sana); flag ganda sebagai pengaman.
const isAdminRoute = $derived(pathname.startsWith("/admin"));
const isReadImmersive = $derived(
	pathname.startsWith("/baca") || pathname.startsWith("/super-komik/read"),
);

// Bottom-nav mobile/tablet: persisten di 4 tab utama INKLUSIF rute anak
// (komik: / + /komik/* + /super-komik/* + /dashboard; anime, library,
// profile/settings). Tetap disembunyikan di rute baca immersive dan admin.
const showMobileNav = $derived(
	!isAdminRoute &&
		!isReadImmersive &&
		(pathname === "/" ||
			pathname.startsWith("/komik") ||
			pathname.startsWith("/super-komik") ||
			pathname.startsWith("/dashboard") ||
			pathname.startsWith("/anime") ||
			pathname.startsWith("/library") ||
			pathname.startsWith("/profile") ||
			pathname.startsWith("/settings")),
);

// Top bar mobile/tablet: tampil di semua rute non-immersive non-admin agar
// rute anak selalu punya navigasi kembali. Varian logo hanya di 4 halaman
// utama; selain itu tampilkan tombol back (history.back()).
const showMobileTopBar = $derived(!isAdminRoute && !isReadImmersive);
const isMainPage = $derived(
	pathname === "/" ||
		pathname === "/anime" ||
		pathname === "/library" ||
		pathname === "/profile",
);
const showBackButton = $derived(showMobileTopBar && !isMainPage);

function goBack() {
	if (window.history.length > 1) {
		window.history.back();
	} else {
		window.location.assign("/");
	}
}
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
		{#if showBackButton}
			<button type="button" class="mobile-top-back" onclick={goBack} aria-label="Kembali">
				<ArrowLeft aria-hidden="true" />
			</button>
		{:else}
			<a href="/" class="site-brand" aria-label="MIFE · Beranda">
				<AppLogo size={32} />
			</a>
		{/if}
		<UserMenu minimal />
	</div>
{/if}
