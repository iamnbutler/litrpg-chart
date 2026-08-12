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

/** Ranked rows of the tier list, top to bottom. 'shelf' holds unplaced adds. */
export const TIER_IDS = ['S', 'A', 'B', 'F', 'DNF'] as const;
export type TierId = (typeof TIER_IDS)[number];
export type TierRowId = TierId | 'shelf';
export const TIER_ROW_IDS: TierRowId[] = [...TIER_IDS, 'shelf'];

/**
 * A tier-list entry is a denormalized snapshot: identity is the stable
 * ASIN, but title/cover are copied in so the list renders without
 * cross-year data fetches.
 */
export interface TierEntry {
	kind: 'book' | 'series';
	id: string; // book ASIN or series ASIN
	title: string;
	coverUrl: string | null;
}

export type TierList = Record<TierRowId, TierEntry[]>;

export function tierKey(e: Pick<TierEntry, 'kind' | 'id'>): string {
	return `${e.kind}:${e.id}`;
}

function emptyTierList(): TierList {
	return { S: [], A: [], B: [], F: [], DNF: [], shelf: [] };
}

interface PrefsV1 {
	v: 1;
	watchedSeries: string[];
	hiddenSeries: string[];
	hiddenAuthors: string[];
	hiddenBooks: string[];
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
		// Stored tier lists from before a row existed lack that key.
		merged.tierList = { ...emptyTierList(), ...(parsed.tierList ?? {}) };
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

	// ---- Tier list ----

	get tierList(): TierList {
		return this.#data.tierList;
	}

	get tierCount(): number {
		return TIER_ROW_IDS.reduce((n, row) => n + this.#data.tierList[row].length, 0);
	}

	/** Which row an entry lives in, or null if it isn't on the tier list. */
	tierRowOf(kind: TierEntry['kind'], id: string): TierRowId | null {
		const key = tierKey({ kind, id });
		for (const row of TIER_ROW_IDS) {
			if (this.#data.tierList[row].some((e) => tierKey(e) === key)) return row;
		}
		return null;
	}

	/** Add to the shelf (no-op if already anywhere on the list). */
	addTierEntry(entry: TierEntry): void {
		if (this.tierRowOf(entry.kind, entry.id)) return;
		this.#data.tierList.shelf = [...this.#data.tierList.shelf, entry];
		this.#persist();
	}

	removeTierEntry(kind: TierEntry['kind'], id: string): void {
		const key = tierKey({ kind, id });
		for (const row of TIER_ROW_IDS) {
			this.#data.tierList[row] = this.#data.tierList[row].filter((e) => tierKey(e) !== key);
		}
		this.#persist();
	}

	/**
	 * Move an entry to `row`, inserting at `index` (end of row if omitted).
	 * The index is relative to the target row *after* the entry is pulled out.
	 */
	placeTierEntry(kind: TierEntry['kind'], id: string, row: TierRowId, index?: number): void {
		const key = tierKey({ kind, id });
		let entry: TierEntry | undefined;
		for (const r of TIER_ROW_IDS) {
			entry = entry ?? this.#data.tierList[r].find((e) => tierKey(e) === key);
			this.#data.tierList[r] = this.#data.tierList[r].filter((e) => tierKey(e) !== key);
		}
		if (!entry) return;
		const target = [...this.#data.tierList[row]];
		const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length));
		target.splice(at, 0, entry);
		this.#data.tierList[row] = target;
		this.#persist();
	}

	/** Shift an entry one slot left/right within its current row. */
	nudgeTierEntry(kind: TierEntry['kind'], id: string, delta: -1 | 1): void {
		const row = this.tierRowOf(kind, id);
		if (!row) return;
		const key = tierKey({ kind, id });
		const list = [...this.#data.tierList[row]];
		const from = list.findIndex((e) => tierKey(e) === key);
		const to = from + delta;
		if (from < 0 || to < 0 || to >= list.length) return;
		const [entry] = list.splice(from, 1);
		list.splice(to, 0, entry);
		this.#data.tierList[row] = list;
		this.#persist();
	}
}

function toggleIn(list: string[], value: string): string[] {
	return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export const prefs = new Prefs();
