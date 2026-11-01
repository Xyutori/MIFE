<script lang="ts">
	import LoginCta from "#lib/components/profile/LoginCta.svelte";
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();

</script>

	{#if data.user}
	<div>
		<h1>Dashboard</h1>
		<p>Welcome {data.user.name}</p>
	</div>
	{:else}
	<LoginCta callbackPath="/dashboard" />
	{/if}
