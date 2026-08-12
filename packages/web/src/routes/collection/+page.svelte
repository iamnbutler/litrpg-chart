<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import type { Book } from '$lib/types';
	import { fetchSeriesBooks } from '$lib/data';
	import { prefs, TIER_IDS, type TierId } from '$lib/prefs.svelte';

	let { data } = $props();

	const TIER_COLORS: Record<string, string> = {
		S: 'var(--red-bright)',
		A: 'var(--orange-bright)',
		B: 'var(--yellow-bright)',
		F: 'var(--yellow)',
		DNF: 'var(--green-bright)',
		shelf: 'var(--text-muted)'
	};

	const activeTab = $derived(page.url.searchParams.get('tab') === 'tiers' ? 'tiers' : 'collection');

	function switchTab(tab: 'collection' | 'tiers') {
		const params = new URLSearchParams(page.url.searchParams);
		if (tab === 'tiers') params.set('tab', 'tiers');
		else params.delete('tab');
		const qs = params.toString();
		goto(qs ? `${base}/collection?${qs}` : `${base}/collection`, { noScroll: true, keepFocus: true });
	}

	// ---- Series info (from the exported index) + per-series books ----

	const seriesInfo = $derived(new Map(data.seriesIndex.map((s) => [s.asin, s])));

	let seriesBooks = $state(new Map<string, Book[]>());

	$effect(() => {
		const wanted = [...new Set([...prefs.watchedSeries, ...prefs.rankedSeries])];
		const missing = wanted.filter((asin) => !seriesBooks.has(asin));
		if (missing.length === 0) return;
		let cancelled = false;
		(async () => {
			const loaded = await Promise.all(missing.map((asin) => fetchSeriesBooks(asin)));
			if (cancelled) return;
			const next = new Map(seriesBooks);
			missing.forEach((asin, i) => next.set(asin, loaded[i]));
			seriesBooks = next;
		})();
		return () => {
			cancelled = true;
		};
	});

	function nameOf(asin: string): string {
		return seriesInfo.get(asin)?.name ?? seriesBooks.get(asin)?.[0]?.seriesName ?? asin;
	}

	function coverOf(asin: string): string | null {
		return seriesInfo.get(asin)?.coverUrl ?? seriesBooks.get(asin)?.[0]?.coverUrl ?? null;
	}

	// ---- Collection tab ----

	let view = $state<'rows' | 'grid'>('rows');
	let sortBy = $state<'next' | 'name'>('next');

	const today = new Date().toISOString().slice(0, 10);

	function nextBook(asin: string): Book | null {
		const books = seriesBooks.get(asin) ?? [];
		let best: Book | null = null;
		for (const b of books) {
			if (b.releaseDate <= today) continue;
			if (!best || b.releaseDate < best.releaseDate) best = b;
		}
		return best;
	}

	function lastRelease(asin: string): string {
		const books = seriesBooks.get(asin) ?? [];
		return books.reduce((max, b) => (b.releaseDate > max ? b.releaseDate : max), '');
	}

	const collection = $derived.by(() => {
		const list = [...prefs.watchedSeries];
		if (sortBy === 'name') {
			return list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
		}
		// "next": upcoming releases first (soonest first), then the rest by
		// most recent release; alphabetical only as a last resort.
		return list.sort((a, b) => {
			const na = nextBook(a)?.releaseDate ?? null;
			const nb = nextBook(b)?.releaseDate ?? null;
			if (na && nb) return na.localeCompare(nb);
			if (na) return -1;
			if (nb) return 1;
			const la = lastRelease(a);
			const lb = lastRelease(b);
			if (la !== lb) return lb.localeCompare(la);
			return nameOf(a).localeCompare(nameOf(b));
		});
	});

	function daysUntil(dateStr: string): number {
		return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
	}

	function shortDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}

	function readCount(asin: string): { read: number; released: number } {
		const books = seriesBooks.get(asin) ?? [];
		const released = books.filter((b) => b.releaseDate <= today);
		return {
			read: released.filter((b) => prefs.isRead(b.asin)).length,
			released: released.length
		};
	}

	// ---- Tier list tab ----

	const shelf = $derived.by(() => {
		const ranked = prefs.rankedSeries;
		return [...prefs.watchedSeries].filter((asin) => !ranked.has(asin));
	});

	let selected = $state<string | null>(null);
	let dragAsin = $state<string | null>(null);
	let dragOverRow = $state<string | null>(null);

	function moveSelected(row: TierId | 'shelf') {
		if (!selected) return;
		if (row === 'shelf') prefs.unrank(selected);
		else prefs.placeInTier(selected, row);
	}

	function handleDragStart(e: DragEvent, asin: string) {
		dragAsin = asin;
		selected = null;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', asin);
		}
	}

	function handleRowDrop(e: DragEvent, row: TierId | 'shelf') {
		e.preventDefault();
		dragOverRow = null;
		const asin = dragAsin ?? e.dataTransfer?.getData('text/plain') ?? '';
		dragAsin = null;
		if (!asin) return;
		if (row === 'shelf') prefs.unrank(asin);
		else prefs.placeInTier(asin, row);
	}

	function handleEntryDrop(e: DragEvent, row: TierId, target: string) {
		e.preventDefault();
		e.stopPropagation();
		dragOverRow = null;
		const asin = dragAsin ?? e.dataTransfer?.getData('text/plain') ?? '';
		dragAsin = null;
		if (!asin || asin === target) return;
		const list = prefs.tierList[row];
		const targetIdx = list.indexOf(target);
		const sourceIdx = list.indexOf(asin);
		// placeInTier pulls the series out first, so a move from earlier in
		// this same row shifts the insertion point back by one.
		const at = targetIdx - (sourceIdx >= 0 && sourceIdx < targetIdx ? 1 : 0);
		prefs.placeInTier(asin, row, at);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') selected = null;
	}
