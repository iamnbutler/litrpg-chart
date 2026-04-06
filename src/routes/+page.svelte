<script lang="ts">
	import { onMount } from 'svelte';
	import type { Book, Quarter, Subgenre, SortMode } from '$lib/types';
	import { fetchAllBooks } from '$lib/api';
	import BookCard from '$lib/components/BookCard.svelte';
	import SeasonNav from '$lib/components/SeasonNav.svelte';
	import GenreFilter from '$lib/components/GenreFilter.svelte';
	import FilterPopover from '$lib/components/FilterPopover.svelte';

	function getCurrentQuarter(): Quarter {
		const month = new Date().getMonth();
		if (month < 3) return 'Q1';
		if (month < 6) return 'Q2';
		if (month < 9) return 'Q3';
		return 'Q4';
	}

	let activeQuarter: Quarter = $state(getCurrentQuarter());
	let activeYear: number = $state(new Date().getFullYear());
	let activeGenres: Set<Subgenre> = $state(new Set(['litrpg', 'cultivation']));
	let sortMode: SortMode = $state('relevance');
	let seriesOnly: boolean = $state(false);
	let longRunningOnly: boolean = $state(false);

	let booksByYear: Record<number, Book[]> = $state({});
	let loadingYear: number | null = $state(null);

	async function fetchYear(year: number) {
		if (booksByYear[year]) return;
		loadingYear = year;
		try {
			const books = await fetchAllBooks(year);
			booksByYear[year] = books;
		} catch (err) {
			console.error(`Failed to fetch ${year}:`, err);
			booksByYear[year] = [];
		} finally {
			loadingYear = null;
		}
	}

	onMount(() => {
		fetchYear(activeYear);
	});

	function handleSeasonChange(q: Quarter, year: number) {
		activeQuarter = q;
		if (year !== activeYear) {
			activeYear = year;
			fetchYear(year);
		}
	}

	function handleGenreToggle(g: Subgenre) {
		const next = new Set(activeGenres);
		if (next.has(g)) {
			next.delete(g);
		} else {
			next.add(g);
		}
		activeGenres = next;
	}

	const quarterMonthIndices: Record<Quarter, number[]> = {
		Q1: [0, 1, 2],
		Q2: [3, 4, 5],
		Q3: [6, 7, 8],
		Q4: [9, 10, 11]
	};

	const currentBooks = $derived(booksByYear[activeYear] ?? []);
	const isLoading = $derived(loadingYear === activeYear);

	const filteredBooks = $derived.by(() => {
		const monthIndices = quarterMonthIndices[activeQuarter];
		return currentBooks
			.filter((b: Book) => {
				const d = new Date(b.releaseDate);
				const year = d.getFullYear();
				const month = d.getMonth();
				if (year !== activeYear) return false;
				if (!monthIndices.includes(month)) return false;
				if (activeGenres.size > 0) {
					if (!b.subgenres.some((g: Subgenre) => activeGenres.has(g))) return false;
				}
				if (seriesOnly && !b.series) return false;
				if (longRunningOnly && (b.seriesNumber == null || b.seriesNumber < 8)) return false;
				return true;
			})
			.sort((a: Book, b: Book) =>
				sortMode === 'relevance'
					? b.relevanceScore - a.relevanceScore
					: new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime()
			);
	});

	const monthNames = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'
	];

	const groupedByMonth = $derived.by(() => {
		const groups: { month: string; books: Book[] }[] = [];
		const monthIndices = quarterMonthIndices[activeQuarter];

		for (const mi of monthIndices) {
			const monthBooks = filteredBooks.filter((b: Book) => new Date(b.releaseDate).getMonth() === mi);
			if (monthBooks.length > 0) {
				groups.push({ month: monthNames[mi], books: monthBooks });
			}
		}
		return groups;
	});

	const totalCount = $derived(filteredBooks.length);

	/** Count books per genre (within current quarter, ignoring genre filter) */
	const genreCounts = $derived.by(() => {
		const monthIndices = quarterMonthIndices[activeQuarter];
		const inQuarter = currentBooks.filter((b: Book) => {
			const d = new Date(b.releaseDate);
			return d.getFullYear() === activeYear && monthIndices.includes(d.getMonth());
		});
		const counts: Record<string, number> = {};
		for (const b of inQuarter) {
			for (const g of b.subgenres) {
				counts[g] = (counts[g] ?? 0) + 1;
			}
		}
		return counts;
	});
</script>

<div class="app">
	<header>
		<div class="header-inner">
			<h1 class="title">LitRPG Chart</h1>
			<SeasonNav
				{activeQuarter}
				{activeYear}
				onSeasonChange={handleSeasonChange}
			/>
		</div>
	</header>

	<main>
		<div class="toolbar">
			<GenreFilter
				{activeGenres}
				counts={genreCounts}
				onGenreToggle={handleGenreToggle}
			/>
			<div class="toolbar-right">
				<span class="count">
					{#if isLoading}
						loading...
					{:else}
						{totalCount} title{totalCount !== 1 ? 's' : ''}
					{/if}
				</span>
				<FilterPopover
					{seriesOnly}
					{longRunningOnly}
					onSeriesOnlyChange={(v) => seriesOnly = v}
					onLongRunningChange={(v) => longRunningOnly = v}
				/>
				<div class="sort-toggle">
					<button
						class="sort-btn"
						class:active={sortMode === 'relevance'}
						onclick={() => sortMode = 'relevance'}
					>Relevance</button>
					<button
						class="sort-btn"
						class:active={sortMode === 'date'}
						onclick={() => sortMode = 'date'}
					>Release Date</button>
				</div>
			</div>
		</div>

		{#if isLoading}
			<div class="empty">
				<p>Loading {activeYear} audiobooks...</p>
			</div>
		{:else if groupedByMonth.length === 0}
			<div class="empty">
				<p>No audiobooks found for this season.</p>
				<p class="empty-sub">Try a different season or clear your filters.</p>
			</div>
		{:else if sortMode === 'relevance'}
			<div class="book-grid">
				{#each filteredBooks as book (book.id)}
					<BookCard {book} />
				{/each}
			</div>
		{:else}
			{#each groupedByMonth as group}
				<section class="month-section">
					<h2 class="month-heading">{group.month}</h2>
					<div class="book-grid">
						{#each group.books as book (book.id)}
							<BookCard {book} />
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
		grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
		gap: 1.5rem;
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

	@media (max-width: 600px) {
		.header-inner {
			padding: 0.75rem 1rem;
		}

		main {
			padding: 1rem;
		}

		.toolbar {
			flex-direction: column;
			align-items: flex-start;
		}

		.book-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
