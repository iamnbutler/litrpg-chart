<script lang="ts">
	import type { Season } from '$lib/types';
	import { seasonLabels } from '$lib/types';

	let {
		availableYears,
		currentYear,
		currentSeason,
		seasonHasData,
		onJump
	}: {
		availableYears: number[];
		currentYear: number;
		currentSeason: Season;
		seasonHasData: (year: number, season: Season) => boolean;
		onJump: (year: number, season: Season) => void;
	} = $props();

	const seasons: Season[] = ['fall', 'summer', 'spring', 'winter'];
	const displayYears = $derived([...availableYears].reverse());
</script>

<nav class="timeline-ruler" aria-label="Timeline">
	<div class="ruler-track">
		{#each displayYears as year}
			<div class="year-group">
				<button
					class="year-label"
					class:active={currentYear === year}
					onclick={() => onJump(year, 'fall')}
				>
					{year}
				</button>
				<div class="season-ticks">
					{#each seasons as season}
						{#if seasonHasData(year, season)}
							<button
								class="tick"
								class:active={currentYear === year && currentSeason === season}
								onclick={() => onJump(year, season)}
								title="{seasonLabels[season]} {year}"
							>
								<span class="tick-mark"></span>
							</button>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
	</div>
</nav>

<style>
	.timeline-ruler {
		position: fixed;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
		z-index: 15;
		height: 70vh;
		display: flex;
		align-items: center;
	}

	.ruler-track {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: space-between;
		height: 100%;
	}

	.year-group {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		flex: 1;
	}

	.year-label {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--text-muted);
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: 3px;
		transition: all 0.15s;
		line-height: 1;
	}

	.year-label:hover {
		color: var(--text-primary);
	}

	.year-label.active {
		color: var(--accent);
		font-weight: 700;
	}

	.season-ticks {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		padding-right: 4px;
		flex: 1;
	}

	.tick {
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px 4px;
		display: flex;
		align-items: center;
	}

	.tick-mark {
		display: block;
		width: 10px;
		height: 2px;
		background: var(--border);
		border-radius: 1px;
		transition: all 0.15s;
	}

	.tick:hover .tick-mark {
		background: var(--text-secondary);
		width: 16px;
	}

	.tick.active .tick-mark {
		background: var(--accent);
		width: 22px;
		height: 3px;
	}

	@media (max-width: 768px) {
		.timeline-ruler {
			display: none;
		}
	}
</style>
