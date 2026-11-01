<script lang="ts">
import "../app.css";
import MobileNav from "#lib/components/layout/MobileNav.svelte";
import SiteFooter from "#lib/components/layout/SiteFooter.svelte";
import SiteHeader from "#lib/components/layout/SiteHeader.svelte";
import { Toaster } from "#lib/components/ui/sonner/index.js";

const { children } = $props();
</script>

<div class="grid min-h-svh grid-rows-[auto_1fr_auto]">
	<SiteHeader />
	<main class="pb-[84px] lg:pb-0">
		{@render children()}
	</main>
	<SiteFooter />
</div>
<MobileNav />
<Toaster position="top-center" />
