<script lang="ts">
	import type { Season } from '$lib/types';
	import { seasonLabels } from '$lib/types';

	let {
		currentYear,
		currentSeason,
		availableYears,
		onJump
	}: {
		currentYear: number;
		currentSeason: Season;
		availableYears: number[];
		onJump: (year: number, season: Season) => void;
	} = $props();

	let open = $state(false);

	const displayYears = $derived([...availableYears].reverse());

	function handleYearClick(year: number) {
		onJump(year, 'fall');
		open = false;
	}
</script>

<div class="pill-container">
	<button class="pill" onclick={() => (open = !open)}>
		<span class="pill-text">{seasonLabels[currentSeason]} {currentYear}</span>
		<svg class="pill-chevron" class:open width="10" height="6" viewBox="0 0 10 6" fill="none">
			<path
				d="M1 1l4 4 4-4"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>

	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => (open = false)} onkeydown={() => {}}></div>
		<div class="dropdown">
			{#each displayYears as year}
				<button
					class="dropdown-year"
					class:active={currentYear === year}
					onclick={() => handleYearClick(year)}
				>
					{year}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.pill-container {
		position: relative;
	}

	.pill {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.85rem;
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-family: var(--font-serif);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.pill:hover {
		color: var(--accent);
	}

	.pill-chevron {
		transition: transform 0.2s;
		opacity: 0.5;
	}

	.pill-chevron.open {
		transform: rotate(180deg);
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 19;
	}

	.dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 0.35rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 80px;
		z-index: 20;
	}

	.dropdown-year {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.35rem 0.75rem;
		border-radius: 8px;
		transition: all 0.1s;
		text-align: center;
	}

	.dropdown-year:hover {
		background: var(--card-bg);
		color: var(--text-primary);
	}

	.dropdown-year.active {
		color: var(--accent);
		font-weight: 700;
	}

	/* Mobile: floating pill at bottom */
	@media (max-width: 600px) {
		.pill-container {
			position: fixed;
			bottom: calc(0.75rem + env(safe-area-inset-bottom));
			left: 50%;
			transform: translateX(-50%);
			z-index: 20;
		}

		.pill {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: 16px;
			padding: 0.45rem 1rem;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		}

		.dropdown {
			bottom: calc(100% + 6px);
			top: auto;
		}
	}
</style>
