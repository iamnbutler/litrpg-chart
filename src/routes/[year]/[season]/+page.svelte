<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { base } from '$app/paths';
	import type { Book, Quarter, Season, Subgenre, SortMode, ActiveFilter } from '$lib/types';
	import {
		seasonToQuarter,
		quarterToSeason,
		seasonLabels,
		seasonOrder
	} from '$lib/types';
	import { fetchAllBooks, fetchMeta } from '$lib/api';
	import BookCard from '$lib/components/BookCard.svelte';
	import GenreFilter from '$lib/components/GenreFilter.svelte';
	import FilterPopover from '$lib/components/FilterPopover.svelte';
	import BrowseModal from '$lib/components/BrowseModal.svelte';
	import TimelineRuler from '$lib/components/TimelineRuler.svelte';
	import FloatingPill from '$lib/components/FloatingPill.svelte';

	let { data } = $props();
	let initialYear = data.year;
	let initialSeason = data.season as Season;

	// --- State ---
	let booksByYear: Record<number, Book[]> = $state({});
	let availableYears: number[] = $state([]);
	let loaded = $state(false);
	let hasScrolledToInitial = false;
	let isScrollingTo = false;

	let currentYear: number = $state(initialYear);
	let currentSeason: Season = $state(initialSeason);

	let activeGenres: Set<Subgenre> = $state(new Set());
	let sortMode: SortMode = $state('relevance');
	let seriesOnly: boolean = $state(false);
	let longRunningOnly: boolean = $state(false);
	let activeFilter: ActiveFilter | null = $state(null);

	let stickyTopEl: HTMLElement;
	let stickyTopHeight = $state(80);

	// --- Quarter/month mapping ---
	const quarterMonthIndices: Record<Quarter, number[]> = {
		Q1: [0, 1, 2],
		Q2: [3, 4, 5],
		Q3: [6, 7, 8],
		Q4: [9, 10, 11]
	};

	const monthNames = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'
	];

	// --- Data loading ---
	async function fetchYear(year: number) {
		if (booksByYear[year]) return;
		try {
			const books = await fetchAllBooks(year);
			booksByYear[year] = books;
		} catch (err) {
			console.error(`Failed to fetch ${year}:`, err);
			booksByYear[year] = [];
		}
	}

	// --- Derived: all seasons with unfiltered data ---
	function yearHasSeasonData(year: number, quarter: Quarter): boolean {
		const books = booksByYear[year] ?? [];
		const monthIndices = quarterMonthIndices[quarter];
		return books.some((b) => {
			const d = new Date(b.releaseDate);
			return d.getFullYear() === year && monthIndices.includes(d.getMonth());
		});
	}

	function seasonHasData(year: number, season: Season): boolean {
		return yearHasSeasonData(year, seasonToQuarter[season]);
	}

	const allSeasons = $derived.by(() => {
		const result: { year: number; season: Season; quarter: Quarter }[] = [];
		for (const year of [...availableYears].reverse()) {
			for (const q of ['Q4', 'Q3', 'Q2', 'Q1'] as Quarter[]) {
				if (yearHasSeasonData(year, q)) {
					result.push({ year, season: quarterToSeason[q], quarter: q });
				}
			}
		}
		return result;
	});

	// --- Filtering & sorting ---
	function getBooksForSeason(year: number, quarter: Quarter): Book[] {
		const books = booksByYear[year] ?? [];
		const monthIndices = quarterMonthIndices[quarter];
		return books
			.filter((b: Book) => {
				const d = new Date(b.releaseDate);
				if (d.getFullYear() !== year) return false;
				if (!monthIndices.includes(d.getMonth())) return false;
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
	}

	function getMonthGroups(year: number, quarter: Quarter): { month: string; books: Book[] }[] {
		const books = getBooksForSeason(year, quarter);
		const monthIndices = quarterMonthIndices[quarter];
		const groups: { month: string; books: Book[] }[] = [];
		for (const mi of monthIndices) {
			const monthBooks = books.filter((b: Book) => new Date(b.releaseDate).getMonth() === mi);
			if (monthBooks.length > 0) {
				groups.push({ month: monthNames[mi], books: monthBooks });
			}
		}
		return groups;
	}

	// --- Genre counts (global across all loaded data) ---
	const genreCounts = $derived.by(() => {
		const allBooks = Object.values(booksByYear).flat();
		const counts: Record<string, number> = {};
		for (const b of allBooks) {
			if (seriesOnly && !b.series) continue;
			if (longRunningOnly && (b.seriesNumber == null || b.seriesNumber < 8)) continue;
			for (const g of b.subgenres) {
				counts[g] = (counts[g] ?? 0) + 1;
			}
		}
		return counts;
	});

	const totalFilteredCount = $derived.by(() => {
		let total = 0;
		for (const year of availableYears) {
			for (const q of ['Q1', 'Q2', 'Q3', 'Q4'] as Quarter[]) {
				total += getBooksForSeason(year, q).length;
			}
		}
		return total;
	});

	// --- Browse modal ---
	const allLoadedBooks = $derived(Object.values(booksByYear).flat());

	const modalBooks = $derived.by(() => {
		if (!activeFilter) return [];
		return allLoadedBooks
			.filter((b: Book) => {
				if (activeFilter!.type === 'author') {
					const name = activeFilter!.value.toLowerCase();
					const authors = b.author?.toLowerCase().split(',').map((s) => s.trim()) ?? [];
					return authors.some((a) => a === name);
				}
				if (activeFilter!.type === 'narrator') {
					const name = activeFilter!.value.toLowerCase();
					const narrators =
						b.narrator?.toLowerCase().split(',').map((s) => s.trim()) ?? [];
					return narrators.some((n) => n === name);
				}
				if (activeFilter!.type === 'series') {
					return b.series === activeFilter!.value;
				}
				return true;
			})
			.sort((a: Book, b: Book) => {
				if (
					activeFilter!.type === 'series' &&
					a.seriesNumber != null &&
					b.seriesNumber != null
				) {
					return a.seriesNumber - b.seriesNumber;
				}
				return b.relevanceScore - a.relevanceScore;
			});
	});

	// --- Event handlers ---
	function handleGenreToggle(g: Subgenre) {
		const next = new Set(activeGenres);
		if (next.has(g)) next.delete(g);
		else next.add(g);
		activeGenres = next;
	}

	function handleAllToggle() {
		activeGenres = new Set();
	}

	function handleAuthorClick(name: string) {
		activeFilter = { type: 'author', value: name };
	}

	function handleNarratorClick(name: string) {
		activeFilter = { type: 'narrator', value: name };
	}

	function handleSeriesClick(series: string) {
		activeFilter = { type: 'series', value: series };
	}

	function clearFilter() {
		activeFilter = null;
	}

	// --- Navigation ---
	function scrollToSection(year: number, season: Season) {
		isScrollingTo = true;
		currentYear = year;
		currentSeason = season;
		history.replaceState(null, '', `${base}/${year}/${season}`);

		const el = document.getElementById(`section-${year}-${season}`);
		if (el) {
			const top = el.getBoundingClientRect().top + window.scrollY - stickyTopHeight - 8;
			window.scrollTo({ top, behavior: 'smooth' });
		}

		setTimeout(() => {
			isScrollingTo = false;
		}, 800);
	}

	// --- Scroll tracking ---
	function onScroll() {
		if (isScrollingTo) return;

		const sections = document.querySelectorAll<HTMLElement>('[data-section]');
		let best: HTMLElement | null = null;
		const threshold = stickyTopHeight + 20;

		for (const section of sections) {
			const rect = section.getBoundingClientRect();
			if (rect.top <= threshold && rect.bottom > threshold) {
				best = section;
			}
		}

		if (best) {
			const year = parseInt(best.dataset.year!, 10);
			const season = best.dataset.season as Season;
			if (currentYear !== year || currentSeason !== season) {
				currentYear = year;
				currentSeason = season;
				history.replaceState(null, '', `${base}/${year}/${season}`);
			}
		}
	}

	// --- Lifecycle ---
	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		// Measure sticky header
		if (stickyTopEl) {
			resizeObserver = new ResizeObserver(([entry]) => {
				stickyTopHeight = entry.contentRect.height + entry.contentRect.top;
				document.documentElement.style.setProperty('--sticky-top-h', `${stickyTopHeight}px`);
			});
			resizeObserver.observe(stickyTopEl);
		}

		// Scroll listener
		window.addEventListener('scroll', onScroll, { passive: true });

		// Load data
		loadData();
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('scroll', onScroll);
		}
		resizeObserver?.disconnect();
	});

	async function loadData() {
		const meta = await fetchMeta();
		if (meta) {
			availableYears = Object.keys(meta.years)
				.map(Number)
				.filter((y) => meta.years[String(y)].exportedBooks > 0)
				.sort((a, b) => a - b);
		}

		await Promise.all(availableYears.map((y) => fetchYear(y)));
		loaded = true;

		// Scroll to initial section after DOM renders
		await tick();
		requestAnimationFrame(() => {
			const el = document.getElementById(`section-${initialYear}-${initialSeason}`);
			if (el) {
				isScrollingTo = true;
				const top = el.getBoundingClientRect().top + window.scrollY - stickyTopHeight - 8;
				window.scrollTo({ top, behavior: 'instant' });
				hasScrolledToInitial = true;
				setTimeout(() => {
					isScrollingTo = false;
				}, 100);
			}
		});
	}
