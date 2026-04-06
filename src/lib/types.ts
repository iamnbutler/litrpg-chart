export type Subgenre =
	| 'litrpg'
	| 'cultivation'
	| 'progression'
	| 'dungeon'
	| 'isekai'
	| 'tower'
	| 'system_apocalypse'
	| 'base_building'
	| 'crafting'
	| 'regression'
	| 'monster_mc'
	| 'academy'
	| 'superhero';

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
	runtimeMinutes?: number;
	publisher?: string;
	isAINarrated?: boolean;
	qualityScore?: number;
}

export const subgenreLabels: Record<Subgenre, string> = {
	litrpg: 'LitRPG',
	cultivation: 'Cultivation',
	progression: 'Progression',
	dungeon: 'Dungeon Core',
	isekai: 'Isekai',
	tower: 'Tower',
	system_apocalypse: 'System Apocalypse',
	base_building: 'Base Building',
	crafting: 'Crafting',
	regression: 'Regression',
	monster_mc: 'Monster MC',
	academy: 'Academy',
	superhero: 'Superhero'
};

export const subgenreColors: Record<Subgenre, string> = {
	litrpg: '#6366f1',
	cultivation: '#10b981',
	progression: '#f59e0b',
	dungeon: '#ef4444',
	isekai: '#8b5cf6',
	tower: '#ec4899',
	system_apocalypse: '#f97316',
	base_building: '#14b8a6',
	crafting: '#a78bfa',
	regression: '#06b6d4',
	monster_mc: '#84cc16',
	academy: '#e879f9',
	superhero: '#3b82f6'
};

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';