</script>

<svelte:head>
	<title>LitRPG Chart — Collection</title>
</svelte:head>

<svelte:window on:keydown={handleKeydown} />

<div class="app">
	<header>
		<div class="header-inner">
			<a class="back" href="{base}/">&larr; Chart</a>
			<h1 class="title">My Collection</h1>
			<nav class="tabs">
				<button class="tab" class:active={activeTab === 'collection'} onclick={() => switchTab('collection')}>
					Collection
				</button>
				<button class="tab" class:active={activeTab === 'tiers'} onclick={() => switchTab('tiers')}>
					Tier list
				</button>
			</nav>
		</div>
	</header>

	<main>
		{#if prefs.watchedSeries.size === 0}
			<div class="empty">
				<p>No series in your collection yet.</p>
				<p class="empty-sub">
					Click any book on <a href="{base}/">the chart</a> and choose
					&ldquo;Add series to collection&rdquo;. Your series show up here, with a tier list to rank them.
				</p>
			</div>
		{:else if activeTab === 'collection'}
			<div class="toolbar">
				<div class="sort-toggle">
					<button class="sort-btn" class:active={sortBy === 'next'} onclick={() => (sortBy = 'next')}>Next release</button>
					<button class="sort-btn" class:active={sortBy === 'name'} onclick={() => (sortBy = 'name')}>A&ndash;Z</button>
				</div>
				<span class="count">{prefs.watchedSeries.size} series</span>
				<div class="sort-toggle">
					<button class="sort-btn" class:active={view === 'rows'} onclick={() => (view = 'rows')}>Rows</button>
					<button class="sort-btn" class:active={view === 'grid'} onclick={() => (view = 'grid')}>Grid</button>
				</div>
			</div>

			{#if view === 'rows'}
				<div class="series-rows">
					{#each collection as asin (asin)}
						{@const books = seriesBooks.get(asin) ?? []}
						{@const next = nextBook(asin)}
						{@const rc = readCount(asin)}
						<section class="series-row">
							<div class="row-head">
								<div class="row-title-group">
									<h2 class="row-title">{nameOf(asin)}</h2>
									<span class="row-meta">
										{rc.read}/{rc.released} read
										{#if next}
											<span class="next-chip">Next{next.seriesPosition ? ` #${next.seriesPosition}` : ''}: {shortDate(next.releaseDate)} &middot; {daysUntil(next.releaseDate)}d</span>
										{/if}
									</span>
								</div>
								<button class="row-remove" title="Remove from collection" onclick={() => prefs.toggleWatchedSeries(asin)}>&times;</button>
							</div>
							{#if books.length === 0}
								<p class="row-loading">Loading&hellip;</p>
							{:else}
								<div class="books-strip">
									{#each books as book (book.asin)}
										{@const released = book.releaseDate <= today}
										{@const read = prefs.isRead(book.asin)}
										<button
											class="strip-book"
											class:read
											class:upcoming={!released}
											title="{book.title}{released ? (read ? ' — read (click to unmark)' : ' — click to mark read') : ` — ${shortDate(book.releaseDate)}`}"
											disabled={!released}
											onclick={() => prefs.toggleRead(book.asin)}
										>
											{#if book.coverUrl}
												<img src={book.coverUrl} alt={book.title} loading="lazy" draggable="false" />
											{:else}
												<span class="strip-fallback">#{book.seriesPosition ?? '?'}</span>
											{/if}
											{#if read}
												<span class="read-badge">✓</span>
											{:else if !released}
												<span class="days-badge">{daysUntil(book.releaseDate)}d</span>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
						</section>
					{/each}
				</div>
			{:else}
				<div class="series-grid">
					{#each collection as asin (asin)}
						{@const next = nextBook(asin)}
						{@const rc = readCount(asin)}
						<div class="grid-card">
							{#if coverOf(asin)}
								<img class="grid-cover" src={coverOf(asin)} alt={nameOf(asin)} loading="lazy" />
							{:else}
								<div class="grid-cover grid-cover-fallback">{nameOf(asin)}</div>
							{/if}
							<div class="grid-info">
								<span class="grid-name">{nameOf(asin)}</span>
								<span class="grid-meta">
									{rc.read}/{rc.released} read
									{#if next}
										&middot; next {daysUntil(next.releaseDate)}d
									{/if}
								</span>
							</div>
							<button class="row-remove grid-remove" title="Remove from collection" onclick={() => prefs.toggleWatchedSeries(asin)}>&times;</button>
						</div>
					{/each}
				</div>
			{/if}
		{:else}
			<div class="tiers">
				{#each TIER_IDS as row (row)}
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
							{#each prefs.tierList[row] as asin (asin)}
								{@render entryTile(asin, row)}
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
					<span class="shelf-title">Unranked</span>
					<span class="shelf-hint">collection series you haven&rsquo;t placed &mdash; drag into a tier, or tap to place</span>
				</div>
				<div class="tier-entries shelf-entries">
					{#each shelf as asin (asin)}
						{@render entryTile(asin, null)}
					{:else}
						<span class="shelf-empty">Everything&rsquo;s ranked.</span>
					{/each}
				</div>
			</div>
		{/if}
	</main>

	{#if activeTab === 'tiers' && selected}
		<div class="placer">
			<div class="placer-inner">
				<span class="placer-title">{nameOf(selected)}</span>
				<div class="placer-controls">
					<div class="placer-tiers">
						{#each [...TIER_IDS, 'shelf'] as (TierId | 'shelf')[] as row (row)}
							{@const current = (prefs.tierOf(selected) ?? 'shelf') === row}
							<button
								class="placer-tier"
								class:current
								style="--tier-color: {TIER_COLORS[row]}"
								onclick={() => moveSelected(row)}
							>{row === 'shelf' ? '—' : row}</button>
						{/each}
					</div>
					<div class="placer-actions">
						<button class="placer-btn" title="Move left" disabled={!prefs.tierOf(selected)} onclick={() => selected && prefs.nudgeInTier(selected, -1)}>&larr;</button>
						<button class="placer-btn" title="Move right" disabled={!prefs.tierOf(selected)} onclick={() => selected && prefs.nudgeInTier(selected, 1)}>&rarr;</button>
						<button class="placer-btn" onclick={() => (selected = null)}>Done</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

{#snippet entryTile(asin: string, row: TierId | null)}
	<button
		class="entry"
		class:selected={selected === asin}
		class:dragging={dragAsin === asin}
		draggable="true"
		title={nameOf(asin)}
		ondragstart={(e) => handleDragStart(e, asin)}
		ondragend={() => { dragAsin = null; dragOverRow = null; }}
		ondragover={(e) => { e.preventDefault(); dragOverRow = row ?? 'shelf'; }}
		ondrop={(e) => (row ? handleEntryDrop(e, row, asin) : handleRowDrop(e, 'shelf'))}
		onclick={() => (selected = selected === asin ? null : asin)}
	>
		{#if coverOf(asin)}
			<img src={coverOf(asin)} alt={nameOf(asin)} loading="lazy" draggable="false" />
		{:else}
			<span class="entry-fallback">{nameOf(asin)}</span>
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
		white-space: nowrap;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 2px;
	}

	.tab {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.3rem 0.7rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.1s, color 0.1s;
	}

	.tab.active {
		background: var(--surface);
		color: var(--text-primary);
	}

	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem 2rem 7rem;
		width: 100%;
		flex: 1;
	}

	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}

	.count {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.sort-toggle {
		display: flex;
		gap: 0.5rem;
	}

	.sort-btn {
		padding: 0;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 500;
		background: transparent;
		color: var(--text-muted);
		border: none;
		cursor: pointer;
		transition: color 0.15s;
	}

	.sort-btn:hover {
		color: var(--text-secondary);
	}

	.sort-btn.active {
		color: var(--text-primary);
		font-weight: 700;
	}

	/* ---- Collection rows ---- */
	.series-rows {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.series-row {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 0.9rem 1rem;
	}

	.row-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.row-title-group {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.row-title {
		font-family: var(--font-serif);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
	}

	.row-meta {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		color: var(--text-muted);
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	.next-chip {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
		padding: 2px 8px;
		border-radius: 4px;
		font-weight: 600;
		white-space: nowrap;
	}

	.row-remove {
		background: none;
		border: none;
		color: var(--text-muted);
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
		padding: 0.1rem 0.3rem;
		flex-shrink: 0;
	}

	.row-remove:hover {
		color: var(--red-bright);
	}

	.row-loading {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-muted);
		margin: 0;
	}

	.books-strip {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 4px;
	}

	.strip-book {
		position: relative;
		width: 76px;
		height: 76px;
		flex-shrink: 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
		background: var(--surface);
		cursor: pointer;
	}

	.strip-book img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.strip-book.read img {
		opacity: 0.45;
	}

	.strip-book.upcoming {
		cursor: default;
	}

	.strip-book.upcoming img {
		opacity: 0.6;
		filter: grayscale(0.4);
	}

	.strip-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-muted);
	}

	.read-badge {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--green-bright);
		color: var(--bg);
		font-size: 0.7rem;
		font-weight: 800;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.days-badge {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: color-mix(in srgb, var(--bg) 80%, transparent);
		color: var(--text-secondary);
		font-family: var(--font-mono);
		font-size: 0.55rem;
		font-weight: 700;
		text-align: center;
		padding: 1px 0;
	}

	/* ---- Collection grid ---- */
	.series-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 1rem;
	}

	.grid-card {
		position: relative;
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow: hidden;
	}

	.grid-cover {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		display: block;
	}

	.grid-cover-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		font-family: var(--font-serif);
		font-size: 0.75rem;
		color: var(--text-secondary);
		text-align: center;
		background: var(--surface);
	}

	.grid-info {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.6rem 0.7rem;
	}

	.grid-name {
		font-family: var(--font-serif);
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary);
		line-height: 1.25;
	}

	.grid-meta {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--text-muted);
	}

	.grid-remove {
		position: absolute;
		top: 4px;
		right: 4px;
		background: color-mix(in srgb, var(--bg) 70%, transparent);
		border-radius: 6px;
	}

	/* ---- Tier list ---- */
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
		flex-wrap: wrap;
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

	.empty {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--text-muted);
	}

	.empty-sub {
		font-size: 0.85rem;
		margin-top: 0.5rem;
		opacity: 0.85;
		max-width: 440px;
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

	@media (max-width: 600px) {
		.header-inner {
			padding: 0.75rem;
			flex-wrap: wrap;
			gap: 0.5rem;
		}

		.title {
			font-size: 1rem;
		}

		main {
			padding: 1rem 0.75rem 8rem;
		}

		.toolbar {
			flex-wrap: wrap;
			gap: 0.5rem;
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

		.strip-book {
			width: 64px;
			height: 64px;
		}
	}
</style>
