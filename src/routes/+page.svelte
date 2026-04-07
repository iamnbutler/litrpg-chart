<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { getCurrentSeason } from '$lib/types';

	onMount(() => {
		const year = new Date().getFullYear();
		const season = getCurrentSeason();
		goto(`${base}/${year}/${season}`, { replaceState: true });
	});
</script>

<div class="loading">
	<p>Loading...</p>
</div>

<style>
	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: var(--text-muted);
		font-family: var(--font-mono);
	}
</style>
