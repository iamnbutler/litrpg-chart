<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { slugify } from '@litrpg/contract';
	import type { Book, Quarter, Subgenre, ActiveFilter } from '$lib/types';
	import { fetchSeriesBooks, fetchAuthorBooks, fetchNarratorBooks } from '$lib/data';
	import { prefs } from '$lib/prefs.svelte';
	import BookCard from '$lib/components/BookCard.svelte';
	import SeasonNav from '$lib/components/SeasonNav.svelte';
	import GenreFilter from '$lib/components/GenreFilter.svelte';
	import FilterPopover from '$lib/components/FilterPopover.svelte';
	import BrowseModal from '$lib/components/BrowseModal.svelte';
	import BookActionSheet from '$lib/components/BookActionSheet.svelte';

	let { data } = $props();

	// Left-clicking a card opens the action sheet (open link / tier list / hide).
	let sheetBook: Book | null = $state(null);
	const handleCardClick = (book: Book) => (sheetBook = book);

	function currentQuarter(): Quarter {
		const month = new Date().getMonth();
		if (month < 3) return 'Q1';
		if (month < 6) return 'Q2';
		if (month < 9) return 'Q3';
		return 'Q4';
	}

	const QUARTERS: Quarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];

	const activeYear = $derived(data.year);
	const activeQuarter = $derived.by((): Quarter => {
		const q = page.url.searchParams.get('q');
		if (q && (QUARTERS as string[]).includes(q)) return q as Quarter;
		return data.year === new Date().getFullYear() ? currentQuarter() : 'Q1';
	});

	function urlWith(mutate: (p: URLSearchParams) => void, path = `${base}/${activeYear}`): string {
		const params = new URLSearchParams(page.url.searchParams);
		mutate(params);
		const qs = params.toString();
		return qs ? `${path}?${qs}` : path;
	}

	function handleSeasonChange(q: Quarter, year: number) {
		const path = `${base}/${year}`;
		goto(urlWith((p) => p.set('q', q), path), { noScroll: false, keepFocus: true });
	}

	// ---- Genre / sort / popover filters (persisted via prefs) ----
	const activeGenres = $derived(prefs.genres);
	const sortMode = $derived(prefs.sort);
	const seriesOnly = $derived(prefs.seriesOnly);
	const longRunningOnly = $derived(prefs.longRunningOnly);

	const quarterMonthIndices: Record<Quarter, number[]> = {
		Q1: [0, 1, 2],
		Q2: [3, 4, 5],
		Q3: [6, 7, 8],
		Q4: [9, 10, 11]
	};

	function monthOf(b: Book): number {
		return Number(b.releaseDate.slice(5, 7)) - 1;
	}

	const filteredBooks = $derived.by(() => {
		const monthIndices = quarterMonthIndices[activeQuarter];
		const hiddenSeries = prefs.hiddenSeries;
		const hiddenAuthors = prefs.hiddenAuthors;
		const hiddenBooks = prefs.hiddenBooks;
		const watched = prefs.watchedSeries;
		const mySeriesOnly = prefs.mySeriesOnly;
		return data.books
			.filter((b) => {
				if (!monthIndices.includes(monthOf(b))) return false;
				if (activeGenres.size > 0 && !b.subgenres.some((g) => activeGenres.has(g))) return false;
				if (mySeriesOnly && (!b.seriesAsin || !watched.has(b.seriesAsin))) return false;
				if (seriesOnly && !b.seriesAsin) return false;
				if (longRunningOnly) {
					const pos = Number.parseFloat(b.seriesPosition ?? '');
					if (Number.isNaN(pos) || pos < 8) return false;
				}
				if (b.seriesAsin && hiddenSeries.has(b.seriesAsin)) return false;
				if (hiddenBooks.has(b.asin)) return false;
				if (b.authors.some((a) => hiddenAuthors.has(slugify(a)))) return false;
				return true;
			})
			.sort((a, b) =>
				sortMode === 'relevance'
					? b.relevanceScore - a.relevanceScore
					: a.releaseDate.localeCompare(b.releaseDate)
			);
	});

	const monthNames = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'
	];

	const groupedByMonth = $derived.by(() => {
		const groups: { month: string; books: Book[] }[] = [];
		for (const mi of quarterMonthIndices[activeQuarter]) {
			const monthBooks = filteredBooks.filter((b) => monthOf(b) === mi);
			if (monthBooks.length > 0) groups.push({ month: monthNames[mi], books: monthBooks });
		}
		return groups;
	});

	const totalCount = $derived(filteredBooks.length);

	/** Count books per genre (within current quarter, ignoring genre filter) */
	const genreCounts = $derived.by(() => {
		const monthIndices = quarterMonthIndices[activeQuarter];
		const counts: Record<string, number> = {};
		for (const b of data.books) {
			if (!monthIndices.includes(monthOf(b))) continue;
			for (const g of b.subgenres) counts[g] = (counts[g] ?? 0) + 1;
		}
		return counts;
	});

	// ---- Browse modal, driven by ?series= / ?author= / ?narrator= ----
	const modalParam = $derived.by((): { type: ActiveFilter['type']; value: string } | null => {
		for (const type of ['series', 'author', 'narrator'] as const) {
			const value = page.url.searchParams.get(type);
			if (value) return { type, value };
		}
		return null;
	});

	let modalBooks: Book[] = $state([]);
	let modalFilter: ActiveFilter | null = $state(null);

	$effect(() => {
		const param = modalParam;
		if (!param) {
			modalFilter = null;
			modalBooks = [];
			return;
		}
		let cancelled = false;
		(async () => {
			const books =
				param.type === 'series'
					? await fetchSeriesBooks(param.value)
					: param.type === 'author'
						? await fetchAuthorBooks(param.value)
						: await fetchNarratorBooks(param.value);
			if (cancelled) return;
			books.sort((a, b) => {
				if (param.type === 'series') {
					const pa = Number.parseFloat(a.seriesPosition ?? '');
					const pb = Number.parseFloat(b.seriesPosition ?? '');
					if (!Number.isNaN(pa) && !Number.isNaN(pb)) return pa - pb;
				}
				return b.relevanceScore - a.relevanceScore;
			});
			modalBooks = books;
			modalFilter = { type: param.type, value: param.value, label: labelFor(param, books) };
		})();
		return () => {
			cancelled = true;
		};
	});

	function labelFor(param: { type: ActiveFilter['type']; value: string }, books: Book[]): string {
		if (param.type === 'series') return books[0]?.seriesName ?? param.value;
		const names = books.flatMap((b) => (param.type === 'author' ? b.authors : b.narrators));
		return names.find((n) => slugify(n) === param.value) ?? param.value;
	}

	function openModal(type: ActiveFilter['type'], value: string) {
		goto(
			urlWith((p) => {
				p.delete('series');
				p.delete('author');
				p.delete('narrator');
				p.set(type, value);
			}),
			{ noScroll: true, keepFocus: true }
		);
	}

	const handleAuthorClick = (name: string) => openModal('author', slugify(name));
	const handleNarratorClick = (name: string) => openModal('narrator', slugify(name));
	const handleSeriesClick = (seriesAsin: string) => openModal('series', seriesAsin);

	function clearModal() {
		goto(
			urlWith((p) => {
				p.delete('series');
				p.delete('author');
				p.delete('narrator');
			}),
			{ noScroll: true, keepFocus: true }
		);
	}
