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

interface PrefsV1 {
	v: 1;
	watchedSeries: string[];
	hiddenSeries: string[];
	hiddenAuthors: string[];
	sort: SortMode;
	genres: Subgenre[];
	seriesOnly: boolean;
	longRunningOnly: boolean;
	mySeriesOnly: boolean;
}

const DEFAULTS: PrefsV1 = {
	v: 1,
	watchedSeries: [],
	hiddenSeries: [],
	hiddenAuthors: [],
	sort: 'relevance',
	genres: [],
	seriesOnly: false,
	longRunningOnly: false,
	mySeriesOnly: false
};

function load(): PrefsV1 {
	if (!browser) return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS };
		const parsed = JSON.parse(raw) as Partial<PrefsV1>;
		// Future schema versions migrate here, keyed on parsed.v.
		return { ...DEFAULTS, ...parsed, v: 1 };
	} catch {
		return { ...DEFAULTS };
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
}

function toggleIn(list: string[], value: string): string[] {
	return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export const prefs = new Prefs();
