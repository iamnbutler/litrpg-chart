/**
 * Unified configuration loader for the data backend.
 *
 * Reads JSON config files from scripts/backend/config/ and environment
 * variables, validates their structure, and exports a singleton Config object.
 *
 * Usage:
 *   import { loadConfig } from './config.js';
 *   const config = loadConfig();
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudibleSearchesConfig {
	genres: string[];
	series: string[];
	categories: { id: string; name: string; maxPages: number }[];
}

export interface SubgenreRule {
	patterns: string[];
	weight: { title: number; subtitle: number; description: number };
}

export interface SubgenresConfig {
	[subgenre: string]: SubgenreRule | string;
	defaultSubgenre: string;
}

export interface ContentFiltersConfig {
	excludePatterns: string[];
	fieldsToCheck: string[];
}

export interface QualityConfig {
	exportMinScore: number;
	weights: Record<string, number>;
}

export interface SourcesConfig {
	audible: {
		baseUrl: string;
		maxPagesGenre: number;
		maxPagesSeries: number;
		delayMs: number;
		retryAttempts: number;
		retryDelayMs: number;
		resultsPerPage: number;
		responseGroups: string;
		imageSizes: string;
	};
	hardcover: {
		baseUrl: string;
		rateLimit: number;
	};
	royalroad: {
		enabled: boolean;
	};
}

export interface Config {
	audibleSearches: AudibleSearchesConfig;
	subgenres: SubgenresConfig;
	contentFilters: ContentFiltersConfig;
	quality: QualityConfig;
	sources: SourcesConfig;
	env: {
		hardcoverApiToken: string | undefined;
		databasePath: string;
	};
}

// ---------------------------------------------------------------------------
// Defaults (used when optional fields are missing)
// ---------------------------------------------------------------------------

const DEFAULTS: {
	quality: QualityConfig;
	sources: SourcesConfig;
	contentFilters: ContentFiltersConfig;
} = {
	quality: {
		exportMinScore: 0,
		weights: { rating: 1.0, ratingCount: 0.5, seriesPresence: 0.3, descriptionLength: 0.2 },
	},
	sources: {
		audible: {
			baseUrl: 'https://api.audible.com/1.0/catalog/products',
			maxPagesGenre: 15,
			maxPagesSeries: 3,
			delayMs: 300,
			retryAttempts: 3,
			retryDelayMs: 500,
			resultsPerPage: 50,
			responseGroups: 'product_attrs,contributors,series,media,rating',
			imageSizes: '500',
		},
		hardcover: { baseUrl: 'https://hardcover.app/api/v1', rateLimit: 100 },
		royalroad: { enabled: false },
	},
	contentFilters: {
		excludePatterns: [],
		fieldsToCheck: ['title', 'subtitle', 'merchandising_summary'],
	},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, 'config');

function readJson<T>(filename: string): T {
	const filepath = join(CONFIG_DIR, filename);
	try {
		const raw = readFileSync(filepath, 'utf-8');
		return JSON.parse(raw) as T;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to load config file "${filename}": ${message}`);
	}
}

function requireArray(value: unknown, path: string): void {
	if (!Array.isArray(value)) {
		throw new Error(`Config validation error: "${path}" must be an array`);
	}
}

function requireString(value: unknown, path: string): void {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`Config validation error: "${path}" must be a non-empty string`);
	}
}

function requireNumber(value: unknown, path: string): void {
	if (typeof value !== 'number' || isNaN(value)) {
		throw new Error(`Config validation error: "${path}" must be a number`);
	}
}

function requireObject(value: unknown, path: string): void {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`Config validation error: "${path}" must be an object`);
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateAudibleSearches(data: unknown): AudibleSearchesConfig {
	requireObject(data, 'audible-searches');
	const obj = data as Record<string, unknown>;

	requireArray(obj.genres, 'audible-searches.genres');
	for (const g of obj.genres as unknown[]) {
		requireString(g, 'audible-searches.genres[]');
	}

	requireArray(obj.series, 'audible-searches.series');
	for (const s of obj.series as unknown[]) {
		requireString(s, 'audible-searches.series[]');
	}

	const categories = (obj.categories ?? []) as unknown[];
	requireArray(categories, 'audible-searches.categories');
	for (let i = 0; i < categories.length; i++) {
		const cat = categories[i];
		requireObject(cat, `audible-searches.categories[${i}]`);
		const c = cat as Record<string, unknown>;
		requireString(c.id, `audible-searches.categories[${i}].id`);
		requireString(c.name, `audible-searches.categories[${i}].name`);
		requireNumber(c.maxPages, `audible-searches.categories[${i}].maxPages`);
	}

	return {
		genres: obj.genres as string[],
		series: obj.series as string[],
		categories: categories as AudibleSearchesConfig['categories'],
	};
}

function validateSubgenres(data: unknown): SubgenresConfig {
	requireObject(data, 'subgenres');
	const obj = data as Record<string, unknown>;

	if (!obj.defaultSubgenre || typeof obj.defaultSubgenre !== 'string') {
		throw new Error('Config validation error: "subgenres.defaultSubgenre" must be a non-empty string');
	}

	for (const [key, value] of Object.entries(obj)) {
		if (key === 'defaultSubgenre') continue;
		requireObject(value, `subgenres.${key}`);
		const rule = value as Record<string, unknown>;
		requireArray(rule.patterns, `subgenres.${key}.patterns`);
		for (const p of rule.patterns as unknown[]) {
			requireString(p, `subgenres.${key}.patterns[]`);
		}
		requireObject(rule.weight, `subgenres.${key}.weight`);
		const w = rule.weight as Record<string, unknown>;
		requireNumber(w.title, `subgenres.${key}.weight.title`);
		requireNumber(w.subtitle, `subgenres.${key}.weight.subtitle`);
		requireNumber(w.description, `subgenres.${key}.weight.description`);
	}

	return obj as unknown as SubgenresConfig;
}

function validateContentFilters(data: unknown): ContentFiltersConfig {
	requireObject(data, 'content-filters');
	const obj = data as Record<string, unknown>;

	requireArray(obj.excludePatterns, 'content-filters.excludePatterns');
	for (const p of obj.excludePatterns as unknown[]) {
		requireString(p, 'content-filters.excludePatterns[]');
	}

	requireArray(obj.fieldsToCheck, 'content-filters.fieldsToCheck');
	for (const f of obj.fieldsToCheck as unknown[]) {
		requireString(f, 'content-filters.fieldsToCheck[]');
	}

	return obj as unknown as ContentFiltersConfig;
}

function validateQuality(data: unknown): QualityConfig {
	requireObject(data, 'quality');
	const obj = data as Record<string, unknown>;

	requireNumber(obj.exportMinScore, 'quality.exportMinScore');
	requireObject(obj.weights, 'quality.weights');

	for (const [k, v] of Object.entries(obj.weights as Record<string, unknown>)) {
		requireNumber(v, `quality.weights.${k}`);
	}

	return obj as unknown as QualityConfig;
}

function validateSources(data: unknown): SourcesConfig {
	requireObject(data, 'sources');
	const obj = data as Record<string, unknown>;

	// Audible
	requireObject(obj.audible, 'sources.audible');
	const a = obj.audible as Record<string, unknown>;
	requireString(a.baseUrl, 'sources.audible.baseUrl');
	requireNumber(a.maxPagesGenre, 'sources.audible.maxPagesGenre');
	requireNumber(a.maxPagesSeries, 'sources.audible.maxPagesSeries');
	requireNumber(a.delayMs, 'sources.audible.delayMs');

	// Hardcover
	requireObject(obj.hardcover, 'sources.hardcover');
	const h = obj.hardcover as Record<string, unknown>;
	requireString(h.baseUrl, 'sources.hardcover.baseUrl');
	requireNumber(h.rateLimit, 'sources.hardcover.rateLimit');

	// Royal Road
	requireObject(obj.royalroad, 'sources.royalroad');

	return obj as unknown as SourcesConfig;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

let _cachedConfig: Config | null = null;

/**
 * Load and validate all configuration. Results are cached — subsequent calls
 * return the same object.
 */
