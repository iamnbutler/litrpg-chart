<script lang="ts">
	import { base } from '$app/paths';
	import {
		prefs,
		tierKey,
		TIER_IDS,
		type TierEntry,
		type TierRowId
	} from '$lib/prefs.svelte';

	const TIER_COLORS: Record<TierRowId, string> = {
		S: 'var(--red-bright)',
		A: 'var(--orange-bright)',
		B: 'var(--yellow-bright)',
		F: 'var(--yellow)',
		DNF: 'var(--green-bright)',
		shelf: 'var(--text-muted)'
	};

	let selected = $state<{ kind: TierEntry['kind']; id: string } | null>(null);
	let dragKey = $state<string | null>(null);
	let dragOverRow = $state<TierRowId | null>(null);

	const selectedEntry = $derived.by((): TierEntry | null => {
		if (!selected) return null;
		const key = tierKey(selected);
		for (const row of [...TIER_IDS, 'shelf'] as TierRowId[]) {
			const found = prefs.tierList[row].find((e) => tierKey(e) === key);
			if (found) return found;
		}
		return null;
	});
	const selectedRow = $derived(selected ? prefs.tierRowOf(selected.kind, selected.id) : null);

	function toggleSelect(entry: TierEntry) {
		selected =
			selected && tierKey(selected) === tierKey(entry)
				? null
				: { kind: entry.kind, id: entry.id };
	}

	function moveSelected(row: TierRowId) {
		if (!selected) return;
		prefs.placeTierEntry(selected.kind, selected.id, row);
	}

	function removeSelected() {
		if (!selected) return;
		prefs.removeTierEntry(selected.kind, selected.id);
		selected = null;
	}

	// ---- Drag & drop ----
	function handleDragStart(e: DragEvent, entry: TierEntry) {
		dragKey = tierKey(entry);
		selected = null;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', dragKey);
		}
	}

	function parseKey(key: string): { kind: TierEntry['kind']; id: string } | null {
		const sep = key.indexOf(':');
		if (sep < 0) return null;
		const kind = key.slice(0, sep);
		if (kind !== 'book' && kind !== 'series') return null;
		return { kind, id: key.slice(sep + 1) };
	}

	function handleRowDrop(e: DragEvent, row: TierRowId) {
		e.preventDefault();
		dragOverRow = null;
		const key = dragKey ?? e.dataTransfer?.getData('text/plain') ?? '';
		const parsed = parseKey(key);
		dragKey = null;
		if (parsed) prefs.placeTierEntry(parsed.kind, parsed.id, row);
	}

	function handleEntryDrop(e: DragEvent, row: TierRowId, target: TierEntry) {
		e.preventDefault();
		e.stopPropagation();
		dragOverRow = null;
		const key = dragKey ?? e.dataTransfer?.getData('text/plain') ?? '';
		const parsed = parseKey(key);
		dragKey = null;
		if (!parsed || tierKey(parsed) === tierKey(target)) return;
		const list = prefs.tierList[row];
		const targetIdx = list.findIndex((en) => tierKey(en) === tierKey(target));
		const sourceIdx = list.findIndex((en) => tierKey(en) === key);
		// placeTierEntry pulls the entry out first, so if it came from earlier
		// in this same row the insertion point shifts back by one.
		const at = targetIdx - (sourceIdx >= 0 && sourceIdx < targetIdx ? 1 : 0);
		prefs.placeTierEntry(parsed.kind, parsed.id, row, at);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') selected = null;
	}

	const rows = $derived([...TIER_IDS] as TierRowId[]);
</script>

<svelte:head>
	<title>LitRPG Chart — Tier List</title>
</svelte:head>

<svelte:window on:keydown={handleKeydown} />

