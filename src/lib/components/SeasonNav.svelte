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

	const currentYear = new Date().getFullYear();
	const yearOptions = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];
</script>

<div class="season-nav">
	<select
		class="year-select"
		value={activeYear}
		onchange={(e) => onSeasonChange(activeQuarter, parseInt(e.currentTarget.value, 10))}
	>
		{#each yearOptions as y}
			<option value={y}>{y}</option>
		{/each}
	</select>

	<div class="seasons">
		{#each seasons as s}
			<button
				class="season-btn"
				class:active={activeQuarter === s.value}
				onclick={() => onSeasonChange(s.value, activeYear)}
			>
				{s.label}
			</button>
		{/each}
	</div>
</div>

<style>
	.season-nav {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.year-select {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary);
		background: transparent;
		border: none;
		cursor: pointer;
		appearance: none;
		padding: 0.3rem 1.2rem 0.3rem 0.3rem;
		background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23928374' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.2rem center;
	}

	.year-select option {
		background: var(--surface);
		color: var(--text-primary);
	}

	.seasons {
		display: flex;
		gap: 0;
	}

	.season-btn {
		padding: 0.45rem 1rem;
		border: none;
		background: transparent;
		color: var(--text-muted);
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.15s ease;
		font-family: var(--font-serif);
		font-size: 0.85rem;
		font-weight: 500;
		line-height: 1;
	}

	.season-btn:hover {
		color: var(--text-secondary);
	}

	.season-btn.active {
		background: var(--card-bg);
		color: var(--text-primary);
		font-weight: 700;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
	}

	@media (max-width: 600px) {
		.seasons {
			flex: 1;
		}

		.season-btn {
			flex: 1;
			padding: 0.45rem 0.5rem;
			text-align: center;
		}
	}
</style>
