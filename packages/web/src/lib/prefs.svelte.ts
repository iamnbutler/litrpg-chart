/**
 * User preferences, persisted to localStorage with a versioned schema.
 *
 * Series and author identity uses the stable IDs from the export contract
 * (series ASIN, author slug), so entries survive re-exports and renames.
 * watched/hidden sets are the substrate for the upcoming watch/hide UI;
 * hidden entries are already honored by the year view's filtering.
 */
import { browser } from '$app/environment';
import type { Subgenre } from '@litrpg/contract';
import type { SortMode } from './types';

const STORAGE_KEY = 'litrpg-chart:prefs';

/** Ranked rows of the tier list, top to bottom. */
export const TIER_IDS = ['S', 'A', 'B', 'F', 'DNF'] as const;
export type TierId = (typeof TIER_IDS)[number];

/**
 * Tier rows hold series ASINs only. The unranked "shelf" is derived:
 * series in the collection (watchedSeries) that appear in no tier.
 * Names/covers come from the exported series index at render time.
 */
export type TierList = Record<TierId, string[]>;

function emptyTierList(): TierList {
	return { S: [], A: [], B: [], F: [], DNF: [] };
}

function normalizeTierList(raw: unknown): TierList {
	const out = emptyTierList();
	if (!raw || typeof raw !== 'object') return out;
	for (const tier of TIER_IDS) {
		const row = (raw as Record<string, unknown>)[tier];
		if (!Array.isArray(row)) continue;
		out[tier] = row
			.map((x) =>
				typeof x === 'string'
					? x
					: // Pre-release dev shape stored {kind, id} entry objects.
						x && typeof x === 'object' && (x as { kind?: string }).kind === 'series'
						? ((x as { id?: string }).id ?? null)
						: null
			)
			.filter((x): x is string => Boolean(x));
	}
	return out;
}

interface PrefsV1 {
	v: 1;
	watchedSeries: string[];
	hiddenSeries: string[];
	hiddenAuthors: string[];
	hiddenBooks: string[];
	readBooks: string[];
	sort: SortMode;
	genres: Subgenre[];
	seriesOnly: boolean;
	longRunningOnly: boolean;
	mySeriesOnly: boolean;
	tierList: TierList;
}

const DEFAULTS: PrefsV1 = {
	v: 1,
	watchedSeries: [],
	hiddenSeries: [],
	hiddenAuthors: [],
	hiddenBooks: [],
	readBooks: [],
	sort: 'relevance',
	genres: [],
	seriesOnly: false,
	longRunningOnly: false,
	mySeriesOnly: false,
	tierList: emptyTierList()
};

function load(): PrefsV1 {
	if (!browser) return { ...DEFAULTS, tierList: emptyTierList() };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS, tierList: emptyTierList() };
		const parsed = JSON.parse(raw) as Partial<PrefsV1>;
		// Future schema versions migrate here, keyed on parsed.v.
		const merged = { ...DEFAULTS, ...parsed, v: 1 as const };
		merged.tierList = normalizeTierList(parsed.tierList);
		return merged;
	} catch {
		return { ...DEFAULTS, tierList: emptyTierList() };
	}
}

class Prefs {
	#data = $state<PrefsV1>(load());

