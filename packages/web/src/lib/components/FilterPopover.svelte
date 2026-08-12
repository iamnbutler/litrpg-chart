<script lang="ts">
	let {
		seriesOnly,
		longRunningOnly,
		mySeriesOnly,
		watchedCount,
		hiddenCount,
		onSeriesOnlyChange,
		onLongRunningChange,
		onMySeriesChange,
		onClearHidden,
	}: {
		seriesOnly: boolean;
		longRunningOnly: boolean;
		mySeriesOnly: boolean;
		watchedCount: number;
		hiddenCount: number;
		onSeriesOnlyChange: (v: boolean) => void;
		onLongRunningChange: (v: boolean) => void;
		onMySeriesChange: (v: boolean) => void;
		onClearHidden: () => void;
	} = $props();

	let open = $state(false);

	const activeCount = $derived((seriesOnly ? 1 : 0) + (longRunningOnly ? 1 : 0) + (mySeriesOnly ? 1 : 0));
</script>

<div class="filter-popover">
	<button class="trigger" class:has-filters={activeCount > 0} onclick={() => open = !open} aria-label="Filters{activeCount > 0 ? ` (${activeCount} active)` : ''}">
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
			<path d="M1 3h14M4 8h8M6 13h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
		</svg>
		{#if activeCount > 0}<span class="badge">{activeCount}</span>{/if}
	</button>

	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="backdrop" onclick={() => open = false} onkeydown={() => {}}></div>
		<div class="popover">
			<label class="filter-option">
				<input type="checkbox" checked={seriesOnly} onchange={() => onSeriesOnlyChange(!seriesOnly)} />
				<span class="label-text">
					Series only
					<span class="label-desc">Hide standalone books</span>
				</span>
			</label>
			<label class="filter-option">
				<input type="checkbox" checked={longRunningOnly} onchange={() => onLongRunningChange(!longRunningOnly)} />
				<span class="label-text">
					Long-running series
					<span class="label-desc">8+ books in the series</span>
				</span>
			</label>
			<label class="filter-option">
				<input type="checkbox" checked={mySeriesOnly} onchange={() => onMySeriesChange(!mySeriesOnly)} />
				<span class="label-text">
					My series
					<span class="label-desc">{watchedCount === 0 ? 'Watch a series from its page first' : `Only the ${watchedCount} series you watch`}</span>
				</span>
			</label>
			{#if hiddenCount > 0}
				<button class="clear-hidden" onclick={onClearHidden}>
					Unhide {hiddenCount} hidden item{hiddenCount !== 1 ? 's' : ''}
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.filter-popover {
		position: relative;
	}

	.trigger {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem;
		border: none;
		background: transparent;
		color: var(--text-muted);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.trigger:hover {
		color: var(--text-primary);
	}

	.trigger.has-filters {
		color: var(--accent);
	}

	.badge {
		position: absolute;
		top: -2px;
		right: -4px;
		font-family: var(--font-mono);
		font-size: 0.55rem;
		font-weight: 700;
		background: var(--accent);
		color: var(--bg);
		width: 14px;
		height: 14px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 19;
	}

	.popover {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem;
		min-width: 200px;
		z-index: 20;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.filter-option {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.1s;
	}

	.filter-option:hover {
		background: color-mix(in srgb, var(--border) 50%, transparent);
	}

	.filter-option input[type="checkbox"] {
		margin-top: 2px;
		accent-color: var(--accent);
	}

	.label-text {
		display: flex;
		flex-direction: column;
		font-family: var(--font-serif);
		font-size: 0.8rem;
		color: var(--text-primary);
		line-height: 1.3;
	}

	.label-desc {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		color: var(--text-muted);
	}

	.clear-hidden {
		margin-top: 0.25rem;
		padding: 0.4rem 0.5rem;
		border: none;
		border-top: 1px solid var(--border);
		border-radius: 0 0 6px 6px;
		background: transparent;
		font-family: var(--font-mono);
		font-size: 0.65rem;
		color: var(--text-muted);
		cursor: pointer;
		text-align: left;
		transition: color 0.1s;
	}

	.clear-hidden:hover {
		color: var(--accent);
	}
</style>
