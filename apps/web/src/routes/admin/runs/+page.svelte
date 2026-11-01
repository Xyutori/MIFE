<script lang="ts">
import ComicScrapePanel from "#lib/components/admin/ComicScrapePanel.svelte";
import ScrapeRunsPanel from "#lib/components/admin/ScrapeRunsPanel.svelte";
import ScrapeSchedulePanel from "#lib/components/admin/ScrapeSchedulePanel.svelte";
import SuperKomikJobsPanel from "#lib/components/admin/SuperKomikJobsPanel.svelte";
import SegmentedTabs from "#lib/components/ui/SegmentedTabs.svelte";

type Tab = "anime" | "comic" | "super";

let tab = $state<Tab>("anime");

const tabs: Array<{ id: Tab; label: string }> = [
	{ id: "anime", label: "Anime" },
	{ id: "comic", label: "Komik" },
	{ id: "super", label: "Super Komik" },
];
</script>

<svelte:head>
	<title>Scrapper · MIFE</title>
</svelte:head>

<SegmentedTabs
	tabs={tabs}
	value={tab}
	onChange={(id) => (tab = id as Tab)}
	ariaLabel="Jenis scrape"
	class="mb-5"
/>

{#if tab === "anime"}
	<div role="tabpanel" id="panel-anime" aria-labelledby="tab-anime">
		<ScrapeRunsPanel />
		<div class="mt-5">
			<ScrapeSchedulePanel />
		</div>
	</div>
{:else if tab === "comic"}
	<div role="tabpanel" id="panel-comic" aria-labelledby="tab-comic">
		<ComicScrapePanel />
		<div class="mt-5">
			<ScrapeSchedulePanel />
		</div>
	</div>
{:else}
	<div role="tabpanel" id="panel-super" aria-labelledby="tab-super">
		<SuperKomikJobsPanel />
	</div>
{/if}
