export type Subgenre = 'litrpg' | 'cultivation' | 'progression' | 'dungeon' | 'isekai';

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
	isekai: '🚚 Isekai'
};

export const subgenreColors: Record<Subgenre, string> = {
	litrpg: 'var(--blue-bright, #83a598)',
	cultivation: 'var(--green-bright, #b8bb26)',
	progression: 'var(--yellow-bright, #fabd2f)',
	dungeon: 'var(--red-bright, #fb4934)',
	isekai: 'var(--purple-bright, #d3869b)'
};

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';
