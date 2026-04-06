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
}

export const subgenreLabels: Record<Subgenre, string> = {
	litrpg: 'LitRPG',
	cultivation: 'Cultivation',
	progression: 'Progression',
	dungeon: 'Dungeon Core',
	isekai: 'Isekai'
};

export const subgenreColors: Record<Subgenre, string> = {
	litrpg: '#6366f1',
	cultivation: '#10b981',
	progression: '#f59e0b',
	dungeon: '#ef4444',
	isekai: '#8b5cf6'
};

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';
