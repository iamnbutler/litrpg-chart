export type Subgenre =
	| 'litrpg'
	| 'cultivation'
	| 'progression'
	| 'dungeon'
	| 'isekai'
	| 'tower-climbing'
	| 'system-apocalypse'
	| 'base-building'
	| 'time-loop'
	| 'academy'
	| 'crafting'
	| 'monster-mc'
	| 'wuxia';

export interface Book {
	id: string;
	title: string;
	series: string;
	seriesNumber: number | null;
	author: string;
	narrator?: string;
	releaseDate: string; // ISO date
	coverUrl?: string;
	audiobookLength?: string;
	subgenres: Subgenre[];
	description: string;
	url?: string;
	rating?: number;
	ratingCount?: number;
	relevanceScore: number;
}

export type SortMode = 'relevance' | 'date';

export const subgenreLabels: Record<Subgenre, string> = {
	litrpg: '⚔️ LitRPG',
	cultivation: '🌿 Cultivation',
	progression: '🏃 Progression',
	dungeon: '💀 Dungeon Core',
	isekai: '🚚 Isekai',
	'tower-climbing': '🗼 Tower Climbing',
	'system-apocalypse': '🌋 System Apocalypse',
	'base-building': '🏰 Base Building',
	'time-loop': '🔄 Time Loop',
	academy: '🎓 Academy',
	crafting: '🔨 Crafting',
	'monster-mc': '🐉 Monster MC',
	wuxia: '🥋 Wuxia'
};

export const subgenreColors: Record<Subgenre, string> = {
	litrpg: 'var(--blue-bright, #83a598)',
	cultivation: 'var(--green-bright, #b8bb26)',
	progression: 'var(--yellow-bright, #fabd2f)',
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

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface ActiveFilter {
	type: 'author' | 'narrator' | 'series';
	value: string;
}
