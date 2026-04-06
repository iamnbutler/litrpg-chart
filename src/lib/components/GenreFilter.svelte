<script lang="ts">
	import type { Subgenre } from '$lib/types';
	import { subgenreLabels, subgenreColors, filterSubgenres } from '$lib/types';

	let {
		activeGenres,
		counts = {},
		onGenreToggle,
		onAllToggle
	}: {
		activeGenres: Set<Subgenre>;
		counts?: Record<string, number>;
		onGenreToggle: (g: Subgenre) => void;
		onAllToggle: () => void;
	} = $props();

	const isAll = $derived(activeGenres.size === 0);

	const genres = $derived(
		filterSubgenres
			.filter((key) => (counts[key] ?? 0) > 0)
			.map((key) => [key, subgenreLabels[key]] as [Subgenre, string])
	);

	const totalCount = $derived(
		Object.values(counts).reduce((sum, n) => sum + n, 0)
	);
</script>

<div class="genres">
	<button
		class="genre-btn all-btn"
		class:active={isAll}
		onclick={onAllToggle}
	>
		All{#if totalCount > 0}<span class="genre-count">&nbsp;{totalCount}</span>{/if}
	</button>
	{#each genres as [key, label]}
		<button
			class="genre-btn"
			class:active={isAll || activeGenres.has(key)}
			style="--genre-color: {subgenreColors[key]}"
			onclick={() => onGenreToggle(key)}
		>
			{label}{#if counts[key] != null}<span class="genre-count">&nbsp;{counts[key]}</span>{/if}
		</button>
	{/each}
</div>

<style>
	.genres {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.genre-btn {
		padding: 0;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 500;
		transition: color 0.15s ease, filter 0.15s ease;
		filter: grayscale(1);
	}

	.genre-btn:hover {
		color: var(--text-secondary);
		filter: grayscale(0.5);
	}

	.genre-btn.active {
		color: var(--genre-color);
		font-weight: 700;
		filter: grayscale(0);
	}

	.all-btn {
		--genre-color: var(--text-primary);
	}

	.genre-count {
		opacity: 0.6;
	}
</style>
