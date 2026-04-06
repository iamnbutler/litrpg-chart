<script lang="ts">
	import type { Quarter } from '$lib/types';

	let {
		activeQuarter,
		activeYear,
		onSeasonChange
	}: {
		activeQuarter: Quarter;
		activeYear: number;
		onSeasonChange: (q: Quarter, year: number) => void;
	} = $props();

	const seasons: { value: Quarter; label: string }[] = [
		{ value: 'Q1', label: 'Winter' },
		{ value: 'Q2', label: 'Spring' },
		{ value: 'Q3', label: 'Summer' },
		{ value: 'Q4', label: 'Fall' }
	];

	function prevYear() {
		onSeasonChange(activeQuarter, activeYear - 1);
	}

	function nextYear() {
		onSeasonChange(activeQuarter, activeYear + 1);
	}
</script>

<div class="season-nav">
	<button class="year-arrow" onclick={prevYear} aria-label="Previous year">&larr;</button>

	<div class="seasons">
		{#each seasons as s}
			<button
				class="season-btn"
				class:active={activeQuarter === s.value}
				onclick={() => onSeasonChange(s.value, activeYear)}
			>
				<span class="season-label">{s.label}</span>
				<span class="season-year">{activeYear}</span>
			</button>
		{/each}
	</div>

	<button class="year-arrow" onclick={nextYear} aria-label="Next year">&rarr;</button>
</div>

<style>
	.season-nav {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.year-arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: none;
		background: var(--surface);
		color: var(--text-muted);
		border-radius: 8px;
		cursor: pointer;
		font-size: 1rem;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.year-arrow:hover {
		color: var(--text-primary);
		background: var(--card-bg);
	}

	.seasons {
		display: flex;
		gap: 0;
		background: var(--surface);
		padding: 4px;
		border-radius: 10px;
	}

	.season-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 0.45rem 1.25rem;
		border: none;
		background: transparent;
		color: var(--text-muted);
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.15s ease;
		line-height: 1;
	}

	.season-label {
		font-family: var(--font-serif);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.season-year {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		font-weight: 400;
		opacity: 0.6;
	}

	.season-btn:hover {
		color: var(--text-secondary);
	}

	.season-btn.active {
		background: var(--card-bg);
		color: var(--text-primary);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
	}

	.season-btn.active .season-year {
		opacity: 0.8;
	}

	@media (max-width: 600px) {
		.seasons {
			flex: 1;
		}

		.season-btn {
			flex: 1;
			padding: 0.45rem 0.5rem;
		}
	}
</style>
