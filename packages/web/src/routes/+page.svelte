<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { fetchMeta } from '$lib/data';

	onMount(async () => {
		const meta = await fetchMeta();
		const years = Object.keys(meta?.years ?? {})
			.map(Number)
			.sort((a, b) => a - b);
		const current = new Date().getFullYear();
		const target = years.includes(current) ? current : (years.at(-1) ?? current);
		goto(`${base}/${target}`, { replaceState: true });
	});
</script>

<div class="loading">Loading…</div>

<style>
	.loading {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}
</style>