<div class="app">
	<header>
		<div class="header-inner">
			<a class="back" href="{base}/">&larr; Chart</a>
			<h1 class="title">My Tier List</h1>
			<span class="count">{prefs.tierCount} entr{prefs.tierCount === 1 ? 'y' : 'ies'}</span>
		</div>
	</header>

	<main>
		{#if prefs.tierCount === 0}
			<div class="empty">
				<p>Nothing here yet.</p>
				<p class="empty-sub">
					Click any book on <a href="{base}/">the chart</a> and choose
					&ldquo;Add book&rdquo; or &ldquo;Add series&rdquo; &mdash; it lands on your shelf below,
					then drag it (or tap it) into a tier.
				</p>
			</div>
		{:else}
			<div class="tiers">
				{#each rows as row (row)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="tier-row"
						class:drag-over={dragOverRow === row}
						ondragover={(e) => { e.preventDefault(); dragOverRow = row; }}
						ondragleave={() => { if (dragOverRow === row) dragOverRow = null; }}
						ondrop={(e) => handleRowDrop(e, row)}
					>
						<div class="tier-label" style="--tier-color: {TIER_COLORS[row]}">{row}</div>
						<div class="tier-entries">
							{#each prefs.tierList[row] as entry (tierKey(entry))}
								{@render entryTile(entry, row)}
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="shelf"
				class:drag-over={dragOverRow === 'shelf'}
				ondragover={(e) => { e.preventDefault(); dragOverRow = 'shelf'; }}
				ondragleave={() => { if (dragOverRow === 'shelf') dragOverRow = null; }}
				ondrop={(e) => handleRowDrop(e, 'shelf')}
			>
				<div class="shelf-head">
					<span class="shelf-title">Shelf</span>
					<span class="shelf-hint">unplaced &mdash; drag into a tier, or tap to place</span>
				</div>
				<div class="tier-entries shelf-entries">
					{#each prefs.tierList.shelf as entry (tierKey(entry))}
						{@render entryTile(entry, 'shelf')}
					{:else}
						<span class="shelf-empty">Empty &mdash; add more from <a href="{base}/">the chart</a></span>
					{/each}
				</div>
			</div>
		{/if}
	</main>

	{#if selected && selectedEntry}
		<div class="placer">
			<div class="placer-inner">
				<span class="placer-title">{selectedEntry.title}{selectedEntry.kind === 'series' ? ' (series)' : ''}</span>
				<div class="placer-controls">
					<div class="placer-tiers">
						{#each [...TIER_IDS, 'shelf'] as TierRowId[] as row (row)}
							<button
								class="placer-tier"
								class:current={selectedRow === row}
								style="--tier-color: {TIER_COLORS[row]}"
								onclick={() => moveSelected(row)}
							>{row === 'shelf' ? '—' : row}</button>
						{/each}
					</div>
					<div class="placer-actions">
						<button class="placer-btn" title="Move left" disabled={!selectedRow} onclick={() => selected && prefs.nudgeTierEntry(selected.kind, selected.id, -1)}>&larr;</button>
						<button class="placer-btn" title="Move right" disabled={!selectedRow} onclick={() => selected && prefs.nudgeTierEntry(selected.kind, selected.id, 1)}>&rarr;</button>
						<button class="placer-btn danger" onclick={removeSelected}>Remove</button>
						<button class="placer-btn" onclick={() => (selected = null)}>Done</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

{#snippet entryTile(entry: TierEntry, row: TierRowId)}
	<button
		class="entry"
		class:selected={selected && tierKey(selected) === tierKey(entry)}
		class:dragging={dragKey === tierKey(entry)}
		draggable="true"
		title={entry.title}
		ondragstart={(e) => handleDragStart(e, entry)}
		ondragend={() => { dragKey = null; dragOverRow = null; }}
		ondragover={(e) => { e.preventDefault(); dragOverRow = row; }}
		ondrop={(e) => handleEntryDrop(e, row, entry)}
		onclick={() => toggleSelect(entry)}
	>
		{#if entry.coverUrl}
			<img src={entry.coverUrl} alt={entry.title} loading="lazy" draggable="false" />
		{:else}
			<span class="entry-fallback">{entry.title}</span>
		{/if}
		{#if entry.kind === 'series'}
			<span class="series-badge">series</span>
		{/if}
	</button>
{/snippet}

<style>
	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	header {
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.header-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0.75rem 2rem;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.back {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-muted);
		text-decoration: none;
		white-space: nowrap;
	}

	.back:hover {
		color: var(--text-primary);
	}

	.title {
		font-family: var(--font-serif);
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.01em;
		flex: 1;
	}

	.count {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-muted);
		white-space: nowrap;
	}

	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem 2rem 7rem;
		width: 100%;
		flex: 1;
	}

	.tiers {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--bg-soft);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 4px;
	}

	.tier-row {
		display: flex;
		align-items: stretch;
		gap: 4px;
		min-height: 88px;
		border-radius: 8px;
		transition: background 0.1s;
	}

	.tier-row.drag-over {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.tier-label {
		width: 72px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--tier-color);
		color: var(--bg);
		font-family: var(--font-mono);
		font-size: 1.1rem;
		font-weight: 800;
		border-radius: 8px;
	}

	.tier-entries {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-content: flex-start;
		flex: 1;
		min-width: 0;
		padding: 2px 0;
	}

	.entry {
		position: relative;
		width: 84px;
		height: 84px;
		padding: 0;
		border: 2px solid transparent;
		border-radius: 6px;
		overflow: hidden;
		background: var(--surface);
		cursor: grab;
		flex-shrink: 0;
	}

	.entry:active {
		cursor: grabbing;
	}

	.entry.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
	}

	.entry.dragging {
		opacity: 0.4;
	}

	.entry img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.entry-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		padding: 4px;
		font-family: var(--font-serif);
		font-size: 0.55rem;
		line-height: 1.25;
		color: var(--text-secondary);
		text-align: center;
		overflow: hidden;
	}

	.series-badge {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: color-mix(in srgb, var(--bg) 80%, transparent);
		color: var(--accent);
		font-family: var(--font-mono);
		font-size: 0.5rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		text-align: center;
		padding: 1px 0;
	}

	.shelf {
		margin-top: 1.25rem;
		border: 1px dashed var(--border);
		border-radius: 12px;
		padding: 0.75rem;
		transition: background 0.1s, border-color 0.1s;
	}

	.shelf.drag-over {
		background: color-mix(in srgb, var(--accent) 8%, transparent);
		border-color: var(--accent);
	}

	.shelf-head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.shelf-title {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-secondary);
	}

	.shelf-hint {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		color: var(--text-muted);
	}

	.shelf-empty {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-muted);
		padding: 0.5rem 0;
	}

	.shelf-empty a {
		color: var(--accent);
	}

	.empty {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--text-muted);
	}

	.empty-sub {
		font-size: 0.85rem;
		margin-top: 0.5rem;
		opacity: 0.85;
		max-width: 420px;
		margin-left: auto;
		margin-right: auto;
		line-height: 1.5;
	}

	.empty-sub a {
		color: var(--accent);
	}

	/* ---- Bottom placement toolbar ---- */
	.placer {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 30;
		display: flex;
		justify-content: center;
		padding: 0 0.75rem calc(0.75rem + env(safe-area-inset-bottom));
		pointer-events: none;
	}

	.placer-inner {
		pointer-events: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		padding: 0.6rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 560px;
		width: 100%;
	}

	.placer-title {
		font-family: var(--font-serif);
		font-size: 0.8rem;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.placer-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.placer-tiers {
		display: flex;
		gap: 0.3rem;
	}

	.placer-tier {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 800;
		width: 32px;
		height: 28px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--tier-color);
		cursor: pointer;
		transition: background 0.1s, border-color 0.1s;
	}

	.placer-tier:hover {
		border-color: var(--tier-color);
	}

	.placer-tier.current {
		background: var(--tier-color);
		color: var(--bg);
		border-color: var(--tier-color);
	}

	.placer-actions {
		display: flex;
		gap: 0.3rem;
	}

	.placer-btn {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		padding: 0.3rem 0.55rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.placer-btn:hover:not(:disabled) {
		color: var(--text-primary);
		border-color: var(--text-muted);
	}

	.placer-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.placer-btn.danger:hover {
		color: var(--red-bright);
		border-color: var(--red-bright);
	}

	@media (max-width: 600px) {
		.header-inner {
			padding: 0.75rem;
		}

		main {
			padding: 1rem 0.75rem 8rem;
		}

		.tier-label {
			width: 48px;
			font-size: 0.9rem;
		}

		.tier-row {
			min-height: 68px;
		}

		.entry {
			width: 64px;
			height: 64px;
		}
	}
</style>