</script>

<div class="app">
	<div class="sticky-top" bind:this={stickyTopEl}>
		<header>
			<div class="header-inner">
				<h1 class="title">LitRPG Chart</h1>
				<div class="header-nav">
					<FloatingPill
						{currentYear}
						{currentSeason}
						{availableYears}
						onJump={scrollToSection}
					/>
				</div>
			</div>
		</header>

		<div class="toolbar">
			<GenreFilter
				{activeGenres}
				counts={genreCounts}
				onGenreToggle={handleGenreToggle}
				onAllToggle={handleAllToggle}
			/>
			<div class="toolbar-right">
				<span class="count">
					{#if !loaded}
						loading...
					{:else}
						{totalFilteredCount} title{totalFilteredCount !== 1 ? 's' : ''}
					{/if}
				</span>
				<FilterPopover
					{seriesOnly}
					{longRunningOnly}
					onSeriesOnlyChange={(v) => (seriesOnly = v)}
					onLongRunningChange={(v) => (longRunningOnly = v)}
				/>
				<div class="sort-toggle">
					<button
						class="sort-btn"
						class:active={sortMode === 'relevance'}
						onclick={() => (sortMode = 'relevance')}>Relevance</button
					>
					<button
						class="sort-btn"
						class:active={sortMode === 'date'}
						onclick={() => (sortMode = 'date')}>Release Date</button
					>
				</div>
			</div>
		</div>
	</div>

	<main>
		{#if !loaded}
			<div class="empty">
				<p>Loading audiobooks...</p>
			</div>
		{:else if allSeasons.length === 0}
			<div class="empty">
				<p>No data available.</p>
			</div>
		{:else}
			{#each allSeasons as section (section.year + '-' + section.season)}
				{@const books = getBooksForSeason(section.year, section.quarter)}
				{@const monthGroups = sortMode === 'date' ? getMonthGroups(section.year, section.quarter) : []}
				<section
					class="season-section"
					id="section-{section.year}-{section.season}"
					data-section
					data-year={section.year}
					data-season={section.season}
				>
					<h2 class="season-header">
						{seasonLabels[section.season]} {section.year}
						{#if books.length > 0}
							<span class="season-count">{books.length}</span>
						{/if}
					</h2>

					{#if books.length === 0}
						<p class="season-empty">No matches this season.</p>
					{:else if sortMode === 'relevance'}
						<div class="book-grid">
							{#each books as book (book.id)}
								<BookCard
									{book}
									onAuthorClick={handleAuthorClick}
									onNarratorClick={handleNarratorClick}
									onSeriesClick={handleSeriesClick}
								/>
							{/each}
						</div>
					{:else}
						{#each monthGroups as group}
							<div class="month-section">
								<h3 class="month-heading">{group.month}</h3>
								<div class="book-grid">
									{#each group.books as book (book.id)}
										<BookCard
											{book}
											onAuthorClick={handleAuthorClick}
											onNarratorClick={handleNarratorClick}
											onSeriesClick={handleSeriesClick}
										/>
									{/each}
								</div>
							</div>
						{/each}
					{/if}
				</section>
			{/each}
		{/if}
	</main>

	<footer>
		<p class="feedback">
			Something look wrong? Missing a feature? <a
				href="https://github.com/iamnbutler/litrpg-chart/issues/new"
				target="_blank"
				rel="noopener noreferrer">Write an issue</a
			>
		</p>
		<p>Data from Audible. Cover images &copy; respective publishers. AI-narrated titles excluded.</p>
	</footer>

	<TimelineRuler
		{availableYears}
		{currentYear}
		{currentSeason}
		{seasonHasData}
		onJump={scrollToSection}
	/>

	{#if activeFilter}
		<BrowseModal
			filter={activeFilter}
			books={modalBooks}
			onClose={clearFilter}
			onAuthorClick={handleAuthorClick}
			onNarratorClick={handleNarratorClick}
			onSeriesClick={handleSeriesClick}
		/>
	{/if}
</div>

<style>
	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	/* --- Sticky top (header + toolbar) --- */
	.sticky-top {
		position: sticky;
		top: 0;
		z-index: 10;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}

	header {
		background: var(--bg);
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

	.header-nav {
		display: flex;
		align-items: center;
	}

	/* --- Toolbar --- */
	.toolbar {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 2rem 0.75rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
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

	/* --- Main content --- */
	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 2rem 2rem;
		padding-right: 5rem;
		width: 100%;
		flex: 1;
	}

	/* --- Season sections --- */
	.season-section {
		padding-top: 0.5rem;
		padding-bottom: 2rem;
	}

	.season-header {
		position: sticky;
		top: var(--sticky-top-h, 80px);
		z-index: 5;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.75rem 0;
		margin-bottom: 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg);
	}

	.season-count {
		font-weight: 400;
		color: var(--text-muted);
		margin-left: 0.5rem;
	}

	.season-empty {
		text-align: center;
		padding: 2rem;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	/* --- Book grid --- */
	.book-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.5rem;
	}

	.month-section {
		margin-bottom: 2rem;
	}

	.month-heading {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 0.75rem;
		padding-bottom: 0.4rem;
	}

	/* --- Empty & loading --- */
	.empty {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--text-muted);
	}

	/* --- Footer --- */
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

	/* --- Responsive --- */
	@media (max-width: 850px) {
		.book-grid {
			grid-template-columns: 1fr;
			gap: 1rem;
		}
	}

	@media (max-width: 768px) {
		main {
			padding-right: 2rem;
		}
	}

	@media (max-width: 600px) {
		.sticky-top {
			position: static;
			background: transparent;
			border-bottom: none;
		}

		.header-inner {
			padding: 0.75rem;
		}

		.header-nav {
			display: none;
		}

		.title {
			font-size: 1rem;
		}

		.toolbar {
			padding: 0 0.75rem 0.5rem;
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
		}

		main {
			padding: 0 0.75rem;
			padding-bottom: 4.5rem;
		}

		.season-header {
			position: sticky;
			top: 0;
			z-index: 5;
		}

		.book-grid {
			grid-template-columns: 1fr;
			gap: 0.75rem;
		}
	}
</style>