</script>

<svelte:head>
	<title>LitRPG Chart — {activeYear}</title>
</svelte:head>

<div class="app">
	<header>
		<div class="header-inner">
			<h1 class="title">LitRPG Chart</h1>
			<a class="tierlist-link" href="{base}/collection" title="My collection">Collection{prefs.watchedSeries.size > 0 ? ` (${prefs.watchedSeries.size})` : ''}</a>
			<div class="header-nav">
				<SeasonNav
					{activeQuarter}
					{activeYear}
					availableYears={data.availableYears}
					onSeasonChange={handleSeasonChange}
				/>
			</div>
		</div>
	</header>

	<main>
		<div class="toolbar">
			<GenreFilter
				{activeGenres}
				counts={genreCounts}
				onGenreToggle={(g: Subgenre) => prefs.toggleGenre(g)}
				onAllToggle={() => prefs.clearGenres()}
			/>
			<div class="toolbar-right">
				<span class="count">{totalCount} title{totalCount !== 1 ? 's' : ''}</span>
				<FilterPopover
					{seriesOnly}
					{longRunningOnly}
					mySeriesOnly={prefs.mySeriesOnly}
					watchedCount={prefs.watchedSeries.size}
					hiddenCount={prefs.hiddenCount}
					onSeriesOnlyChange={(v) => (prefs.seriesOnly = v)}
					onLongRunningChange={(v) => (prefs.longRunningOnly = v)}
					onMySeriesChange={(v) => (prefs.mySeriesOnly = v)}
					onClearHidden={() => prefs.clearHidden()}
				/>
				<div class="sort-toggle">
					<button
						class="sort-btn"
						class:active={sortMode === 'relevance'}
						onclick={() => (prefs.sort = 'relevance')}
					>Relevance</button>
					<button
						class="sort-btn"
						class:active={sortMode === 'date'}
						onclick={() => (prefs.sort = 'date')}
					>Release Date</button>
				</div>
			</div>
		</div>

		{#if filteredBooks.length === 0}
			<div class="empty">
				<p>No audiobooks found for this season.</p>
				<p class="empty-sub">Try a different season or clear your filters.</p>
			</div>
		{:else if sortMode === 'relevance'}
			<div class="book-grid">
				{#each filteredBooks as book (book.asin)}
					<BookCard {book} onAuthorClick={handleAuthorClick} onNarratorClick={handleNarratorClick} onSeriesClick={handleSeriesClick} onCardClick={handleCardClick} />
				{/each}
			</div>
		{:else}
			{#each groupedByMonth as group}
				<section class="month-section">
					<h2 class="month-heading">{group.month}</h2>
					<div class="book-grid">
						{#each group.books as book (book.asin)}
							<BookCard {book} onAuthorClick={handleAuthorClick} onNarratorClick={handleNarratorClick} onSeriesClick={handleSeriesClick} onCardClick={handleCardClick} />
						{/each}
					</div>
				</section>
			{/each}
		{/if}
	</main>

	<footer>
		<p class="feedback">Something look wrong? Missing a feature? <a href="https://github.com/iamnbutler/litrpg-chart/issues/new" target="_blank" rel="noopener noreferrer">Write an issue</a></p>
		<p>Data from Audible. Cover images &copy; respective publishers. AI-narrated titles excluded.</p>
	</footer>

	{#if modalFilter}
		<BrowseModal
			filter={modalFilter}
			books={modalBooks}
			onClose={clearModal}
			onAuthorClick={handleAuthorClick}
			onNarratorClick={handleNarratorClick}
			onSeriesClick={handleSeriesClick}
			onCardClick={handleCardClick}
		/>
	{/if}

	{#if sheetBook}
		<BookActionSheet book={sheetBook} onClose={() => (sheetBook = null)} />
	{/if}

	<div class="mobile-bottom-bar">
		<SeasonNav
			{activeQuarter}
			{activeYear}
			availableYears={data.availableYears}
			onSeasonChange={handleSeasonChange}
		/>
	</div>
</div>

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
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.title {
		font-family: var(--font-serif);
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.01em;
		white-space: nowrap;
	}

	.tierlist-link {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-muted);
		text-decoration: none;
		white-space: nowrap;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.25rem 0.6rem;
		transition: color 0.15s, border-color 0.15s;
	}

	.tierlist-link:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem 2rem;
		width: 100%;
		flex: 1;
	}

	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
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

	.count {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.month-section {
		margin-bottom: 2.5rem;
	}

	.month-heading {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border);
	}

	.book-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.5rem;
	}

	@media (max-width: 850px) {
		.book-grid {
			grid-template-columns: 1fr;
			gap: 1rem;
		}
	}

	.empty {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--text-muted);
	}

	.empty-sub {
		font-size: 0.85rem;
		margin-top: 0.5rem;
		opacity: 0.7;
	}

	footer {
		border-top: 1px solid var(--border);
		padding: 1.5rem 2rem;
		text-align: center;
	}

	footer p {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-muted);
	}

	.feedback {
		margin-bottom: 0.5rem;
	}

	.feedback a {
		color: var(--accent);
		text-decoration: none;
	}

	.feedback a:hover {
		text-decoration: underline;
	}

	.mobile-bottom-bar {
		display: none;
	}

	.header-nav {
		display: contents;
	}

	@media (max-width: 600px) {
		header {
			position: static;
			background: transparent;
			border-bottom: none;
		}

		.header-inner {
			padding: 0.75rem;
			justify-content: flex-start;
		}

		.header-nav {
			display: none;
		}

		.title {
			font-size: 1rem;
		}

		main {
			padding: 0 0.75rem;
			padding-bottom: 4.5rem;
		}

		.toolbar {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
		}

		.book-grid {
			grid-template-columns: 1fr;
			gap: 0.75rem;
		}

		.mobile-bottom-bar {
			display: flex;
			justify-content: center;
			position: fixed;
			bottom: calc(0.75rem + env(safe-area-inset-bottom));
			left: 50%;
			transform: translateX(-50%);
			z-index: 20;
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: 16px;
			padding: 0.5rem 1rem;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
			width: auto;
		}
	}
</style>
