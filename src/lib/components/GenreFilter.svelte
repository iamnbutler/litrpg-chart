<script lang="ts">
	import type { Subgenre } from '$lib/types';
	import { subgenreLabels, subgenreColors } from '$lib/types';

	let {
		activeGenres,
		onGenreToggle
	}: {
		activeGenres: Set<Subgenre>;
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
			{label}
		</button>
	{/each}
</div>

<style>
	.genres {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.genre-btn {
		padding: 0.35rem 0.85rem;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-muted);
		border-radius: 20px;
		cursor: pointer;
		font-size: 0.75rem;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.genre-btn:hover {
		border-color: var(--genre-color);
		color: var(--genre-color);
	}

	.genre-btn.active {
		background: color-mix(in srgb, var(--genre-color) 15%, transparent);
		border-color: var(--genre-color);
		color: var(--genre-color);
	}
</style>
