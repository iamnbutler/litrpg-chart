/**
 * The export contract: shapes of the static JSON files the pipeline emits
 * and the web app consumes. The pipeline validates every file against these
 * schemas at export time; the web app imports the inferred types.
 *
 * Breaking changes here require bumping SCHEMA_VERSION and updating both sides.
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const SUBGENRES = [
	"litrpg",
	"cultivation",
	"dungeon",
	"isekai",
	"tower-climbing",
	"system-apocalypse",
	"base-building",
	"time-loop",
	"academy",
	"crafting",
	"monster-mc",
	"wuxia",
] as const;

export const SubgenreSchema = z.enum(SUBGENRES);
export type Subgenre = z.infer<typeof SubgenreSchema>;

/** A book as exported for the frontend. Book identity is the Audible ASIN. */
export const ExportedBookSchema = z.object({
	asin: z.string().min(1),
	title: z.string().min(1),
	authors: z.array(z.string()),
	narrators: z.array(z.string()),
	/** Stable series identity — the Audible series ASIN. Null for standalones. */
	seriesAsin: z.string().nullable(),
	seriesName: z.string().nullable(),
	/** Audible sequence string: "1", "2.5", "1-3"… kept verbatim for display/sort. */
	seriesPosition: z.string().nullable(),
	/** ISO date (YYYY-MM-DD). */
	releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	runtimeMin: z.number().int().nonnegative().nullable(),
	coverUrl: z.string().nullable(),
	description: z.string(),
	/** Audible product page URL (US marketplace). */
	url: z.string(),
	rating: z.number().min(0).max(5).nullable(),
	ratingCount: z.number().int().nonnegative().nullable(),
	subgenres: z.array(SubgenreSchema),
	relevanceScore: z.number(),
});
export type ExportedBook = z.infer<typeof ExportedBookSchema>;

/** years/<year>.json — all exported books released that year. */
export const YearFileSchema = z.array(ExportedBookSchema);
export type YearFile = z.infer<typeof YearFileSchema>;

/**
 * series/index.json — compact list of every exported series.
 * Small enough to load eagerly; enough to render series lists
 * (including future localStorage watch/hide views) without book data.
 */
export const SeriesIndexEntrySchema = z.object({
	asin: z.string().min(1),
	name: z.string().min(1),
	authors: z.array(z.string()),
	subgenres: z.array(SubgenreSchema),
	bookCount: z.number().int().positive(),
	firstYear: z.number().int(),
	lastYear: z.number().int(),
	coverUrl: z.string().nullable(),
});
export type SeriesIndexEntry = z.infer<typeof SeriesIndexEntrySchema>;

export const SeriesIndexSchema = z.array(SeriesIndexEntrySchema);
export type SeriesIndex = z.infer<typeof SeriesIndexSchema>;

/**
 * browse/{series,authors,narrators}/<key>.json — full book lists for one
 * entity, lazily fetched when a browse modal opens. Series are keyed by
 * series ASIN; authors/narrators by slug (see `slugify`).
 */
export const BrowseFileSchema = z.array(ExportedBookSchema);
export type BrowseFile = z.infer<typeof BrowseFileSchema>;

/** meta.json — freshness and inventory; drives year navigation. */
export const MetaSchema = z.object({
	schemaVersion: z.literal(SCHEMA_VERSION),
	lastUpdated: z.string(),
	/** Years with at least one exported book, ascending. */
	years: z.record(
		z.string().regex(/^\d{4}$/),
		z.object({ count: z.number().int().nonnegative() }),
	),
	totals: z.object({
		books: z.number().int().nonnegative(),
		series: z.number().int().nonnegative(),
	}),
});
export type Meta = z.infer<typeof MetaSchema>;

/**
 * Slug used for author/narrator browse file names and URL params.
 * Must produce identical results in pipeline (file names) and web (fetch paths).
 */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Paths of the exported files, relative to the static data root. */
export const DATA_PATHS = {
	meta: "meta.json",
	year: (year: number | string) => `years/${year}.json`,
	seriesIndex: "series/index.json",
	browseSeries: (seriesAsin: string) => `browse/series/${seriesAsin}.json`,
	browseAuthor: (slug: string) => `browse/authors/${slug}.json`,
	browseNarrator: (slug: string) => `browse/narrators/${slug}.json`,
} as const;