export function loadConfig(): Config {
	if (_cachedConfig) return _cachedConfig;

	console.log('[config] Loading configuration from', CONFIG_DIR);

	const audibleSearches = validateAudibleSearches(readJson('audible-searches.json'));
	console.log('[config] Loaded audible-searches.json');

	const subgenres = validateSubgenres(readJson('subgenres.json'));
	console.log('[config] Loaded subgenres.json');

	let contentFilters: ContentFiltersConfig;
	try {
		contentFilters = validateContentFilters(readJson('content-filters.json'));
		console.log('[config] Loaded content-filters.json');
	} catch {
		console.log('[config] content-filters.json not found or invalid, using defaults');
		contentFilters = DEFAULTS.contentFilters;
	}

	let quality: QualityConfig;
	try {
		quality = validateQuality(readJson('quality.json'));
		console.log('[config] Loaded quality.json');
	} catch {
		console.log('[config] quality.json not found or invalid, using defaults');
		quality = DEFAULTS.quality;
	}

	let sources: SourcesConfig;
	try {
		sources = validateSources(readJson('sources.json'));
		// Merge defaults for optional nested fields
		sources = {
			audible: { ...DEFAULTS.sources.audible, ...sources.audible },
			hardcover: { ...DEFAULTS.sources.hardcover, ...sources.hardcover },
			royalroad: { ...DEFAULTS.sources.royalroad, ...sources.royalroad },
		};
		console.log('[config] Loaded sources.json');
	} catch {
		console.log('[config] sources.json not found or invalid, using defaults');
		sources = DEFAULTS.sources;
	}

	const env = {
		hardcoverApiToken: process.env.HARDCOVER_API_TOKEN,
		databasePath: process.env.DATABASE_PATH ?? 'data/books.db',
	};

	_cachedConfig = { audibleSearches, subgenres, contentFilters, quality, sources, env };
	console.log('[config] Configuration loaded successfully');
	return _cachedConfig;
}

/**
 * Build a RegExp from an array of pattern strings (OR-joined, case-insensitive).
 */
export function buildPatternRegex(patterns: string[]): RegExp {
	return new RegExp(patterns.join('|'), 'i');
}

/**
 * Reset cached config (useful for testing).
 */
export function resetConfig(): void {
	_cachedConfig = null;
}
