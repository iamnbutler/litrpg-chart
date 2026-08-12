/**
 * UI-side types: the data shapes come from @litrpg/contract (the pipeline
 * validates every exported file against the same schemas). This module only
 * adds presentation concerns — labels, colors, filter state.
 */
import type { Subgenre } from '@litrpg/contract';

export type { ExportedBook as Book, Meta, SeriesIndex, SeriesIndexEntry, Subgenre } from '@litrpg/contract';

export type SortMode = 'relevance' | 'date';

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface ActiveFilter {
	type: 'author' | 'narrator' | 'series';
	/** series ASIN, or author/narrator slug — what goes in the URL. */
	value: string;
	/** Human-readable name for the modal header. */
	label: string;
}

export const subgenreLabels: Record<Subgenre, string> = {
	litrpg: '⚔️ LitRPG',
	cultivation: '🌿 Cultivation',
	dungeon: '💀 Dungeon Core',
	isekai: '🚚 Isekai',
	'tower-climbing': 'Tower Climbing',
	'system-apocalypse': 'System Apocalypse',
	'base-building': 'Base Building',
	'time-loop': 'Time Loop',
	academy: 'Academy',
	crafting: 'Crafting',
	'monster-mc': 'Monster MC',
	wuxia: 'Wuxia'
};

/** Primary subgenres shown in the filter bar */
export const filterSubgenres: Subgenre[] = ['litrpg', 'cultivation', 'dungeon', 'isekai'];

export const subgenreColors: Record<Subgenre, string> = {
	litrpg: 'var(--blue-bright, #83a598)',
	cultivation: 'var(--green-bright, #b8bb26)',
	dungeon: 'var(--red-bright, #fb4934)',
	isekai: 'var(--purple-bright, #d3869b)',
	'tower-climbing': 'var(--aqua-bright, #8ec07c)',
	'system-apocalypse': 'var(--orange-bright, #fe8019)',
	'base-building': 'var(--blue-dim, #458588)',
	'time-loop': 'var(--purple-dim, #b16286)',
	academy: 'var(--yellow-dim, #d79921)',
	crafting: 'var(--orange-dim, #d65d0e)',
	'monster-mc': 'var(--red-dim, #cc241d)',
	wuxia: 'var(--green-dim, #98971a)'
};

/** "12 hrs 5 mins" from runtime minutes, matching v1's Audible-style label. */
export function formatRuntime(min: number | null): string | null {
	if (min == null || min <= 0) return null;
	const h = Math.floor(min / 60);
	const m = min % 60;
	if (h === 0) return `${m} mins`;
	if (m === 0) return `${h} hrs`;
	return `${h} hrs ${m} mins`;
}