	#persist(): void {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#data));
	}

	get sort(): SortMode {
		return this.#data.sort;
	}
	set sort(v: SortMode) {
		this.#data.sort = v;
		this.#persist();
	}

	get genres(): Set<Subgenre> {
		return new Set(this.#data.genres);
	}
	toggleGenre(g: Subgenre): void {
		const next = new Set(this.#data.genres);
		if (next.has(g)) next.delete(g);
		else next.add(g);
		this.#data.genres = [...next];
		this.#persist();
	}
	clearGenres(): void {
		this.#data.genres = [];
		this.#persist();
	}

	get seriesOnly(): boolean {
		return this.#data.seriesOnly;
	}
	set seriesOnly(v: boolean) {
		this.#data.seriesOnly = v;
		this.#persist();
	}

	get longRunningOnly(): boolean {
		return this.#data.longRunningOnly;
	}
	set longRunningOnly(v: boolean) {
		this.#data.longRunningOnly = v;
		this.#persist();
	}

	get mySeriesOnly(): boolean {
		return this.#data.mySeriesOnly;
	}
	set mySeriesOnly(v: boolean) {
		this.#data.mySeriesOnly = v;
		this.#persist();
	}

	get watchedSeries(): Set<string> {
		return new Set(this.#data.watchedSeries);
	}
	isWatched(seriesAsin: string): boolean {
		return this.#data.watchedSeries.includes(seriesAsin);
	}
	toggleWatchedSeries(seriesAsin: string): void {
		this.#data.watchedSeries = toggleIn(this.#data.watchedSeries, seriesAsin);
		this.#persist();
	}

	get hiddenSeries(): Set<string> {
		return new Set(this.#data.hiddenSeries);
	}
	toggleHiddenSeries(seriesAsin: string): void {
		this.#data.hiddenSeries = toggleIn(this.#data.hiddenSeries, seriesAsin);
		this.#persist();
	}

	get hiddenAuthors(): Set<string> {
		return new Set(this.#data.hiddenAuthors);
	}
	toggleHiddenAuthor(slug: string): void {
		this.#data.hiddenAuthors = toggleIn(this.#data.hiddenAuthors, slug);
		this.#persist();
	}

	get hiddenBooks(): Set<string> {
		return new Set(this.#data.hiddenBooks);
	}
	toggleHiddenBook(asin: string): void {
		this.#data.hiddenBooks = toggleIn(this.#data.hiddenBooks, asin);
		this.#persist();
	}

	get hiddenCount(): number {
		return (
			this.#data.hiddenSeries.length +
			this.#data.hiddenBooks.length +
			this.#data.hiddenAuthors.length
		);
	}
	clearHidden(): void {
		this.#data.hiddenSeries = [];
		this.#data.hiddenBooks = [];
		this.#data.hiddenAuthors = [];
		this.#persist();
	}

	// ---- Read tracking ----

	get readBooks(): Set<string> {
		return new Set(this.#data.readBooks);
	}
	isRead(asin: string): boolean {
		return this.#data.readBooks.includes(asin);
	}
	toggleRead(asin: string): void {
		this.#data.readBooks = toggleIn(this.#data.readBooks, asin);
		this.#persist();
	}

	// ---- Tier list (series ASINs only) ----

	get tierList(): TierList {
		return this.#data.tierList;
	}

	get rankedCount(): number {
		return TIER_IDS.reduce((n, tier) => n + this.#data.tierList[tier].length, 0);
	}

	/** Which tier a series sits in, or null if unranked. */
	tierOf(seriesAsin: string): TierId | null {
		for (const tier of TIER_IDS) {
			if (this.#data.tierList[tier].includes(seriesAsin)) return tier;
		}
		return null;
	}

	/** Every ranked series, across all tiers. */
	get rankedSeries(): Set<string> {
		return new Set(TIER_IDS.flatMap((tier) => this.#data.tierList[tier]));
	}

	/**
	 * Move a series into `tier` at `index` (end if omitted). The index is
	 * relative to the row *after* the series is pulled from wherever it was.
	 */
	placeInTier(seriesAsin: string, tier: TierId, index?: number): void {
		for (const t of TIER_IDS) {
			this.#data.tierList[t] = this.#data.tierList[t].filter((a) => a !== seriesAsin);
		}
		const row = [...this.#data.tierList[tier]];
		const at = index === undefined ? row.length : Math.max(0, Math.min(index, row.length));
		row.splice(at, 0, seriesAsin);
		this.#data.tierList[tier] = row;
		this.#persist();
	}

	/** Pull a series out of all tiers (back to the derived shelf). */
	unrank(seriesAsin: string): void {
		for (const t of TIER_IDS) {
			this.#data.tierList[t] = this.#data.tierList[t].filter((a) => a !== seriesAsin);
		}
		this.#persist();
	}

	/** Shift a series one slot left/right within its tier. */
	nudgeInTier(seriesAsin: string, delta: -1 | 1): void {
		const tier = this.tierOf(seriesAsin);
		if (!tier) return;
		const row = [...this.#data.tierList[tier]];
		const from = row.indexOf(seriesAsin);
		const to = from + delta;
		if (from < 0 || to < 0 || to >= row.length) return;
		row.splice(from, 1);
		row.splice(to, 0, seriesAsin);
		this.#data.tierList[tier] = row;
		this.#persist();
	}
}

function toggleIn(list: string[], value: string): string[] {
	return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export const prefs = new Prefs();
