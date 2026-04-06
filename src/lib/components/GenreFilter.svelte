<script lang="ts">
	import type { Subgenre } from '$lib/types';
	import { subgenreLabels, subgenreColors } from '$lib/types';

	let {
		activeGenres,
		counts = {},
		onGenreToggle
	}: {
		activeGenres: Set<Subgenre>;
		counts?: Record<string, number>;
		onGenreToggle: (g: Subgenre) => void;
	} = $props();

	const genres = Object.entries(subgenreLabels) as [Subgenre, string][];
</script>

<div class="genres">
	{#each genres as [key, label]}
		<button
			class="genre-btn"
			class:active={activeGenres.has(key)}
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

	.genre-count {
		opacity: 0.6;
	}
</style>
